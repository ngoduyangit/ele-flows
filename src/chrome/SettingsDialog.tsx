import { CircleCheck, CircleX, ExternalLink, LoaderCircle, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Switch, cn } from '../components/ui'
import { getSettings, saveSettings, testProvider, type ProviderId, type PublicSettings } from '../lib/providers'
import { useFlow } from '../store/flowStore'

interface ProviderMeta {
  id: ProviderId
  name: string
  role: string
  docs: string
  keyLabel?: string
}

const MUSE: ProviderMeta = {
  id: 'muse',
  name: 'Muse',
  role: 'Image & video generation',
  docs: 'https://muse.careflow-demo.online/docs',
  keyLabel: 'API key (Bearer) – or MUSE_API_KEY in .env',
}

const NOV: ProviderMeta = {
  id: 'nov',
  name: 'Nov',
  role: 'Seedance 2.x video · Seedream 5.x image (pick the model on a node)',
  docs: 'https://nov.ai.vn/api-docs',
  keyLabel: 'API key (Bearer) – or NOV_API_KEY in .env',
}

type TestState = { state: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }

const input =
  'w-full h-9 rounded-[10px] bg-background ring-1 ring-gray-alpha-200 px-3 text-sm outline-none focus:ring-foreground/60 placeholder:text-subtle disabled:bg-gray-alpha-50'

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-secondary mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-subtle mt-1">{hint}</span>}
    </label>
  )
}

export function SettingsDialog() {
  const open = useFlow((s) => s.settingsOpen)
  const setOpen = useFlow((s) => s.setSettingsOpen)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [tests, setTests] = useState<Partial<Record<ProviderId, TestState>>>({})

  useEffect(() => {
    if (open) getSettings().then(setSettings)
  }, [open])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  const runTest = async (id: ProviderId) => {
    setTests((t) => ({ ...t, [id]: { state: 'testing' } }))
    try {
      const r = await testProvider(id)
      setTests((t) => ({ ...t, [id]: { state: r.ok ? 'ok' : 'fail', message: r.message } }))
    } catch (e: any) {
      setTests((t) => ({ ...t, [id]: { state: 'fail', message: e?.message ?? String(e) } }))
    }
  }

  return (
    <div className="fixed inset-0 z-[96] bg-black/20 flex items-center justify-center p-4" onPointerDown={() => setOpen(false)}>
      <div
        className="w-[600px] max-w-full max-h-full rounded-2xl bg-background shadow-popover animate-pop flex flex-col overflow-hidden"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between h-12 pl-6 pr-3 shrink-0">
          <p className="text-md font-semibold">Settings</p>
          <button type="button" onClick={() => setOpen(false)} className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-gray-alpha-100">
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 pb-6">
          {!settings ? (
            <LoaderCircle className="w-5 h-5 animate-spin text-subtle mx-auto my-20" />
          ) : (
            <div className="space-y-10">
              {[MUSE, NOV].map((m) => (
                <ProviderForm key={m.id} meta={m} settings={settings} test={tests[m.id]} onTest={() => runTest(m.id)} onSaved={setSettings} />
              ))}
            </div>
          )}
          <p className="mt-6 text-[11px] leading-4 text-subtle">Keys are stored on this machine in .flows/settings.json and never sent to the browser.</p>
        </div>
      </div>
    </div>
  )
}

function ProviderForm({ meta, settings, test, onTest, onSaved }: { meta: ProviderMeta; settings: PublicSettings; test?: TestState; onTest: () => void; onSaved: (s: PublicSettings) => void }) {
  const p = settings.providers[meta.id]
  const [draft, setDraft] = useState({ enabled: p.enabled, baseUrl: p.baseUrl, apiKey: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const dirty = draft.enabled !== p.enabled || draft.baseUrl !== p.baseUrl || !!draft.apiKey

  const save = async (andTest = false) => {
    setSaving(true)
    try {
      const patch: any = { enabled: draft.enabled, baseUrl: draft.baseUrl }
      if (draft.apiKey) patch.apiKey = draft.apiKey
      const s = await saveSettings({ providers: { [meta.id]: patch } })
      onSaved(s)
      setDraft((d) => ({ ...d, apiKey: '' }))
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      if (andTest) onTest()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-[520px]">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{meta.name}</h2>
          <p className="text-sm text-secondary mt-0.5">{meta.role}</p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-secondary">Enabled</span>
          <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
        </div>
      </div>

      <div className="space-y-4">
        <Field label="Base URL">
          <input className={input} value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} spellCheck={false} />
        </Field>

        <Field
            label={meta.keyLabel ?? 'API key'}
            hint={
              p.apiKeyFromEnv
                ? `Using ${p.apiKeyHint} from an environment variable. Paste a key here to use it instead.`
                : p.apiKeySet
                  ? `A key ending in ${p.apiKeyHint} is saved. Type a new one to replace it.`
                  : 'Paste your key – it stays on this machine.'
            }
          >
            <div className="flex gap-2">
              <input
                className={input}
                type="password"
                autoComplete="off"
                value={draft.apiKey}
                placeholder={p.apiKeySet ? `Saved ${p.apiKeyHint}` : 'Paste API key'}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              />
              {p.apiKeySet && !p.apiKeyFromEnv && (
                <button
                  type="button"
                  onClick={async () => onSaved(await saveSettings({ providers: { [meta.id]: { apiKey: '' } } }))}
                  className="h-9 px-3 rounded-[10px] text-sm font-medium text-red-600 hover:bg-red-50 shrink-0"
                >
                  Remove
                </button>
              )}
            </div>
          </Field>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => save(true)}
            className="h-9 px-3.5 rounded-[10px] bg-foreground text-background text-sm font-medium whitespace-nowrap hover:bg-gray-800 disabled:bg-gray-300"
          >
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save & test'}
          </button>
          <button
            type="button"
            onClick={onTest}
            disabled={test?.state === 'testing'}
            className="h-9 px-3.5 rounded-[10px] ring-1 ring-gray-alpha-200 text-sm font-medium whitespace-nowrap hover:bg-gray-alpha-100"
          >
            Test connection
          </button>
          <a href={meta.docs} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-secondary hover:text-foreground">
            Docs <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {test && test.state !== 'idle' && (
          <div
            className={cn(
              'flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm',
              test.state === 'ok' ? 'bg-emerald-50 text-emerald-800' : test.state === 'fail' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-secondary',
            )}
          >
            {test.state === 'testing' ? <LoaderCircle className="w-4 h-4 mt-0.5 animate-spin shrink-0" /> : test.state === 'ok' ? <CircleCheck className="w-4 h-4 mt-0.5 shrink-0" /> : <CircleX className="w-4 h-4 mt-0.5 shrink-0" />}
            <span className="break-words min-w-0">{test.state === 'testing' ? 'Testing…' : test.message}</span>
          </div>
        )}
      </div>
    </div>
  )
}
