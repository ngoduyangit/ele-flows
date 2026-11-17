/**
 * Muse settings – stored server-side in .flows/settings.json (git-ignored).
 * The API key never leaves the server: the browser only sees whether a key is set + its last 4 chars.
 * MUSE_API_KEY / MUSE_BASE_URL (also read from .env) are used when nothing is saved in Settings.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

try {
  process.loadEnvFile(join(process.cwd(), '.env'))
} catch {
  /* no .env – env vars / Settings only */
}

export const DATA_DIR = join(process.cwd(), '.flows')
const FILE = join(DATA_DIR, 'settings.json')

export type ProviderId = 'muse'

export interface ProviderConfig {
  enabled: boolean
  baseUrl: string
  apiKey?: string
}

export interface Settings {
  providers: Record<ProviderId, ProviderConfig>
}

export const DEFAULT_BASE_URL = 'https://muse.careflow-demo.online'

export const DEFAULT_SETTINGS: Settings = {
  providers: {
    muse: { enabled: true, baseUrl: DEFAULT_BASE_URL },
  },
}

const envBacked = new Set<ProviderId>()

export function loadSettings(): Settings {
  let saved: Partial<Settings> = {}
  try {
    if (existsSync(FILE)) saved = JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    /* corrupt file → defaults */
  }
  const muse: ProviderConfig = { ...DEFAULT_SETTINGS.providers.muse, ...(saved.providers?.muse ?? {}) }
  if (process.env.MUSE_BASE_URL && !saved.providers?.muse?.baseUrl) muse.baseUrl = process.env.MUSE_BASE_URL.replace(/\/+$/, '')
  // A key saved in Settings wins; the env var is only a fallback.
  if (!muse.apiKey && process.env.MUSE_API_KEY) {
    muse.apiKey = process.env.MUSE_API_KEY
    envBacked.add('muse')
  } else envBacked.delete('muse')
  return { providers: { muse } }
}

function saveRaw(s: Settings) {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(s, null, 2), { mode: 0o600 })
}

/** Shape sent to the browser – keys masked. */
export function publicSettings(s: Settings) {
  const providers: Record<string, unknown> = {}
  for (const [id, p] of Object.entries(s.providers)) {
    const { apiKey, ...rest } = p
    providers[id] = {
      ...rest,
      apiKeySet: !!apiKey,
      apiKeyHint: apiKey ? `…${apiKey.slice(-4)}` : '',
      apiKeyFromEnv: envBacked.has(id as ProviderId),
    }
  }
  return { providers }
}

/**
 * Merge an update from the browser. `apiKey: undefined` keeps the current key,
 * `apiKey: ""` clears it, any other string replaces it.
 */
export function updateSettings(patch: { providers?: Partial<Record<ProviderId, Partial<ProviderConfig>>> }) {
  const cur = loadSettings()
  // never persist env-provided keys into the file
  for (const id of envBacked) delete cur.providers[id].apiKey
  for (const [id, p] of Object.entries(patch.providers ?? {}) as [ProviderId, Partial<ProviderConfig>][]) {
    if (!cur.providers[id]) continue
    const next = { ...cur.providers[id], ...p }
    if (p.apiKey === undefined) next.apiKey = cur.providers[id].apiKey
    else if (p.apiKey === '') delete next.apiKey
    else next.apiKey = p.apiKey.trim()
    if (typeof next.baseUrl === 'string') next.baseUrl = next.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_BASE_URL
    cur.providers[id] = next
  }
  saveRaw(cur)
  return loadSettings()
}
