/**
 * Muse adapter. Every call runs server-side with the key from Settings / MUSE_API_KEY.
 * Jobs are submitted, polled until done, and the result is copied into the local media store
 * so links never expire.
 *
 * Muse API (all JSON, `Authorization: Bearer <key>`):
 *   POST /v1/images  {prompt, aspect_ratio, images?}                      → {id}
 *   POST /v1/videos  {prompt, aspect_ratio, duration_seconds, images?}    → {id}
 *   GET  /v1/images/:id | /v1/videos/:id                                  → {status: queued|running|done|failed, url?, error?}
 *   GET  /v1/balance                                                      → {remaining_videos, tier_name}
 *   images = [{mime_type, data_base64, filename}] – at most 3, all treated as references.
 */
import { downloadToStore, resolveMedia } from './media.ts'
import { loadSettings, type ProviderConfig, type ProviderId } from './settings.ts'

export class ProviderError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new ProviderError('Cancelled', 499))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new ProviderError('Cancelled', 499))
    })
  })

function cfg(id: ProviderId, needKey = true): ProviderConfig {
  const p = loadSettings().providers[id]
  if (!p.enabled) throw new ProviderError(`${LABEL[id]} is disabled in Settings`, 400)
  if (needKey && !p.apiKey) throw new ProviderError(`${LABEL[id]}: missing API key – add it in Settings or set MUSE_API_KEY`, 400)
  return p
}

export const LABEL: Record<ProviderId, string> = { muse: 'Muse' }

async function errorText(r: Response) {
  const t = await r.text().catch(() => '')
  try {
    const j = JSON.parse(t)
    const d = j.detail ?? j.error ?? j.message ?? j
    return typeof d === 'string' ? d : (d?.message ?? JSON.stringify(d)).slice(0, 400)
  } catch {
    return t.slice(0, 400) || r.statusText
  }
}

// Connection-level failures where the request never reached the provider – safe to retry (no duplicate job).
// EPIPE = the connection closed while we were still writing the body, so the provider never got a full request.
const RETRYABLE = new Set(['UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE'])

async function call(id: ProviderId, url: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<Response> {
  let r: Response | undefined
  for (let attempt = 1; ; attempt++) {
    try {
      r = await fetch(url, init)
      break
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new ProviderError('Cancelled', 499)
      const code = e?.cause?.code ?? e?.code
      // idempotent GETs (polling) may also retry on resets
      const retry = attempt < 4 && (RETRYABLE.has(code) || ((init.method ?? 'GET') === 'GET' && ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)))
      if (!retry) throw new ProviderError(`${LABEL[id]}: cannot reach ${new URL(url).host} (${code ?? e?.message ?? e})`)
      console.warn(`[flows] ${LABEL[id]}: ${code} – retrying (${attempt}/3)`)
      await sleep(2000 * attempt, init.signal ?? undefined)
    }
  }
  if (!r!.ok) {
    const text = await errorText(r!)
    throw new ProviderError(`${LABEL[id]} ${r.status}: ${text}`, r.status === 401 || r.status === 403 ? 401 : 502)
  }
  return r
}

/* ================================================================== */
/* Muse – image / video jobs                                          */
/* ================================================================== */

const nearest = (v: number, opts: number[]) => opts.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a))

/**
 * Muse accepts at most 3 images: with more, the first 2 go as-is and the rest are tiled into one
 * contact sheet (3rd image). Big images are re-encoded as JPEG so uploads don't stall.
 */
export interface RefItem {
  url: string
  label: string
  /** how the image is used in the shot */
  role: 'reference' | 'opening' | 'ending'
}

const slug = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'ref'
/** "Ring – front" / "Grid 3×3 · 2-1" → "ring" – images of one subject share a base label. */
const baseLabel = (l: string) => l.split(/\s[–·|-]\s/)[0].trim().toLowerCase()

/**
 * Muse reference images (max 3, every image is a reference – Muse gets no start frame):
 * - more than `max` images: images of the same subject (same base label) are tiled into one sheet,
 *   then any remaining overflow is tiled together;
 * - files are named image<N>_<label>; prompt mentions are renumbered to "image N" / "image N, panel P";
 * - an IMAGES block telling Muse what each image is goes on top of the prompt.
 */
export async function museRefs(items: RefItem[], prompt: string, signal?: AbortSignal, max = 3) {
  items = items.filter((i) => i.url)
  if (!items.length) return { images: [] as any[], prompt }
  // 1. group
  let groups: number[][] = []
  if (items.length <= max) groups = items.map((_, i) => [i])
  else {
    const by = new Map<string, number[]>()
    items.forEach((it, i) => {
      const k = it.role === 'reference' ? baseLabel(it.label) : `__${it.role}${i}`
      by.set(k, [...(by.get(k) ?? []), i])
    })
    groups = [...by.values()]
    if (groups.length > max) groups = [...groups.slice(0, max - 1), groups.slice(max - 1).flat()]
  }
  // 2. build images
  const { contactSheet } = await import('./ffmpeg.ts')
  const images: any[] = []
  const where = new Map<number, { n: number; panel?: number }>()
  for (const [gi, g] of groups.entries()) {
    const n = gi + 1
    const first = items[g[0]]
    if (g.length === 1) {
      const m = await resolveMedia(first.url)
      const mime = ['image/png', 'image/jpeg', 'image/webp'].includes(m.mime) ? m.mime : 'image/png'
      const ext = mime.split('/')[1].replace('jpeg', 'jpg')
      images.push({ mime_type: mime, data_base64: m.buf.toString('base64'), filename: `image${n}_${slug(first.label)}.${ext}` })
      where.set(g[0], { n })
    } else {
      const sheet = await contactSheet(g.map((i) => items[i].url), signal)
      images.push({ mime_type: 'image/jpeg', data_base64: sheet.toString('base64'), filename: `image${n}_${slug(baseLabel(first.label))}_sheet.jpg` })
      g.forEach((i, k) => where.set(i, { n, panel: k + 1 }))
    }
  }
  const ref = (i: number) => {
    const w = where.get(i)!
    return w.panel ? `image ${w.n}, panel ${w.panel}` : `image ${w.n}`
  }
  // 3. renumber mentions: client writes "reference image K (label)" (K = position among reference
  // inputs) and "the start frame" / "the end frame"
  const refIdx = items.map((it, i) => (it.role === 'reference' ? i : -1)).filter((i) => i >= 0)
  prompt = prompt.replace(/reference image (\d+) \(([^)]+)\)/g, (all, k, label) => {
    const i = refIdx[Number(k) - 1]
    return i === undefined ? all : `${ref(i)} (${label})`
  })
  const opening = items.findIndex((it) => it.role === 'opening')
  const ending = items.findIndex((it) => it.role === 'ending')
  if (opening >= 0) prompt = prompt.replace(/\bthe start frame\b/gi, `${ref(opening)} (opening scene)`)
  if (ending >= 0) prompt = prompt.replace(/\bthe end frame\b/gi, `${ref(ending)} (closing scene)`)
  if (items.length < 2) return { images, prompt }
  // 4. IMAGES block
  const roleText = (it: RefItem) =>
    it.role === 'opening' ? 'opening scene – match its setting, framing and composition at the start' : it.role === 'ending' ? 'closing scene – end on this composition' : 'reference'
  const lines = groups.map((g, gi) => {
    if (g.length === 1) return `- Image ${gi + 1}: ${items[g[0]].label} (${roleText(items[g[0]])}).`
    // "Ring – front" + "Ring – 3/4" = one subject from several views; "Character – Old man" + "Character – Old woman" = different subjects
    const VIEW = /\b(front|back|side|profile|left|right|top|bottom|3\/4|three-quarter|close-?up|detail|view|angle|macro|full body|face)\b/i
    const tails = g.map((i) => items[i].label.split(/\s[–·|-]\s/).slice(1).join(' '))
    const oneSubject = new Set(g.map((i) => baseLabel(items[i].label))).size === 1 && tails.every((t) => VIEW.test(t))
    const panels = g.map((i, k) => `panel ${k + 1} = ${items[i].label}`).join(', ')
    const what = oneSubject ? ` of ONE subject (${baseLabel(items[g[0]].label)}) seen several ways` : ` with ${g.length} different subjects, each panel is a separate reference – do not merge them`
    return `- Image ${gi + 1} is a reference sheet${what}: ${panels} (panels left to right, top to bottom).`
  })
  const head = [
    'IMAGES (all are references for one continuous shot – none of them is a literal first frame; never show sheet panels, borders, labels or white backgrounds in the result):',
    ...lines,
  ].join('\n')
  return { images, prompt: `${head}\n\n${prompt}` }
}

/** At most `n` callers inside `fn` at once; the rest wait in FIFO order (a freed slot is handed over directly). */
function limiter(n: number) {
  let active = 0
  const queue: (() => void)[] = []
  return async <T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (active < n) active++
    else await new Promise<void>((resolve) => queue.push(resolve))
    try {
      if (signal?.aborted) throw new ProviderError('Cancelled', 499)
      return await fn()
    } finally {
      const next = queue.shift()
      if (next) next()
      else active--
    }
  }
}
// Muse runs at most 4 jobs per account at once – share the slots between editor runs and headless jobs
const museSlot = limiter(Math.max(1, Number(process.env.MUSE_CONCURRENCY) || 4))

export const muse = {
  h(p: ProviderConfig) {
    return { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' }
  },
  job(kind: 'images' | 'videos', body: unknown, signal?: AbortSignal) {
    return museSlot(() => this.runJob(kind, body, signal), signal)
  },
  async runJob(kind: 'images' | 'videos', body: unknown, signal?: AbortSignal) {
    const p = cfg('muse')
    const r = await call('muse', `${p.baseUrl}/v1/${kind}`, { method: 'POST', headers: this.h(p), body: JSON.stringify(body), signal })
    const created: any = await r.json()
    if (!created.id) throw new ProviderError(`Muse: unexpected response ${JSON.stringify(created).slice(0, 200)}`)
    const started = Date.now()
    while (Date.now() - started < 6 * 60_000) {
      await sleep(5000, signal)
      const pr = await call('muse', `${p.baseUrl}/v1/${kind}/${created.id}`, { headers: this.h(p), signal })
      const j: any = await pr.json()
      if (j.status === 'done' && j.url) return { url: await downloadToStore(j.url, {}, kind === 'videos' ? 'video/mp4' : 'image/png'), jobId: created.id }
      if (j.status === 'failed') throw new ProviderError(`Muse: ${j.error || 'job failed'}`)
    }
    throw new ProviderError('Muse: timed out waiting for the job')
  },
  async image(o: { prompt: string; aspectRatio?: string; refs?: RefItem[]; signal?: AbortSignal }) {
    const ar = ['1:1', '16:9', '9:16', '3:4', '4:3'].includes(o.aspectRatio ?? '') ? o.aspectRatio : '1:1'
    const { images, prompt } = await museRefs(o.refs ?? [], o.prompt, o.signal)
    return this.job('images', { prompt, aspect_ratio: ar, ...(images.length ? { images } : {}) }, o.signal)
  },
  async video(o: { prompt: string; aspectRatio?: string; durationSecs?: number; refs?: RefItem[]; signal?: AbortSignal }) {
    const [w, h] = (o.aspectRatio ?? '16:9').split(':').map(Number)
    const ar = h > w ? '9:16' : '16:9'
    const { images, prompt } = await museRefs(o.refs ?? [], o.prompt, o.signal)
    return this.job('videos', { prompt, aspect_ratio: ar, duration_seconds: nearest(o.durationSecs ?? 10, [10, 20, 30, 60]), ...(images.length ? { images } : {}) }, o.signal)
  },
  async test() {
    const p = cfg('muse')
    const r = await call('muse', `${p.baseUrl}/v1/balance`, { headers: this.h(p) })
    const j: any = await r.json()
    return { ok: true, message: `Balance: ${j.remaining_videos ?? '?'} videos${j.tier_name ? ` · ${j.tier_name}` : ''}` }
  },
}

export const PROVIDERS = { muse }

/* ================================================================== */
/* Capability router                                                  */
/* ================================================================== */

export interface RunRequest {
  capability: 'image' | 'video' | 'frame'
  model?: string
  prompt?: string
  images?: string[]
  /** labels of `images` (same order) – used to name and describe references */
  imageLabels?: string[]
  startFrameLabel?: string
  endFrameLabel?: string
  startFrame?: string
  endFrame?: string
  aspectRatio?: string
  durationSecs?: number
  /** frame: source video and which frame to take */
  video?: string
  which?: 'first' | 'last' | 'time'
  /** frame with which "time": seconds from the start */
  at?: number
}

/** Every image of a request as a labelled Muse reference: references, then opening, then closing frame. */
function refItems(req: RunRequest): RefItem[] {
  return [
    ...(req.images ?? []).map((url, i) => ({ url, label: req.imageLabels?.[i] || `reference ${i + 1}`, role: 'reference' as const })),
    ...(req.startFrame ? [{ url: req.startFrame, label: req.startFrameLabel || 'opening scene', role: 'opening' as const }] : []),
    ...(req.endFrame ? [{ url: req.endFrame, label: req.endFrameLabel || 'closing scene', role: 'ending' as const }] : []),
  ]
}

export async function run(req: RunRequest, signal: AbortSignal): Promise<{ text?: string; url?: string; provider: string }> {
  const need = (v: unknown, what: string) => {
    if (!v) throw new ProviderError(what, 400)
  }
  switch (req.capability) {
    case 'image':
      need(req.prompt?.trim(), 'Prompt is empty')
      return { ...(await muse.image({ prompt: req.prompt!, aspectRatio: req.aspectRatio, refs: refItems(req), signal })), provider: 'muse' }
    case 'video':
      need(req.prompt?.trim(), 'Prompt is empty')
      // Muse has no start-frame mode: start/end frames are sent as references with their role
      return { ...(await muse.video({ prompt: req.prompt!, aspectRatio: req.aspectRatio, durationSecs: req.durationSecs, refs: refItems(req), signal })), provider: 'muse' }
    case 'frame': {
      need(req.video, 'Connect a video first')
      const { extractFrame } = await import('./ffmpeg.ts')
      return { ...(await extractFrame({ video: req.video!, which: req.which ?? 'last', at: req.at, signal })), provider: 'ffmpeg' }
    }
    default:
      throw new ProviderError(`Unsupported capability ${(req as any).capability}`, 400)
  }
}
