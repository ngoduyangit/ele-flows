/**
 * Provider adapters: Muse (image/video) and Nov (Seedance video, Seedream image – see docs/providers/nov-seedance.md).
 * Every call runs server-side with the key from Settings / MUSE_API_KEY / NOV_API_KEY.
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
  if (needKey && !p.apiKey) throw new ProviderError(`${LABEL[id]}: missing API key – add it in Settings or set ${id.toUpperCase()}_API_KEY`, 400)
  return p
}

export const LABEL: Record<ProviderId, string> = { muse: 'Muse', nov: 'Nov' }

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

/* ================================================================== */
/* Nov (nov.ai.vn) – Seedance 2.0 / 2.5 video, Seedream 5.x image     */
/* ================================================================== */

/** Server whose param schema we speak (prompt, image_urls, image_mode, video_url, audio_file_url, resolution, duration, aspect_ratio, audio). */
const NOV_SERVER = 'sv18'
export const NOV_MODELS = ['seedance-2.5', 'seedance-2.5-flash', 'seedance-2.5-ultra', 'seedance-2.0', 'seedance-2.0-mini']
// The account allows far more (70 on 2026-11-25); 10 at once keeps the editor fast without flooding Nov
const novSlot = limiter(Math.max(1, Number(process.env.NOV_CONCURRENCY) || 10))
// Uploaded inputs keyed by local media file → nov URL, so re-runs don't re-upload the same still
const novUploads = new Map<string, string>()
const novParams = new Map<string, Promise<any[]>>()
const novServerList = new Map<string, Promise<any[]>>()
/** Seedream: preferred server per model (cheapest 2K at the time of writing); any other healthy server is a fallback. */
export const NOV_IMAGE_MODELS: Record<string, string> = { 'seedream-5.5': 'sv15', 'seedream-5.0': 'sv1' }

export const nov = {
  h(p: ProviderConfig, json = true): Record<string, string> {
    return { Authorization: `Bearer ${p.apiKey}`, ...(json ? { 'Content-Type': 'application/json' } : {}) }
  },
  /** Param definitions of `model` on NOV_SERVER (cached; public endpoint). */
  params(model: string) {
    if (!novParams.has(model)) {
      const p = cfg('nov', false)
      const pr = call('nov', `${p.baseUrl}/v1/models/${encodeURIComponent(model)}/servers`)
        .then((r) => r.json())
        .then((j: any) => {
          const sv = (j.servers ?? []).find((s: any) => s.server_id === NOV_SERVER)
          if (!sv) throw new ProviderError(`Nov: ${model} is not offered on ${NOV_SERVER.toUpperCase()}`, 400)
          if (sv.maintenance || sv.server_status !== 'healthy') throw new ProviderError(`Nov: ${model} on ${NOV_SERVER.toUpperCase()} is under maintenance – try again later`, 503)
          return sv.params ?? []
        })
      pr.catch(() => setTimeout(() => novParams.delete(model), 5000))
      novParams.set(model, pr)
      setTimeout(() => novParams.delete(model), 10 * 60_000).unref() // server status changes – refresh every 10 min
    }
    return novParams.get(model)!
  },
  /** All servers of a canonical model with status, params and pricing (cached 10 min; public endpoint). */
  servers(model: string) {
    if (!novServerList.has(model)) {
      const p = cfg('nov', false)
      const pr = call('nov', `${p.baseUrl}/v1/models/${encodeURIComponent(model)}/servers`)
        .then((r) => r.json())
        .then((j: any) => (j.servers ?? []) as any[])
      pr.catch(() => setTimeout(() => novServerList.delete(model), 5000))
      novServerList.set(model, pr)
      setTimeout(() => novServerList.delete(model), 10 * 60_000).unref()
    }
    return novServerList.get(model)!
  },
  /**
   * Seedream text/image → image. Every Nov server has its own param names, so the body is built from that
   * server's param list: refs go to whichever file param it has, aspect/resolution snap to its options.
   */
  async image(o: { model?: string; prompt: string; aspectRatio?: string; resolution?: string; images?: string[]; signal?: AbortSignal }) {
    const model = o.model && NOV_IMAGE_MODELS[o.model] ? o.model : 'seedream-5.5'
    const healthy = (await this.servers(model)).filter((s) => s.server_status === 'healthy' && !s.maintenance)
    const sv = healthy.find((s) => s.server_id === NOV_IMAGE_MODELS[model]) ?? healthy.sort((a, b) => (a.pricing?.min_price ?? 1e9) - (b.pricing?.min_price ?? 1e9))[0]
    if (!sv) throw new ProviderError(`Nov: every server of ${model} is under maintenance – try again later`, 503)
    const params: any[] = sv.params ?? []
    const param = (name: string) => params.find((x) => x.name === name)
    const opts = (name: string): string[] => (param(name)?.options ?? []).map((x: any) => String(x.value))
    const body: Record<string, unknown> = { model, server: sv.server_id, prompt: o.prompt }
    const ar = opts('aspect_ratio')
    if (ar.length) body.aspect_ratio = o.aspectRatio && ar.includes(o.aspectRatio) ? o.aspectRatio : (['auto', 'adaptive'].find((x) => ar.includes(x)) ?? (ar.includes('1:1') ? '1:1' : ar[0]))
    const res = opts('resolution')
    if (res.length) {
      // node offers 1K / 2K / 4K; servers use e.g. 1k|2k or 1.5k|2k – take the closest, never above what was asked unless nothing is lower
      const k = (v: string) => parseFloat(v) || 1
      const want = k(o.resolution ?? '2K')
      body.resolution = res.reduce((a, b) => (Math.abs(k(b) - want) < Math.abs(k(a) - want) ? b : a))
    }
    const refs = o.images ?? []
    if (refs.length) {
      const fp = param('reference_image_urls') ?? param('image_urls') ?? params.find((x) => x.type === 'file_url' && x.file_type === 'image')
      if (!fp) throw new ProviderError(`Nov: ${model} on ${sv.server_name ?? sv.server_id} takes no reference images`, 400)
      const max = Number(fp.max_files) || 1
      if (refs.length > max) throw new ProviderError(`${model}: at most ${max} reference images on ${sv.server_name ?? sv.server_id} – this node has ${refs.length}. Remove ${refs.length - max}.`, 400)
      const urls = await Promise.all(refs.map((u) => this.upload(u, o.signal)))
      body[fp.name] = fp.multiple === false ? urls[0] : urls
    }
    return novSlot(() => this.job(body, o.signal, 'image/png'), o.signal)
  },
  async upload(url: string, signal?: AbortSignal): Promise<string> {
    if (/^https:\/\/nov\.ai\.vn\//.test(url)) return url
    const key = url.split('?')[0]
    const hit = novUploads.get(key)
    if (hit) return hit
    const p = cfg('nov')
    const m = await resolveMedia(url)
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(m.buf)], { type: m.mime }), m.name)
    const r = await call('nov', `${p.baseUrl}/account/ai/uploads`, { method: 'POST', headers: this.h(p, false), body: form, signal })
    const j: any = await r.json()
    if (!j.url) throw new ProviderError(`Nov: upload failed ${JSON.stringify(j).slice(0, 200)}`)
    novUploads.set(key, j.url)
    return j.url
  },
  async video(o: {
    model?: string
    prompt: string
    aspectRatio?: string
    durationSecs?: number
    resolution?: string
    audio?: boolean
    images?: string[]
    imageLabels?: string[]
    startFrame?: string
    endFrame?: string
    video?: string
    audioRef?: string
    signal?: AbortSignal
  }) {
    const model = NOV_MODELS.includes(o.model ?? '') ? o.model! : 'seedance-2.5'
    const params = await this.params(model)
    const opts = (name: string): string[] => (params.find((x: any) => x.name === name)?.options ?? []).map((x: any) => String(x.value))
    const refs = o.images ?? []
    // Frame modes only when the node has frames and no references; otherwise every image is an @ImageN reference
    const mode = !refs.length && o.startFrame && o.endFrame ? 'first_last' : !refs.length && o.startFrame ? 'first_frame' : 'reference'
    const imgs = mode === 'reference' ? [...refs, ...(o.startFrame ? [o.startFrame] : []), ...(o.endFrame ? [o.endFrame] : [])] : [o.startFrame!, ...(mode === 'first_last' ? [o.endFrame!] : [])]
    // image_urls holds frames and references together; reject before uploading/charging (Nov would 400 anyway)
    const maxImgs = Number(params.find((x: any) => x.name === 'image_urls')?.max_files) || 0
    if (maxImgs && imgs.length > maxImgs)
      throw new ProviderError(
        `${model}: at most ${maxImgs} images per video (references + start/end frames together) – this node has ${imgs.length} (${refs.length} reference${refs.length === 1 ? '' : 's'}${o.startFrame ? ' + start frame' : ''}${o.endFrame ? ' + end frame' : ''}). Remove ${imgs.length - maxImgs} or pick a model that takes more (Seedance 2.5 / Ultra: 30).`,
        400,
      )
    let prompt = o.prompt
    if (mode === 'reference' && imgs.length) {
      const startN = refs.length + 1
      const endN = refs.length + (o.startFrame ? 2 : 1)
      prompt = prompt
        .replace(/reference image (\d+)/g, '@Image$1')
        .replace(/the start frame/g, `@Image${startN}`)
        .replace(/the end frame/g, `@Image${endN}`)
      const legend = [
        ...refs.map((_, i) => `@Image${i + 1}: ${o.imageLabels?.[i] || `reference ${i + 1}`}`),
        ...(o.startFrame ? [`@Image${startN}: opening frame`] : []),
        ...(o.endFrame ? [`@Image${endN}: closing frame`] : []),
      ]
      prompt = `${legend.join('\n')}\n\n${prompt}`
    }
    const pick = (name: string, want: string | undefined, fallback: string) => {
      const list = opts(name)
      return want && list.includes(want) ? want : list.includes(fallback) ? fallback : (list[0] ?? fallback)
    }
    const durs = opts('duration').map(Number).filter((n) => n > 0)
    const res = (o.resolution ?? '').toLowerCase() === '4k' ? '1080p' : o.resolution
    const body: Record<string, unknown> = {
      model,
      server: NOV_SERVER,
      prompt,
      resolution: pick('resolution', res, '720p'),
      duration: String(durs.length ? nearest(o.durationSecs ?? 10, durs) : (o.durationSecs ?? 10)),
      aspect_ratio: pick('aspect_ratio', o.aspectRatio, 'auto'),
      audio: o.audio ?? true,
    }
    if (imgs.length) {
      body.image_urls = await Promise.all(imgs.map((u) => this.upload(u, o.signal)))
      body.image_mode = mode
    }
    if (o.video) body.video_url = await this.upload(o.video, o.signal)
    if (o.audioRef) body.audio_file_url = await this.upload(o.audioRef, o.signal)
    return novSlot(() => this.job(body, o.signal), o.signal)
  },
  async job(body: Record<string, unknown>, signal?: AbortSignal, mime = 'video/mp4') {
    const p = cfg('nov')
    const r = await call('nov', `${p.baseUrl}/v1/generations`, { method: 'POST', headers: this.h(p), body: JSON.stringify(body), signal })
    let g: any = await r.json()
    if (!g.id) throw new ProviderError(`Nov: unexpected response ${JSON.stringify(g).slice(0, 200)}`)
    console.log(`[flows] Nov ${body.model} job ${g.code ?? g.id} · ${g.cost ?? '?'} ${g.currency ?? 'VND'}`)
    const started = Date.now()
    while (['queued', 'processing'].includes(g.status)) {
      if (Date.now() - started > 30 * 60_000) throw new ProviderError(`Nov: timed out waiting for job ${g.code ?? g.id}`)
      await sleep(6000, signal)
      try {
        g = await (await call('nov', `${p.baseUrl}/v1/generations/${g.id}`, { headers: this.h(p), signal })).json()
      } catch (e: any) {
        // A 5xx / gateway error while polling does not stop the job on Nov (it keeps running and is charged) –
        // keep polling instead of losing a paid result; only auth errors and cancellation end the loop.
        if (e instanceof ProviderError && (e.status === 499 || e.status === 401)) throw e
        console.warn(`[flows] Nov: poll of ${g.code ?? g.id} failed (${e?.message ?? e}) – retrying`)
      }
    }
    if (g.status !== 'succeeded') throw new ProviderError(`Nov: ${typeof g.error === 'string' ? g.error : (g.error?.message ?? g.status)}${g.refunded ? ' (refunded)' : ''}`)
    const file = (g.output?.files ?? []).find((f: any) => f.type === mime.split('/')[0]) ?? g.output?.files?.[0]
    if (!file?.url) throw new ProviderError('Nov: job finished without a file')
    console.log(`[flows] Nov job ${g.code ?? g.id} done · charged ${Number(g.cost ?? 0).toLocaleString('vi-VN')}đ`)
    return { url: await downloadToStore(file.url, {}, mime), jobId: g.id, ...(typeof g.cost === 'number' ? { cost: g.cost } : {}) }
  },
  async test() {
    const p = cfg('nov')
    const j: any = await (await call('nov', `${p.baseUrl}/account/credits`, { headers: this.h(p) })).json()
    return { ok: true, message: `Balance: ${Number(j.credits ?? 0).toLocaleString('vi-VN')} VND · ${j.concurrency ?? '?'} concurrent jobs` }
  },
}

export const PROVIDERS = { muse, nov }

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
  /** Nov: image '1K' | '2K', video '480p' | '720p' | '1080p' */
  resolution?: string
  /** Nov/Seedance: native audio on/off */
  generateAudio?: boolean
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

/** "nov/seedance-2.5" → 'nov'; anything else ("muse", unset) → Muse. */
const provider = (model?: string) => (model?.startsWith('nov/') ? 'nov' : 'muse')
const modelName = (model?: string) => model?.split('/').slice(1).join('/') || undefined

export async function run(req: RunRequest, signal: AbortSignal): Promise<{ text?: string; url?: string; provider: string }> {
  const need = (v: unknown, what: string) => {
    if (!v) throw new ProviderError(what, 400)
  }
  switch (req.capability) {
    case 'image':
      need(req.prompt?.trim(), 'Prompt is empty')
      if (provider(req.model) === 'nov')
        return { ...(await nov.image({ model: modelName(req.model), prompt: req.prompt!, aspectRatio: req.aspectRatio, resolution: req.resolution, images: req.images, signal })), provider: 'nov' }
      return { ...(await muse.image({ prompt: req.prompt!, aspectRatio: req.aspectRatio, refs: refItems(req), signal })), provider: 'muse' }
    case 'video':
      need(req.prompt?.trim(), 'Prompt is empty')
      if (provider(req.model) === 'nov')
        return {
          ...(await nov.video({
            model: modelName(req.model),
            prompt: req.prompt!,
            aspectRatio: req.aspectRatio,
            durationSecs: req.durationSecs,
            resolution: req.resolution,
            audio: req.generateAudio,
            images: req.images,
            imageLabels: req.imageLabels,
            startFrame: req.startFrame,
            endFrame: req.endFrame,
            signal,
          })),
          provider: 'nov',
        }
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
