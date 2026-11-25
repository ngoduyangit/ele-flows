/** Display helpers for shots on the scenes board. */
import { nodeOutputUrl } from '../lib/graphOps'
import { posterUrl, thumbUrl } from '../lib/thumb'
import type { FlowNode } from '../lib/types'
import type { BoardNode, ResolvedShot } from '../shared/board'
import { activeGeneration } from '../store/flowStore'

export type Status = 'none' | 'running' | 'done' | 'error'

const CODE = /^\s*([A-Z]{1,3} ?\d{1,3}[A-Za-z0-9]*)\s*(\([^)]*\))?\s*[–—:-]?\s*/

export const aspectNum = (a: string) => {
  const [w, h] = String(a).split(':').map(Number)
  return w > 0 && h > 0 ? w / h : 16 / 9
}

/** "V07" of "V07 (a07) – Thiên tướng: …" (empty when the label has no code). */
export const shotCode = (s: ResolvedShot) => CODE.exec(String(s.head.data.label ?? ''))?.[1].replace(' ', '') ?? ''

/** The label without its codes: "Thiên tướng: To gan!" */
export const shotTitle = (s: ResolvedShot) => String(s.head.data.label ?? '').replace(CODE, '').trim()

export function nodeStatus(n: BoardNode | null, running: Record<string, unknown>): Status | null {
  if (!n) return null
  if (n.type === 'image' || n.type === 'video') return n.data?.assetReference?.previewUrl ? 'done' : 'none'
  const g = activeGeneration(n.data)
  if (running[n.id] || g?.status === 'running' || g?.status === 'queued') return 'running'
  if (g?.status === 'error') return 'error'
  return g?.url || g?.text ? 'done' : 'none'
}

/** Card image: the clip's poster once there is a video, else the still. */
export function shotThumb(s: ResolvedShot, width = 512): string | undefined {
  const v = s.video ? nodeOutputUrl(s.video as FlowNode) : undefined
  const poster = posterUrl(v, width)
  if (poster) return poster
  const u = s.still ? nodeOutputUrl(s.still as FlowNode) : undefined
  return posterUrl(u, width) ?? thumbUrl(u, width)
}

export const shotDuration = (s: ResolvedShot): number => Number(s.video?.data?.parameters?.video?.durationSecs ?? 0) || 0

export const shotAspect = (s: ResolvedShot) => aspectNum(s.video?.data?.parameters?.aspectRatio ?? s.still?.data?.parameters?.aspectRatio ?? '16:9')

/**
 * A useful line from a prompt for the card: the ACTION block of structured video prompts, else the first
 * paragraph that isn't a label block ("REFERENCES:", "CONTINUITY:" …) or the style/rules header of a still.
 */
export function promptExcerpt(plain: string, max = 160): string {
  const text = plain.replace(/\r/g, '')
  const action = /(?:^|\n)ACTIONS?:\s*([\s\S]*?)(?=\n[A-Z][A-Z &/()-]{2,}:|$)/.exec(text)?.[1]
  const pick = action
    ? action
        .replace(/\d+(?:\.\d+)?\s*[–-]\s*\d+(?:\.\d+)?\s*s:\s*/g, '')
        .split(/(?<=[.!?])\s+/)
        .filter((x) => !/start[- ]frame pose|still hold in the final pose/i.test(x))
        .join(' ')
    : text
        .split(/\n+/)
        .map((x) => x.trim())
        .find((x) => x.length > 20 && !/^[A-Z][A-Z &/()-]{2,}:/.test(x) && !x.startsWith('[') && !/no text|no subtitles|no watermark/i.test(x)) ?? ''
  const one = pick.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

export const fmtDuration = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)}m${String(Math.round(sec % 60)).padStart(2, '0')}s` : `${Math.round(sec)}s`)
