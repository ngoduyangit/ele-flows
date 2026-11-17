/**
 * Real backend wiring: flows are stored on the local server; running a node turns it into an
 * /api/run request (logic shared with the headless runner in src/shared/runRequest.ts).
 */
import { nanoid } from 'nanoid'
import { setFlowApi } from './api'
import { buildRunRequest, contextFor } from '../shared/runRequest'
import type { FlowDocument, Generation } from './types'

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j as any).error ?? (j as any).errors?.join('; ') ?? `HTTP ${r.status}`)
  return j as T
}

/** One-time copy of flows that only exist in this browser's localStorage up to the server. */
export async function migrateLocalFlows() {
  const MARK = 'flows:migrated-to-server'
  let local: Record<string, FlowDocument> = {}
  try {
    if (localStorage.getItem(MARK)) return
    local = JSON.parse(localStorage.getItem('flows:v1') || '{}')
  } catch {
    return
  }
  const onServer = new Set((await json<{ id: string }[]>('/api/flows')).map((f) => f.id))
  for (const f of Object.values(local)) {
    if (!f?.id || onServer.has(f.id)) continue
    await json(`/api/flows/${f.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
  }
  try {
    localStorage.setItem(MARK, String(Date.now())) // localStorage copy is kept as a backup
  } catch {
    /* ignore */
  }
}

setFlowApi({
  // flows live on the local server (.flows/flows) so other projects can create them via the API
  listFlows: () => json('/api/flows'),
  async loadFlow(id) {
    const r = await fetch(`/api/flows/${encodeURIComponent(id)}`)
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  },
  async saveFlow(flow) {
    await json(`/api/flows/${encodeURIComponent(flow.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flow) })
  },
  async deleteFlow(id) {
    await json(`/api/flows/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  async runNode(ctx) {
    const req = buildRunRequest(contextFor(ctx.node, ctx.nodes, ctx.edges as any))
    if ('passthrough' in req) return { id: nanoid(20), status: 'done', ...(req.passthrough as object), createdAt: Date.now() } as Generation
    const track = ctx.flowId && ctx.genId ? { flowId: ctx.flowId, nodeId: ctx.node.id, genId: ctx.genId } : undefined
    const r = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...req, track }), signal: ctx.signal })
    const j = await r.json().catch(() => ({ error: r.statusText }))
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
    return { id: nanoid(20), status: 'done', text: j.text, url: j.url, createdAt: Date.now() }
  },
  cancelRun(genId) {
    void fetch('/api/run/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ genId }) }).catch(() => {})
  },
  async uploadAsset(file) {
    const r = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type)}`, { method: 'POST', body: file })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? 'Upload failed')
    return { content_asset_id: j.url, url: j.url, mimeType: file.type }
  },
})
