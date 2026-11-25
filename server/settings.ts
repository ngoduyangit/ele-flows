/**
 * Provider settings (Muse, Nov) – stored server-side in .flows/settings.json (git-ignored).
 * API keys never leave the server: the browser only sees whether a key is set + its last 4 chars.
 * MUSE_API_KEY / MUSE_BASE_URL and NOV_API_KEY / NOV_BASE_URL (also read from .env) are used when nothing is saved in Settings.
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

export type ProviderId = 'muse' | 'nov'

export interface ProviderConfig {
  enabled: boolean
  baseUrl: string
  apiKey?: string
}

export interface Settings {
  providers: Record<ProviderId, ProviderConfig>
}

export const DEFAULT_BASE_URL = 'https://muse.careflow-demo.online'

export const NOV_BASE_URL = 'https://nov.ai.vn/api'

export const DEFAULT_SETTINGS: Settings = {
  providers: {
    muse: { enabled: true, baseUrl: DEFAULT_BASE_URL },
    nov: { enabled: true, baseUrl: NOV_BASE_URL },
  },
}

const ENV: Record<ProviderId, { key: string; url: string }> = {
  muse: { key: 'MUSE_API_KEY', url: 'MUSE_BASE_URL' },
  nov: { key: 'NOV_API_KEY', url: 'NOV_BASE_URL' },
}

const envBacked = new Set<ProviderId>()

export function loadSettings(): Settings {
  let saved: Partial<Settings> = {}
  try {
    if (existsSync(FILE)) saved = JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    /* corrupt file → defaults */
  }
  // .env may be edited while the server runs – re-read it so a new key works without a restart
  try {
    process.loadEnvFile(join(process.cwd(), '.env'))
  } catch {
    /* no .env */
  }
  const providers = {} as Record<ProviderId, ProviderConfig>
  for (const id of Object.keys(DEFAULT_SETTINGS.providers) as ProviderId[]) {
    const p: ProviderConfig = { ...DEFAULT_SETTINGS.providers[id], ...(saved.providers?.[id] ?? {}) }
    const env = ENV[id]
    if (process.env[env.url] && !saved.providers?.[id]?.baseUrl) p.baseUrl = process.env[env.url]!.replace(/\/+$/, '')
    // A key saved in Settings wins; the env var is only a fallback.
    if (!p.apiKey && process.env[env.key]) {
      p.apiKey = process.env[env.key]
      envBacked.add(id)
    } else envBacked.delete(id)
    providers[id] = p
  }
  return { providers }
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
    if (typeof next.baseUrl === 'string') next.baseUrl = next.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.providers[id].baseUrl
    cur.providers[id] = next
  }
  saveRaw(cur)
  return loadSettings()
}
