/** Local media store (.flows/media) – uploads and downloaded generation results. */
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { extname, join, basename } from 'node:path'
import { DATA_DIR } from './settings.ts'

const MEDIA_DIR = join(DATA_DIR, 'media')
export const MEDIA_PREFIX = '/api/media/'

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'text/plain': '.txt',
}
const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]))
MIME_BY_EXT['.mp3'] = 'audio/mpeg'
MIME_BY_EXT['.webm'] = 'video/webm'

export function mimeOf(file: string) {
  return MIME_BY_EXT[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** Save bytes, return the public URL (/api/media/<id>.<ext>). */
export function saveMedia(buf: Buffer, mime: string, hintName?: string): string {
  mkdirSync(MEDIA_DIR, { recursive: true })
  const ext = EXT_BY_MIME[mime.split(';')[0].trim()] ?? (hintName ? extname(hintName) : '') ?? '.bin'
  const name = `${randomUUID()}${ext || '.bin'}`
  writeFileSync(join(MEDIA_DIR, name), buf)
  return MEDIA_PREFIX + name
}

/** Download a remote URL into the store (Muse links expire). */
export async function downloadToStore(url: string, headers: Record<string, string> = {}, fallbackMime = 'application/octet-stream'): Promise<string> {
  const r = await fetch(url, { headers })
  if (!r.ok) throw new Error(`Download failed (${r.status}) ${url}`)
  const mime = r.headers.get('content-type')?.split(';')[0] || fallbackMime
  return saveMedia(Buffer.from(await r.arrayBuffer()), mime === 'application/octet-stream' ? fallbackMime : mime, new URL(url).pathname)
}

/** Resolve any URL the browser holds (local store, data:, http) into bytes. */
export async function resolveMedia(url: string): Promise<{ buf: Buffer; mime: string; name: string }> {
  if (url.startsWith(MEDIA_PREFIX) || url.includes(MEDIA_PREFIX)) {
    const name = basename(url.split(MEDIA_PREFIX)[1].split('?')[0])
    const path = join(MEDIA_DIR, name)
    if (!existsSync(path)) throw new Error(`Media not found: ${name}`)
    return { buf: readFileSync(path), mime: mimeOf(name), name }
  }
  if (url.startsWith('data:')) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url)
    if (!m) throw new Error('Bad data URL')
    const mime = m[1] || 'application/octet-stream'
    const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
    return { buf, mime, name: `inline${EXT_BY_MIME[mime] ?? ''}` }
  }
  if (/^https?:\/\//.test(url)) {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`Cannot fetch media (${r.status})`)
    const mime = r.headers.get('content-type')?.split(';')[0] || 'application/octet-stream'
    return { buf: Buffer.from(await r.arrayBuffer()), mime, name: basename(new URL(url).pathname) || 'file' }
  }
  if (url.startsWith('blob:')) throw new Error('This media only exists in the browser – re-upload it.')
  throw new Error(`Unsupported media URL: ${url.slice(0, 40)}`)
}

/**
 * Canvas previews show 2K generations at 50–300 px; decoding a hundred full-size images on every pan/zoom
 * made the editor stutter. GET /api/media/<file>?w=256|512|768 serves a cached JPEG thumbnail instead.
 */
const THUMB_DIR = join(MEDIA_DIR, '.thumbs')
const THUMB_WIDTHS = [256, 512, 768]
const thumbJobs = new Map<string, Promise<void>>()
const runFile = promisify(execFile)

export async function serveThumb(req: IncomingMessage, res: ServerResponse, file: string, width: number) {
  const name = basename(decodeURIComponent(file))
  const src = join(MEDIA_DIR, name)
  const video = /\.(mp4|webm|mov)$/i.test(name)
  if ((!video && !/\.(png|jpe?g|webp|gif)$/i.test(name)) || !existsSync(src)) return serveMedia(req, res, file)
  const w = THUMB_WIDTHS.find((x) => x >= width) ?? THUMB_WIDTHS.at(-1)!
  const out = join(THUMB_DIR, `${name}-w${w}.jpg`)
  if (!existsSync(out)) {
    mkdirSync(THUMB_DIR, { recursive: true })
    let job = thumbJobs.get(out)
    if (!job) {
      // write to a temp name first so a half-written file is never served
      const tmp = `${out}.${randomUUID()}.jpg`
      // a video gets a poster frame (0.5 s in: past fade-ins) so the canvas never has to load the clip itself
      job = runFile('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...(video ? ['-ss', '0.5'] : []), '-i', src, '-vf', `scale='min(${w},iw)':-2`, '-frames:v', '1', '-q:v', '4', tmp])
        .then(() => renameSync(tmp, out))
        .finally(() => thumbJobs.delete(out))
      thumbJobs.set(out, job)
    }
    try {
      await job
    } catch {
      return serveMedia(req, res, file) // no ffmpeg / unreadable image: fall back to the original
    }
  }
  res.setHeader('Content-Type', 'image/jpeg')
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  res.setHeader('Content-Length', statSync(out).size)
  createReadStream(out).pipe(res)
}

/** GET /api/media/<file> with Range support (audio/video seeking). */
export function serveMedia(req: IncomingMessage, res: ServerResponse, file: string) {
  const name = basename(decodeURIComponent(file))
  const path = join(MEDIA_DIR, name)
  if (!existsSync(path)) {
    res.statusCode = 404
    return res.end('not found')
  }
  const size = statSync(path).size
  const type = mimeOf(name)
  res.setHeader('Content-Type', type)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', end - start + 1)
    return createReadStream(path, { start, end }).pipe(res)
  }
  res.setHeader('Content-Length', size)
  createReadStream(path).pipe(res)
}
