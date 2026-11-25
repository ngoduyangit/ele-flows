/**
 * Headless flow runner: executes a stored flow node by node on the server (same request logic
 * as the editor), writes each result into the flow file and reports progress as a job.
 */
import { randomUUID } from 'node:crypto'
import { emptyDoc, mentionDocWith, mentionKeys, portsFor, type FlowDocumentJSON, type FlowNodeJSON } from '../src/shared/flowSpec.ts'
import { buildRunRequest, contextFor, docToPlain } from '../src/shared/runRequest.ts'
import { listFlows, loadFlow, localizeAssets, saveFlow } from './flows.ts'
import { markInterrupted, type GenOwner } from '../src/shared/interrupted.ts'
import { runDag } from '../src/shared/dag.ts'
import { ProviderError, run, type RunRequest } from './providers.ts'

const PASSIVE = new Set(['image', 'video', 'text', 'comment'])

export type NodeStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled'
export interface NodeRun {
  nodeId: string
  key?: string
  label: string
  type: string
  status: NodeStatus
  startedAt?: number
  finishedAt?: number
  error?: string
  url?: string
  text?: string
}
export interface RunOptions {
  /** "missing" (default): only nodes without a result · "all": re-run every runnable node. */
  mode?: 'missing' | 'all'
  /** Run this node (key, id or label) and everything downstream (+ missing upstream inputs). */
  from?: string
  /** Run only these nodes (keys, ids or labels), in dependency order. */
  nodes?: string[]
  /** Override inputs before running: { "<key|id|label>": { text?, prompt?, url? } } */
  inputs?: Record<string, { text?: string; prompt?: string; url?: string }>
  continueOnError?: boolean
  /** POSTed with the job summary when the run ends. */
  callbackUrl?: string
}
export interface Job {
  id: string
  flowId: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  options: Omit<RunOptions, 'inputs'>
  createdAt: number
  finishedAt?: number
  error?: string
  nodes: NodeRun[]
  baseUrl: string
  ctrl: AbortController
  done: Promise<void>
}

const jobs = new Map<string, Job>()
const activeByFlow = new Map<string, string>()

const findNode = (doc: FlowDocumentJSON, ref: string) =>
  doc.nodes.find((n) => n.data?.specKey === ref) ?? doc.nodes.find((n) => n.id === ref) ?? doc.nodes.find((n) => n.data?.label === ref)

/** Selected generation if it succeeded, else the most recent successful one. */
const latestGen = (n: FlowNodeJSON) => {
  const gens: any[] = n.data?.generations ?? []
  const active = gens.find((g) => g.id === n.data?.activeGenerationId)
  return active?.status === 'done' ? active : gens.filter((g) => g.status === 'done').at(-1) ?? active
}
const hasOutput = (n: FlowNodeJSON) => PASSIVE.has(n.type) || (n.data?.generations ?? []).some((g: any) => g.status === 'done' && (g.url || g.text))

function topo(doc: FlowDocumentJSON, subset: Set<string>) {
  const indeg = new Map([...subset].map((id) => [id, 0]))
  for (const e of doc.edges) if (subset.has(e.source) && subset.has(e.target)) indeg.set(e.target, indeg.get(e.target)! + 1)
  const q = [...subset].filter((id) => !indeg.get(id))
  const order: string[] = []
  while (q.length) {
    const id = q.shift()!
    order.push(id)
    for (const e of doc.edges) if (e.source === id && subset.has(e.target)) {
      indeg.set(e.target, indeg.get(e.target)! - 1)
      if (!indeg.get(e.target)) q.push(e.target)
    }
  }
  return order
}
function reach(doc: FlowDocumentJSON, start: string, dir: 'down' | 'up') {
  const out = new Set([start])
  const stack = [start]
  while (stack.length) {
    const cur = stack.pop()!
    for (const e of doc.edges) {
      const next = dir === 'down' ? (e.source === cur ? e.target : null) : e.target === cur ? e.source : null
      if (next && !out.has(next)) out.add(next), stack.push(next)
    }
  }
  return out
}

/** Decide which nodes run, in order. */
function plan(doc: FlowDocumentJSON, o: RunOptions): { order: string[]; force: Set<string> } {
  const all = new Set(doc.nodes.map((n) => n.id))
  if (o.nodes?.length) {
    const ids = new Set<string>()
    for (const r of o.nodes) {
      const n = findNode(doc, r)
      if (!n) throw new ProviderError(`unknown node "${r}"`, 400)
      ids.add(n.id)
    }
    return { order: topo(doc, ids), force: ids }
  }
  if (o.from) {
    const start = findNode(doc, o.from)
    if (!start) throw new ProviderError(`unknown node "${o.from}"`, 400)
    const targets = reach(doc, start.id, 'down')
    const needed = new Set(targets)
    for (const t of targets) for (const a of reach(doc, t, 'up')) if (!hasOutput(doc.nodes.find((n) => n.id === a)!)) needed.add(a)
    return { order: topo(doc, needed), force: targets }
  }
  return { order: topo(doc, all), force: o.mode === 'all' ? all : new Set() }
}

/** Apply caller-provided input overrides and persist them. */
async function applyInputs(doc: FlowDocumentJSON, inputs: RunOptions['inputs']) {
  if (!inputs) return
  for (const [ref, v] of Object.entries(inputs)) {
    const n = findNode(doc, ref)
    if (!n) throw new ProviderError(`inputs: unknown node "${ref}"`, 400)
    if (n.type === 'text' && v.text != null) n.data.text = emptyDoc(v.text)
    else if (['image', 'video'].includes(n.type) && v.url) n.data.assetReference = { content_asset_id: v.url, generation_id: null, previewUrl: v.url, mimeType: null }
    else if (v.prompt != null || v.text != null) {
      const text = (v.prompt ?? v.text)!
      if (!n.data.parameters) throw new ProviderError(`inputs: node "${ref}" has no prompt`, 400)
      if (n.type === 'process') n.data.parameters.prompt = text
      else {
        // `@key` → reference chip (as when the flow is created from a spec), wired in if it isn't yet
        const resolve = (k: string) => doc.nodes.find((x) => x.data?.specKey === k && x.id !== n.id)
        n.data.parameters.prompt = mentionDocWith(text, resolve)
        const ports = portsFor(n.type, n.data).inputs
        for (const k of mentionKeys(text)) {
          const src = resolve(k)
          if (!src || doc.edges.some((e) => e.source === src.id && e.target === n.id)) continue
          const out = portsFor(src.type, src.data).output
          const port = out === 'text' && ports.some((p) => p.id === 'prompt') ? 'prompt' : out === 'image' && ports.some((p) => p.id === 'referenceImages') ? 'referenceImages' : undefined
          if (port) doc.edges.push({ id: `edge-${src.id}-${n.id}-${port}`, source: src.id, sourceHandle: 'output', target: n.id, targetHandle: port, type: 'dataflow' } as any)
        }
      }
    } else throw new ProviderError(`inputs: nothing to set on node "${ref}" (use text, prompt or url)`, 400)
    // a changed input makes previous results stale
    if (!PASSIVE.has(n.type)) n.data.generations = []
    n.data.apiUpdatedAt = Date.now() // editor + autosave defer to this newer value
  }
  const warnings: string[] = []
  await localizeAssets(doc, warnings)
  saveFlow({ ...doc, updatedAt: Date.now() })
}

/** Write (or with `remove`, drop) one node's generation in the latest flow file (keeps concurrent editor edits). */
/** Stamped on running generations so another server sharing .flows never mistakes them for orphans. */
export const GEN_OWNER: GenOwner = { pid: process.pid }

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    return e?.code === 'EPERM'
  }
}

export function writeGeneration(flowId: string, nodeId: string, gen: Record<string, unknown>, remove = false) {
  if (gen.status === 'running' || gen.status === 'queued') gen = { ...gen, owner: GEN_OWNER }
  const doc = loadFlow(flowId)
  if (!doc) return
  const n = doc.nodes.find((x) => x.id === nodeId)
  if (!n) return
  const gens: any[] = (n.data.generations ?? []).filter((g: any) => g.id !== gen.id)
  n.data.generations = remove ? gens : [...gens, gen]
  n.data.activeGenerationId = remove ? (gens.filter((g) => g.status === 'done').at(-1)?.id ?? null) : gen.id
  saveFlow({ ...doc, updatedAt: Date.now() })
}

export async function startRun(flowId: string, o: RunOptions, baseUrl: string): Promise<Job> {
  if (activeByFlow.has(flowId)) throw new ProviderError(`flow "${flowId}" is already running (job ${activeByFlow.get(flowId)})`, 409)
  const doc = loadFlow(flowId)
  if (!doc) throw new ProviderError('flow not found', 404)
  await applyInputs(doc, o.inputs)
  const { order, force } = plan(doc, o)
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const nodes: NodeRun[] = order
    .map((id) => byId.get(id)!)
    .filter((n) => !PASSIVE.has(n.type))
    .map((n) => ({ nodeId: n.id, key: n.data?.specKey, label: n.data?.label ?? n.id, type: n.type, status: 'pending' as NodeStatus }))

  const { inputs: _drop, ...options } = o
  const job: Job = { id: randomUUID(), flowId, status: 'running', options, createdAt: Date.now(), nodes, baseUrl, ctrl: new AbortController(), done: Promise.resolve() }
  jobs.set(job.id, job)
  activeByFlow.set(flowId, job.id)
  job.done = execute(job, force).finally(() => {
    activeByFlow.delete(flowId)
    void notify(job)
  })
  return job
}

async function execute(job: Job, force: Set<string>) {
  const failed = new Set<string>()
  const byNode = new Map(job.nodes.map((nr) => [nr.nodeId, nr]))
  let firstFailure = ''
  // returns false only on a real failure (cancel / skip are not failures)
  const work = async (nodeId: string): Promise<boolean> => {
    const nr = byNode.get(nodeId)!
    if (job.ctrl.signal.aborted) {
      nr.status = 'cancelled'
      return true
    }
    const doc = loadFlow(job.flowId) // latest – picks up results of earlier nodes and editor edits
    const node = doc?.nodes.find((n) => n.id === nr.nodeId)
    if (!doc || !node) {
      nr.status = 'skipped'
      nr.error = 'node no longer exists'
      return true
    }
    const upstreamFailed = doc.edges.some((e) => e.target === node.id && failed.has(e.source))
    if (upstreamFailed) {
      nr.status = 'skipped'
      nr.error = 'an input failed'
      failed.add(node.id)
      return true
    }
    if (!force.has(node.id) && hasOutput(node)) {
      const g = latestGen(node)
      Object.assign(nr, { status: 'skipped', url: g?.url, text: g?.text })
      return true
    }
    nr.status = 'running'
    nr.startedAt = Date.now()
    const genId = randomUUID().replace(/-/g, '').slice(0, 20)
    writeGeneration(job.flowId, node.id, { id: genId, status: 'running', createdAt: nr.startedAt, source: 'api' })
    try {
      const req = buildRunRequest(contextFor(node, doc.nodes, doc.edges))
      const out = 'passthrough' in req ? (req.passthrough as { url?: string; text?: string }) : await run(req as unknown as RunRequest, job.ctrl.signal)
      Object.assign(nr, { status: 'done', finishedAt: Date.now(), url: out.url, text: out.text })
      writeGeneration(job.flowId, node.id, { id: genId, status: 'done', url: out.url, text: out.text, ...((out as any).cost != null ? { cost: (out as any).cost } : {}), createdAt: nr.startedAt, source: 'api' })
      return true
    } catch (e: any) {
      const cancelled = e?.status === 499 || job.ctrl.signal.aborted
      Object.assign(nr, { status: cancelled ? 'cancelled' : 'error', finishedAt: Date.now(), error: e?.message ?? String(e) })
      writeGeneration(job.flowId, node.id, { id: genId, status: 'error', error: nr.error, createdAt: nr.startedAt, source: 'api' }, cancelled)
      failed.add(node.id)
      if (cancelled) return true
      firstFailure ||= nr.label
      return false
    }
  }
  try {
    const doc = loadFlow(job.flowId)
    const deps = (id: string) => (doc?.edges ?? []).filter((e) => e.target === id).map((e) => e.source)
    // independent branches run in parallel (Muse allows 4 concurrent jobs; providers.ts enforces the cap)
    await runDag(job.nodes.map((n) => n.nodeId), deps, work, { stopOnError: !job.options.continueOnError })
    for (const rest of job.nodes)
      if (rest.status === 'pending')
        Object.assign(rest, job.ctrl.signal.aborted ? { status: 'cancelled' } : { status: 'skipped', error: `stopped after "${firstFailure}" failed` })
    job.status = job.ctrl.signal.aborted ? 'cancelled' : job.nodes.some((n) => n.status === 'error') ? 'error' : 'done'
  } catch (e: any) {
    job.status = 'error'
    job.error = e?.message ?? String(e)
  } finally {
    job.finishedAt = Date.now()
  }
}

async function notify(job: Job) {
  if (!job.options.callbackUrl) return
  try {
    await fetch(job.options.callbackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(summary(job)), signal: AbortSignal.timeout(10_000) })
  } catch (e: any) {
    console.warn(`[flows] callback to ${job.options.callbackUrl} failed: ${e?.message ?? e}`)
  }
}

const abs = (base: string, url?: string) => (url && url.startsWith('/') ? base + url : url)

/** Final outputs of the flow (all nodes with a result), keyed by spec key or node id. */
export function flowOutputs(flowId: string, baseUrl: string) {
  const doc = loadFlow(flowId)
  const out: Record<string, { nodeId: string; label: string; type: string; status: string; url?: string; text?: string }> = {}
  for (const n of doc?.nodes ?? []) {
    if (n.type === 'comment') continue
    const g = latestGen(n)
    const assetUrl = n.data?.assetReference?.previewUrl
    if (!g && !assetUrl && n.type !== 'text') continue
    out[n.data?.specKey ?? n.id] = {
      nodeId: n.id,
      label: n.data?.label,
      type: n.type,
      status: g?.status ?? 'done',
      url: abs(baseUrl, g?.url ?? assetUrl),
      text: g?.text ?? (n.type === 'text' ? docToPlain(n.data?.text) : undefined),
    }
  }
  return out
}

export function summary(job: Job) {
  const counts: Record<string, number> = {}
  for (const n of job.nodes) counts[n.status] = (counts[n.status] ?? 0) + 1
  return {
    jobId: job.id,
    flowId: job.flowId,
    status: job.status,
    error: job.error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    progress: { total: job.nodes.length, ...counts },
    nodes: job.nodes.map((n) => ({ ...n, url: abs(job.baseUrl, n.url) })),
    outputs: job.status === 'running' ? undefined : flowOutputs(job.flowId, job.baseUrl),
  }
}

export const getJob = (id: string) => jobs.get(id)
export const listJobs = (flowId?: string) => [...jobs.values()].filter((j) => !flowId || j.flowId === flowId).sort((a, b) => b.createdAt - a.createdAt)
export const activeJobFor = (flowId: string) => {
  const id = activeByFlow.get(flowId)
  return id ? jobs.get(id) : undefined
}
export function cancelJob(id: string) {
  const j = jobs.get(id)
  if (!j) return false
  j.ctrl.abort()
  return true
}

/** Wait for a job to finish, up to `ms`. */
export async function waitFor(job: Job, ms: number) {
  await Promise.race([job.done, new Promise((r) => setTimeout(r, ms))])
}

/** At server start no job survives: close every generation still marked running in any flow. */
/**
 * Turn orphaned "running" generations into Interrupted errors. Generations owned by another live server
 * process (two dev servers on one .flows folder) are left alone. At startup ownerless ones (old files,
 * tab-local runs) are swept too; the periodic sweep only touches generations whose owner process died.
 * `busy` = node ids this process is still working on (headless jobs + editor runs).
 */
export function sweepInterrupted(o: { startup?: boolean; busy?: Set<string> } = {}) {
  const busy = new Set(o.busy ?? [])
  for (const j of jobs.values()) if (j.status === 'running') for (const n of j.nodes) if (n.status === 'running' || n.status === 'pending') busy.add(n.nodeId)
  const keep = (g: { owner?: GenOwner }) =>
    g.owner ? (g.owner.pid === process.pid ? false : pidAlive(g.owner.pid)) : !o.startup
  for (const f of listFlows()) {
    if (!f) continue
    try {
      const doc = loadFlow(f.id)
      if (!doc) continue
      const n = markInterrupted(doc, busy, keep)
      if (n) {
        saveFlow(doc)
        console.log(`[flows] ${f.id}: ${n} interrupted generation(s) marked as error`)
      }
    } catch (e) {
      console.warn(`[flows] sweep ${f.id} failed:`, e)
    }
  }
}
