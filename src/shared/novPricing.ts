/**
 * Nov (nov.ai.vn) Seedance prices on SV18, VND per video – copied from GET /v1/models/{id} → pricing.tables (2026-11-25).
 * Used for the estimate shown on the node; the real charge comes back from the job (`cost`) and is stored on the generation.
 * Prices are not linear: longer clips cost less per second (2.5 @ 480p: 4s = 875đ/s, 8–10s = 625đ/s, 30s = 563đ/s).
 */
export interface NovModelPricing {
  resolutions: string[]
  durations: number[]
  /** columns of the published table (seconds) → price per resolution */
  cols: number[]
  prices: Record<string, number[]>
}

const D25 = [4, 5, 6, 8, 10, 12, 15, 20, 25, 30]
const D20 = [4, 5, 6, 8, 10, 12, 15]
const C25 = [4, 5, 8, 10, 12, 15, 30]

export const NOV_PRICING: Record<string, NovModelPricing> = {
  'seedance-2.5': {
    resolutions: ['480p', '720p', '1080p'],
    durations: D25,
    cols: C25,
    prices: {
      '480p': [3500, 4375, 5000, 6250, 7500, 9375, 16875],
      '720p': [5000, 6250, 8125, 10625, 12500, 14375, 25000],
      '1080p': [7500, 9375, 12500, 15625, 18750, 21875, 37500],
    },
  },
  'seedance-2.5-flash': {
    resolutions: ['480p', '720p', '1080p'],
    durations: D25,
    cols: C25,
    prices: {
      '480p': [3000, 3750, 4750, 5625, 6875, 8500, 15000],
      '720p': [4375, 5375, 7250, 9375, 11000, 12875, 22500],
      '1080p': [6375, 7875, 10375, 13125, 15625, 18750, 33750],
    },
  },
  'seedance-2.5-ultra': {
    resolutions: ['720p', '1080p'],
    durations: D25,
    cols: C25,
    prices: {
      '720p': [7500, 10000, 12500, 16250, 19375, 22500, 38750],
      '1080p': [11875, 14375, 19375, 24375, 28750, 33750, 58125],
    },
  },
  'seedance-2.0': {
    resolutions: ['480p', '720p', '1080p'],
    durations: D20,
    cols: D20,
    prices: {
      '480p': [2500, 3125, 3625, 4375, 5000, 6250, 7500],
      '720p': [3500, 4375, 5000, 6250, 8125, 9375, 11250],
      '1080p': [5000, 6250, 6875, 8125, 10625, 12500, 15625],
    },
  },
  'seedance-2.0-mini': {
    resolutions: ['480p', '720p'],
    durations: D20,
    cols: D20,
    prices: {
      '480p': [2000, 2500, 3000, 3750, 4375, 5625, 6875],
      '720p': [3000, 3750, 4375, 5625, 6875, 8125, 10000],
    },
  },
}

/** "nov/seedance-2.5" or "seedance-2.5" → pricing (undefined for other providers). */
export function novPricing(modelId?: string): NovModelPricing | undefined {
  return NOV_PRICING[(modelId ?? '').replace(/^nov\//, '')]
}

/** Resolution / duration the job will actually use (snapped to the model's options). Tests default to the cheapest resolution. */
export function novSnap(m: NovModelPricing, resolution?: string, secs?: number) {
  const res = (resolution ?? '').toLowerCase() === '4k' ? '1080p' : resolution
  const r = res && m.resolutions.includes(res) ? res : m.resolutions[0]
  const want = secs ?? 10
  const d = m.durations.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a))
  return { resolution: r, duration: d }
}

/** Price in VND; `exact` false = interpolated between published columns (6s, 20s, 25s on 2.5). */
export function novPrice(modelId: string | undefined, resolution?: string, secs?: number): { price: number; exact: boolean; resolution: string; duration: number } | undefined {
  const m = novPricing(modelId)
  if (!m) return undefined
  const { resolution: r, duration: d } = novSnap(m, resolution, secs)
  const row = m.prices[r]
  const i = m.cols.indexOf(d)
  if (i >= 0) return { price: row[i], exact: true, resolution: r, duration: d }
  const hi = m.cols.findIndex((c) => c > d)
  const lo = hi - 1
  const t = (d - m.cols[lo]) / (m.cols[hi] - m.cols[lo])
  return { price: Math.round((row[lo] + t * (row[hi] - row[lo])) / 25) * 25, exact: false, resolution: r, duration: d }
}

export const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`

/** Nov models bill per resolution: new Seedance nodes start at 480p (tests); the final take is raised by hand. */
export const NOV_TEST_RESOLUTION = '480p'
export const isNovVideo = (modelId?: string) => /^nov\/seedance/.test(modelId ?? '')

/** Models offered in the node picker. Muse is the default; Nov ids are "nov/<model>". */
export const VIDEO_MODELS = [
  { value: 'muse', label: 'Muse' },
  { value: 'nov/seedance-2.5', label: 'Seedance 2.5' },
  { value: 'nov/seedance-2.5-flash', label: 'Seedance 2.5 Flash' },
  { value: 'nov/seedance-2.5-ultra', label: 'Seedance 2.5 Ultra' },
  { value: 'nov/seedance-2.0', label: 'Seedance 2.0' },
  { value: 'nov/seedance-2.0-mini', label: 'Seedance 2.0 Mini' },
]
export const IMAGE_MODELS = [
  { value: 'muse', label: 'Muse' },
  { value: 'nov/seedream-5.5', label: 'Seedream 5.5' },
  { value: 'nov/seedream-5.0', label: 'Seedream 5.0' },
]
/** Approximate Seedream price per image (VND, 25/11/2026). */
export const SEEDREAM_PRICE: Record<string, number> = { 'nov/seedream-5.5': 169, 'nov/seedream-5.0': 197 }
export const modelLabel = (id?: string) => [...VIDEO_MODELS, ...IMAGE_MODELS].find((m) => m.value === id)?.label ?? 'Muse'

