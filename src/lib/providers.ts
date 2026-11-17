/** Client side of the local /api settings (Muse key + base URL). */
import { useEffect, useState } from 'react'

export type ProviderId = 'muse'

export interface PublicProvider {
  enabled: boolean
  baseUrl: string
  apiKeySet: boolean
  apiKeyHint: string
  apiKeyFromEnv: boolean
}
export interface PublicSettings {
  providers: Record<ProviderId, PublicProvider>
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j as any).error ?? r.statusText)
  return j as T
}

const settingsListeners = new Set<(s: PublicSettings) => void>()

export const getSettings = () => api<PublicSettings>('/api/settings')
export const saveSettings = (patch: unknown) =>
  api<PublicSettings>('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then((s) => {
    settingsListeners.forEach((l) => l(s))
    return s
  })
export const testProvider = (id: ProviderId) => api<{ ok: boolean; message: string }>(`/api/settings/test/${id}`, { method: 'POST' })

let settingsPromise: Promise<PublicSettings> | null = null
export function useSettings() {
  const [s, setS] = useState<PublicSettings | null>(null)
  useEffect(() => {
    settingsPromise ??= getSettings()
    settingsPromise.then(setS).catch(() => {})
    const l = (n: PublicSettings) => {
      settingsPromise = Promise.resolve(n)
      setS(n)
    }
    settingsListeners.add(l)
    return () => {
      settingsListeners.delete(l)
    }
  }, [])
  return s
}
