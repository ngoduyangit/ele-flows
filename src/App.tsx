import * as Tooltip from '@radix-ui/react-tooltip'
import { ReactFlowProvider } from '@xyflow/react'
import { LoaderCircle, Plus } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useEffect, useState } from 'react'
import { FlowCanvas } from './canvas/FlowCanvas'
import { BottomBar } from './chrome/BottomBar'
import { QuickActions, StructurePanel } from './chrome/Panels'
import { TopBar } from './chrome/TopBar'
import { SettingsDialog } from './chrome/SettingsDialog'
import { Notice } from './chrome/Notice'
import { CanvasControls } from './chrome/CanvasControls'
import { migrateLocalFlows } from './lib/serverApi'
import sample from './data/sample-flow.json'
import { api } from './lib/api'
import type { FlowDocument } from './lib/types'
import { navigate, useRoute } from './router'
import { useFlow } from './store/flowStore'
import { INTERRUPTED } from './shared/interrupted'

const SAMPLE_ID = 'muse-starter'

async function ensureSample() {
  await migrateLocalFlows().catch((e) => console.warn('flow migration failed', e))
  const existing = await api.loadFlow(SAMPLE_ID)
  if (existing) return
  const now = Date.now()
  await api.saveFlow({ id: SAMPLE_ID, name: 'Muse starter flow', nodes: sample.nodes as any, edges: sample.edges as any, createdAt: now, updatedAt: now })
}

async function createFlow(name = 'Untitled flow', from?: FlowDocument) {
  const now = Date.now()
  const id = nanoid(20)
  await api.saveFlow({ id, name, nodes: from ? structuredClone(from.nodes) : [], edges: from ? structuredClone(from.edges) : [], createdAt: now, updatedAt: now })
  navigate(`/flows/${id}`)
}

export default function App() {
  const route = useRoute()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    ensureSample().then(() => setReady(true))
  }, [])
  useEffect(() => {
    if (ready && !route) navigate(`/flows/${SAMPLE_ID}`)
  }, [ready, route])
  if (!ready) return null
  const m = /^\/flows\/([\w-]+)/.exec(route)
  return <Tooltip.Provider delayDuration={400}>{m ? <Editor key={m[1]} id={m[1]} /> : <Home />}</Tooltip.Provider>
}

/* ------------------------------------------------------------------ */
/* Editor                                                             */
/* ------------------------------------------------------------------ */

/**
 * A generation still "running" that neither this tab nor a live API job is working on (server
 * restarted, tab reloaded mid-run) would spin forever – turn it into an "Interrupted" error.
 */
function closeStaleRuns(runs: any[]) {
  const s = useFlow.getState()
  const busy = new Set<string>(Object.keys(s.running))
  for (const r of runs) if (r.status === 'running') for (const n of r.nodes ?? []) if (n.status === 'running' || n.status === 'pending') busy.add(n.nodeId)
  for (const n of s.nodes) {
    // generations with an owner belong to a server process (maybe another dev server on the same .flows) –
    // that server's sweep closes them when its process is gone, this tab can't know
    const stale = (g: any) => (g.status === 'running' || g.status === 'queued') && !g.owner
    const gens = (n.data as any).generations as { status?: string }[] | undefined
    if (busy.has(n.id) || !gens?.some(stale)) continue
    s.updateNodeData(
      n.id,
      (d: any) => ({ ...d, generations: d.generations.map((g: any) => (stale(g) ? { ...g, status: 'error', error: INTERRUPTED } : g)) }),
      { history: false },
    )
  }
}

function Editor({ id }: { id: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    let alive = true
    api.loadFlow(id).then((flow) => {
      if (!alive) return
      if (!flow) return setState('missing')
      useFlow.getState().load(flow)
      document.title = `${flow.name} | Flows`
      setState('ready')
      // flows created through the API carry estimated positions – re-arrange once nodes are measured
      if (flow.autoLayout) setTimeout(() => window.dispatchEvent(new Event('flows:tidy')), 700)
    })
    return () => {
      alive = false
    }
  }, [id])

  // debounced autosave
  useEffect(() => {
    if (state !== 'ready') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const fingerprint = () => {
      const s = useFlow.getState()
      return JSON.stringify([s.name, s.nodes.map(({ selected: _a, dragging: _b, measured: _c, ...n }) => n), s.edges.map(({ selected: _d, ...e }) => e)])
    }
    let last = fingerprint()
    const unsub = useFlow.subscribe((s, prev) => {
      if (s.nodes === prev.nodes && s.edges === prev.edges && s.name === prev.name) return
      if (s.name !== prev.name) document.title = `${s.name} | Flows`
      clearTimeout(timer)
      timer = setTimeout(async () => {
        const fp = fingerprint()
        if (fp === last) {
          if (useFlow.getState().saveState === 'unsaved') useFlow.setState({ saveState: 'saved' })
          return
        }
        useFlow.setState({ saveState: 'saving' })
        try {
          await api.saveFlow(useFlow.getState().toDocument())
          last = fp
          useFlow.setState({ saveState: 'saved' })
        } catch (e: any) {
          // the flow was replaced from outside (API/script) after this tab loaded it: take that version
          // instead of writing the old graph over it
          if (String(e?.message ?? '').startsWith('stale')) {
            const doc = await api.loadFlow(id).catch(() => null)
            if (doc) {
              useFlow.getState().load(doc)
              last = fingerprint()
              console.info('[flows] flow changed outside the editor – reloaded')
              return
            }
          }
          useFlow.setState({ saveState: 'error' })
        }
      }, 800)
    })
    return () => {
      unsub()
      clearTimeout(timer)
    }
  }, [state])

  // follow headless runs started through the API (POST /api/flows/:id/run)
  const [apiRun, setApiRun] = useState<{ done: number; total: number; status: string } | null>(null)
  useEffect(() => {
    if (state !== 'ready') return
    let wasRunning = false
    let alive = true
    let seenFinish = Date.now()
    const tick = async () => {
      try {
        const runs = await fetch(`/api/runs?flowId=${encodeURIComponent(id)}`).then((r) => r.json())
        const run = runs.find((r: any) => r.status === 'running' && r.kind !== 'editor')
        const editorBusy = runs.some((r: any) => r.status === 'running' && r.kind === 'editor')
        // also catch short runs that started and finished between two ticks
        const finishedSince = runs.some((r: any) => r.finishedAt && r.finishedAt > seenFinish)
        if (finishedSince) seenFinish = Math.max(...runs.map((r: any) => r.finishedAt ?? 0))
        if (run || editorBusy || wasRunning || finishedSince) {
          const doc = await api.loadFlow(id)
          if (doc && alive) useFlow.getState().mergeServerGenerations(doc)
        }
        if (!alive) return
        closeStaleRuns(runs)
        wasRunning = !!run || editorBusy
        setApiRun(run ? { done: (run.progress.done ?? 0) + (run.progress.skipped ?? 0) + (run.progress.error ?? 0), total: run.progress.total, status: run.status } : null)
      } catch {
        /* server restarting – try again next tick */
      }
    }
    void tick()
    const t = setInterval(tick, 2500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [state, id])

  if (state === 'loading')
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <LoaderCircle className="w-5 h-5 animate-spin text-subtle" />
      </div>
    )
  if (state === 'missing')
    return (
      <div className="h-screen flex flex-col gap-3 items-center justify-center bg-gray-50">
        <p className="text-sm text-secondary">This flow doesn’t exist.</p>
        <button className="h-9 px-3 rounded-[10px] bg-foreground text-background text-sm font-medium" onClick={() => navigate('/')}>
          Back to home
        </button>
      </div>
    )

  return (
    <ReactFlowProvider>
      <div className="relative h-screen w-full overflow-hidden">
        <div className="absolute inset-0 flex bg-gray-50">
          <FlowCanvas />
          <TopBar
            onNewFlow={() => createFlow()}
            onDuplicate={() => {
              const doc = useFlow.getState().toDocument()
              createFlow(`${doc.name} (copy)`, doc)
            }}
            onDelete={async () => {
              if (!confirm('Delete this flow?')) return
              await api.deleteFlow(id)
              navigate('/')
            }}
          />
          <BottomBar />
          <CanvasControls />
          <StructurePanel />
          <QuickActions />
          <SettingsDialog />
          <Notice />
          {apiRun && (
            <div className="absolute top-[72px] left-1/2 -translate-x-1/2 z-20 pointer-events-none">
              <div className="flex items-center gap-2 rounded-full bg-foreground text-background px-3 h-8 text-xs font-medium shadow-natural-sm">
                <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
                Running via API · {apiRun.done}/{apiRun.total} nodes
              </div>
            </div>
          )}
        </div>
      </div>
    </ReactFlowProvider>
  )
}

/* ------------------------------------------------------------------ */
/* Home                                                               */
/* ------------------------------------------------------------------ */

function Home() {
  const [flows, setFlows] = useState<Awaited<ReturnType<typeof api.listFlows>>>([])
  useEffect(() => {
    api.listFlows().then(setFlows)
    document.title = 'Flows'
  }, [])
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Flows</h1>
          <button onClick={() => createFlow()} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] bg-foreground text-background text-sm font-medium hover:bg-gray-800">
            <Plus className="w-4 h-4" /> New flow
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <button onClick={() => createFlow()} className="aspect-[4/3] rounded-2xl border border-dashed border-gray-alpha-300 flex flex-col items-center justify-center gap-2 text-secondary hover:bg-gray-50">
            <Plus className="w-5 h-5" />
            <span className="text-sm font-medium">New flow</span>
          </button>
          {flows.map((f) => (
            <button key={f.id} onClick={() => navigate(`/flows/${f.id}`)} className="text-left group">
              <div
                className="aspect-[4/3] rounded-2xl bg-gray-50 shadow-natural-xs group-hover:shadow-natural-sm transition-shadow"
                style={{ backgroundImage: 'radial-gradient(hsl(0 0% 72%) 1px, transparent 1px)', backgroundSize: '16px 16px' }}
              />
              <p className="mt-2 text-sm font-medium truncate">{f.name}</p>
              <p className="text-xs text-secondary">Edited {new Date(f.updatedAt).toLocaleString()}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
