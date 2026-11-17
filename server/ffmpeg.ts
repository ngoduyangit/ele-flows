/**
 * Local ffmpeg helpers (no external API): extract a frame from a video (to chain clips) and tile
 * reference images into one contact sheet (Muse accepts at most 3 images).
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { resolveMedia, saveMedia } from './media.ts'
import { ProviderError } from './providers.ts'
import { DATA_DIR } from './settings.ts'

const run = promisify(execFile)

export async function extractFrame(o: { video: string; which: 'first' | 'last' | 'time'; at?: number; signal?: AbortSignal }) {
  const dir = join(DATA_DIR, 'tmp', randomUUID())
  mkdirSync(dir, { recursive: true })
  try {
    const m = await resolveMedia(o.video)
    const input = join(dir, 'in')
    writeFileSync(input, m.buf)
    // high-quality JPEG: ~10x smaller than PNG, so it uploads reliably to providers as a start frame
    const out = join(dir, 'frame.jpg')
    const seek = o.which === 'last' ? ['-sseof', '-0.15'] : o.which === 'time' ? ['-ss', String(Math.max(0, Number(o.at) || 0))] : []
    try {
      await run('ffmpeg', ['-y', ...seek, '-i', input, '-frames:v', '1', '-q:v', '2', '-update', '1', out], { signal: o.signal })
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new ProviderError('Cancelled', 499)
      if (o.which === 'time') throw new ProviderError(`No frame at ${o.at ?? 0}s – is the time past the end of the video?`, 400)
      throw new ProviderError(`ffmpeg frame extraction failed: ${String(e?.stderr ?? e?.message ?? e).split('\n').filter(Boolean).slice(-2).join(' ')}`, 500)
    }
    if (!existsSync(out)) throw new ProviderError(`No frame at ${o.at ?? 0}s – the time is past the end of the video`, 400)
    return { url: saveMedia(readFileSync(out), 'image/jpeg') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Tile several images into one JPEG contact sheet (grid of 768px cells, white padding) – lets
 * providers capped at a few input images (Muse: 3) still see every character reference.
 */
export async function contactSheet(urls: string[], signal?: AbortSignal) {
  const dir = join(DATA_DIR, 'tmp', randomUUID())
  mkdirSync(dir, { recursive: true })
  try {
    const files = await Promise.all(
      urls.map(async (u, i) => {
        const f = join(dir, `in${i}`)
        writeFileSync(f, (await resolveMedia(u)).buf)
        return f
      }),
    )
    const n = files.length
    const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n))
    const rows = Math.ceil(n / cols)
    const C = 768
    // white gutter around every panel so panels read as separate references
    const G = 32
    const args = ['-y']
    files.forEach((f) => args.push('-i', f))
    const parts = files.map((_, i) => `[${i}:v]scale=${C - 2 * G}:${C - 2 * G}:force_original_aspect_ratio=decrease,pad=${C}:${C}:(ow-iw)/2:(oh-ih)/2:white,setsar=1,format=yuv420p[c${i}]`)
    const cells = files.map((_, i) => `[c${i}]`)
    for (let i = n; i < cols * rows; i++) {
      parts.push(`color=white:s=${C}x${C},format=yuv420p,trim=end_frame=1[c${i}]`)
      cells.push(`[c${i}]`)
    }
    const layout = cells.map((_, i) => `${(i % cols) * C}_${Math.floor(i / cols) * C}`).join('|')
    parts.push(`${cells.join('')}xstack=inputs=${cells.length}:layout=${layout}[out]`)
    const out = join(dir, 'sheet.jpg')
    try {
      await run('ffmpeg', [...args, '-filter_complex', parts.join(';'), '-map', '[out]', '-frames:v', '1', '-q:v', '3', out], { signal })
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new ProviderError('Cancelled', 499)
      throw new ProviderError(`ffmpeg contact sheet failed: ${String(e?.stderr ?? e?.message ?? e).split('\n').filter(Boolean).slice(-2).join(' ')}`, 500)
    }
    return readFileSync(out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
