/**
 * Runs started by the editor ("Run" on a node) are tracked here so they survive a page reload:
 * the provider call is not tied to the HTTP request, and the result is written into the flow file
 * (source "api") where the reloaded editor picks it up through /api/runs + mergeServerGenerations.
 */
import { run, type RunRequest } from './providers.ts'
import { writeGeneration } from './runner.ts'

export interface Track {
  flowId: string
  nodeId: string
  genId: string
}

interface EditorRun extends Track {
  status: 'running' | 'done' | 'error' | 'cancelled'
  createdAt: number
  finishedAt?: number
  ctrl: AbortController
  promise: Promise<{ url?: string; text?: string; provider?: string }>
}

const runs = new Map<string, EditorRun>()
const KEEP_MS = 10 * 60 * 1000 // finished runs stay listed a while so a reloaded tab sees them finish

function prune() {
  const now = Date.now()
  for (const [id, r] of runs) if (r.finishedAt && now - r.finishedAt > KEEP_MS) runs.delete(id)
}

/** Start (or re-attach to, for the same genId) a tracked run. Resolves with the provider result. */
export function startEditorRun(req: RunRequest, t: Track) {
  prune()
  const existing = runs.get(t.genId)
  if (existing) return existing.promise
  const ctrl = new AbortController()
  const r: EditorRun = { ...t, status: 'running', createdAt: Date.now(), ctrl, promise: null as any }
  // the "running" generation goes into the file now, so a reload before the editor's autosave still shows it
  writeGeneration(t.flowId, t.nodeId, { id: t.genId, status: 'running', createdAt: r.createdAt, source: 'api' })
  r.promise = run(req, ctrl.signal).then(
    (out) => {
      r.status = 'done'
      r.finishedAt = Date.now()
      writeGeneration(t.flowId, t.nodeId, { id: t.genId, status: 'done', url: out.url, text: out.text, createdAt: r.createdAt, source: 'api' })
      return out
    },
    (err) => {
      r.finishedAt = Date.now()
      if (ctrl.signal.aborted) {
        r.status = 'cancelled'
        writeGeneration(t.flowId, t.nodeId, { id: t.genId }, true)
      } else {
        r.status = 'error'
        writeGeneration(t.flowId, t.nodeId, { id: t.genId, status: 'error', error: String(err?.message ?? err), createdAt: r.createdAt, source: 'api' })
      }
      throw err
    },
  )
  r.promise.catch(() => {}) // the HTTP caller may be gone (page reloaded)
  runs.set(t.genId, r)
  return r.promise
}

export function cancelEditorRun(genId: string) {
  const r = runs.get(genId)
  if (!r || r.status !== 'running') return false
  r.ctrl.abort()
  return true
}

/** Same shape as headless job summaries (fields the editor reads), marked kind "editor". */
export function listEditorRuns(flowId?: string) {
  prune()
  return [...runs.values()]
    .filter((r) => !flowId || r.flowId === flowId)
    .map((r) => ({
      jobId: r.genId,
      kind: 'editor' as const,
      flowId: r.flowId,
      status: r.status === 'cancelled' ? 'done' : r.status,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      progress: { total: 1, [r.status]: 1 },
      nodes: [{ nodeId: r.nodeId, status: r.status }],
    }))
}
