import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import { nanoid } from 'nanoid'
import { runDag } from '../shared/dag'
import { create } from 'zustand'
import { api } from '../lib/api'
import { CATALOG, getInputPort, getOutputType, getPorts, newNodeId, type CatalogItem } from '../lib/registry'
import type { BaseNodeData, FlowDocument, FlowEdge, FlowNode, Generation } from '../lib/types'

export type Tool = 'select' | 'hand' | 'comment'
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error'

interface Snapshot {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

/** Pending "connection dropped on empty canvas" – opens the contextual Add-node menu. */
export interface PendingConnection {
  nodeId: string
  handleId: string | null
  handleType: 'source' | 'target'
  /** Flow-space position to place the new node. */
  flowPosition: XYPosition
  /** Screen position for the menu. */
  screen: { x: number; y: number }
}

interface FlowState {
  flowId: string
  name: string
  createdAt: number
  /** externalEditAt of the version this tab loaded (see server PUT). */
  externalEditAt?: number
  nodes: FlowNode[]
  edges: FlowEdge[]
  tool: Tool
  saveState: SaveState
  past: Snapshot[]
  future: Snapshot[]
  clipboard: Snapshot | null
  structureOpen: boolean
  pendingConnection: PendingConnection | null
  addMenuOpen: boolean
  quickActionsOpen: boolean
  settingsOpen: boolean
  /** short status line shown bottom-center */
  notice: { text: string; error?: boolean; busy?: boolean } | null
  renamingNodeId: string | null
  running: Record<string, AbortController>
  /** Center of the current viewport in flow coordinates – kept in sync by the canvas. */
  viewportCenter: XYPosition
  zoom: number

  load(flow: FlowDocument): void
  toDocument(): FlowDocument
  setName(name: string): void
  setTool(tool: Tool): void
  onNodesChange(changes: NodeChange<FlowNode>[]): void
  onEdgesChange(changes: EdgeChange<FlowEdge>[]): void
  onConnect(c: Connection): void
  isValidConnection(c: Connection | FlowEdge): boolean
  snapshot(): void
  undo(): void
  redo(): void
  addNode(item: CatalogItem, opts?: { position?: XYPosition; connect?: PendingConnection | null }): string | null
  addRawNode(node: Omit<FlowNode, 'id'> & { id?: string }, connect?: PendingConnection | null): string
  /** Add several nodes + edges as one undo step (selection is cleared). */
  addGraph(nodes: FlowNode[], edges: FlowEdge[]): void
  /** Pull in results written by a headless (API) run without touching local edits. */
  mergeServerGenerations(doc: FlowDocument): void
  updateNodeData(id: string, patch: Partial<BaseNodeData> | ((d: any) => any), opts?: { history?: boolean }): void
  deleteNodes(ids: string[]): void
  deleteSelection(): void
  duplicate(ids: string[]): void
  copy(ids: string[]): void
  paste(at?: XYPosition): void
  selectOnly(ids: string[]): void
  runNode(id: string): Promise<void>
  runFrom(id: string): Promise<void>
  runUpTo(id: string): Promise<void>
  /** Run the whole flow in dependency order (by default only nodes without an output). */
  runAll(onlyMissing?: boolean): Promise<void>
  /** Auto-arrange nodes in dependency columns without overlaps. */
  tidyUp(): void
  cancelRun(id: string): void
  deleteGeneration(id: string): void
  setStructureOpen(v: boolean): void
  setPendingConnection(p: PendingConnection | null): void
  setAddMenuOpen(v: boolean): void
  setQuickActionsOpen(v: boolean): void
  setSettingsOpen(v: boolean): void
  setNotice(v: FlowState['notice']): void
  setRenaming(id: string | null): void
  setViewportInfo(center: XYPosition, zoom: number): void
}

const clone = <T>(v: T): T => structuredClone(v)
const strip = (nodes: FlowNode[]) => nodes.map(({ selected: _s, dragging: _d, ...n }) => n as FlowNode)

let lastDataSnapshotAt = 0

export const useFlow = create<FlowState>((set, get) => ({
  flowId: '',
  name: 'Untitled flow',
  createdAt: Date.now(),
  nodes: [],
  edges: [],
  tool: 'select',
  saveState: 'saved',
  past: [],
  future: [],
  clipboard: null,
  structureOpen: false,
  pendingConnection: null,
  addMenuOpen: false,
  quickActionsOpen: false,
  settingsOpen: false,
  notice: null,
  renamingNodeId: null,
  running: {},
  viewportCenter: { x: 0, y: 0 },
  zoom: 1,

  load(flow) {
    set({
      flowId: flow.id,
      name: flow.name,
      createdAt: flow.createdAt,
      externalEditAt: flow.externalEditAt,
      nodes: flow.nodes.map(({ width: _w, height: _h, ...n }) => ({ ...n, selected: false }) as FlowNode),
      edges: flow.edges.map((e) => ({ ...e, type: 'dataflow' })),
      past: [],
      future: [],
      saveState: 'saved',
    })
  },

  toDocument() {
    const s = get()
    return {
      id: s.flowId,
      name: s.name,
      nodes: strip(s.nodes),
      edges: s.edges.map(({ selected: _s, ...e }) => e),
      createdAt: s.createdAt,
      externalEditAt: s.externalEditAt,
      updatedAt: Date.now(),
    }
  },

  setName(name) {
    set({ name })
  },
  setTool(tool) {
    set({ tool })
  },

  onNodesChange(changes) {
    if (changes.some((c) => c.type === 'remove')) get().snapshot()
    set({ nodes: applyNodeChanges(changes, get().nodes) })
  },
  onEdgesChange(changes) {
    if (changes.some((c) => c.type === 'remove')) get().snapshot()
    set({ edges: applyEdgeChanges(changes, get().edges) })
  },

  isValidConnection(c) {
    if (c.source === c.target) return false
    const { nodes, edges } = get()
    const src = nodes.find((n) => n.id === c.source)
    const tgt = nodes.find((n) => n.id === c.target)
    const outType = getOutputType(src)
    const port = getInputPort(tgt, c.targetHandle)
    if (!outType || !port || port.type !== outType) return false
    // no duplicates
    if (edges.some((e) => e.source === c.source && e.target === c.target && e.targetHandle === c.targetHandle)) return false
    // no cycles
    const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
      if (from === to) return true
      if (seen.has(from)) return false
      seen.add(from)
      return edges.filter((e) => e.source === from).some((e) => reaches(e.target, to, seen))
    }
    return !reaches(c.target, c.source)
  },

  onConnect(c) {
    if (!get().isValidConnection(c)) return
    get().snapshot()
    const tgt = get().nodes.find((n) => n.id === c.target)
    const port = getInputPort(tgt, c.targetHandle)
    let edges = get().edges
    if (port && !port.multiple) edges = edges.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle))
    const id = `edge-${c.source}-${c.target}-${c.targetHandle}`
    set({ edges: addEdge({ ...c, id, type: 'dataflow', sourceHandle: c.sourceHandle ?? 'output' }, edges) })
  },

  snapshot() {
    const { nodes, edges, past } = get()
    set({ past: [...past.slice(-99), { nodes: clone(strip(nodes)), edges: clone(edges) }], future: [], saveState: 'unsaved' })
  },
  undo() {
    const { past, future, nodes, edges } = get()
    const prev = past[past.length - 1]
    if (!prev) return
    set({
      past: past.slice(0, -1),
      future: [{ nodes: clone(strip(nodes)), edges: clone(edges) }, ...future],
      nodes: prev.nodes,
      edges: prev.edges,
      saveState: 'unsaved',
    })
  },
  redo() {
    const { past, future, nodes, edges } = get()
    const next = future[0]
    if (!next) return
    set({
      future: future.slice(1),
      past: [...past, { nodes: clone(strip(nodes)), edges: clone(edges) }],
      nodes: next.nodes,
      edges: next.edges,
      saveState: 'unsaved',
    })
  },

  addNode(item, opts = {}) {
    if (!item.create) return null
    const { type, data, width } = item.create()
    const pos = opts.position ?? get().viewportCenter
    const w = width ?? 400
    const position = opts.position ? pos : { x: pos.x - w / 2, y: pos.y - 150 }
    return get().addRawNode({ type, data, position: freeSpot(get().nodes, position, w) }, opts.connect)
  },

  addRawNode(raw, connect) {
    get().snapshot()
    const id = raw.id ?? newNodeId()
    const node = { ...raw, id, selected: true } as FlowNode
    let edges = get().edges
    if (connect) {
      const other = get().nodes.find((n) => n.id === connect.nodeId)
      if (connect.handleType === 'source') {
        // dragged from an output → connect into the first compatible input of the new node
        const outType = getOutputType(other)
        const port = getPorts(node).inputs.find((p) => p.type === outType && p.zone !== 'prompt') ??
          getPorts(node).inputs.find((p) => p.type === outType)
        if (port)
          edges = [...edges, { id: `edge-${connect.nodeId}-${id}-${port.id}`, source: connect.nodeId, sourceHandle: 'output', target: id, targetHandle: port.id, type: 'dataflow' }]
      } else {
        // dragged from an input → new node feeds it
        if (getOutputType(node) === getInputPort(other, connect.handleId)?.type)
          edges = [...edges, { id: `edge-${id}-${connect.nodeId}-${connect.handleId}`, source: id, sourceHandle: 'output', target: connect.nodeId, targetHandle: connect.handleId, type: 'dataflow' }]
      }
    }
    set({ nodes: [...get().nodes.map((n) => ({ ...n, selected: false })), node], edges, pendingConnection: null })
    return id
  },

  addGraph(newNodes, newEdges) {
    if (!newNodes.length && !newEdges.length) return
    get().snapshot()
    set({
      // nothing ends up selected: edges only light up for a node the user clicks
      nodes: [...get().nodes.map((n) => ({ ...n, selected: false })), ...newNodes.map((n) => ({ ...n, selected: false }))],
      edges: [...get().edges, ...newEdges.map((e) => ({ ...e, type: 'dataflow' }))],
    })
  },

  mergeServerGenerations(doc) {
    let changed = false
    const nodes = get().nodes.map((n0) => {
      const remote = doc.nodes.find((x) => x.id === n0.id)
      let n = n0
      // inputs overridden through the API (newer than what the editor holds)
      const ra = (remote?.data as any)?.apiUpdatedAt ?? 0
      if (remote && ra > ((n.data as any).apiUpdatedAt ?? 0)) {
        const rd = remote.data as any
        const d: any = { ...n.data, apiUpdatedAt: ra }
        if ('text' in rd) d.text = rd.text
        if ('assetReference' in rd) d.assetReference = rd.assetReference
        if (rd.parameters && d.parameters) d.parameters = { ...d.parameters, prompt: rd.parameters.prompt }
        n = { ...n, data: d }
        changed = true
      }
      const remoteGens = (remote?.data.generations ?? []).filter((g: any) => g.source === 'api' || g.source === 'api-synced')
      if (!remoteGens.length) return n
      const local = n.data.generations ?? []
      let gens = local
      let active = n.data.activeGenerationId
      for (const g of remoteGens) {
        const i = gens.findIndex((x) => x.id === g.id)
        const synced = { ...g, source: 'api-synced' } as any
        if (i < 0) {
          gens = [...gens, synced]
          active = g.id
          changed = true
        } else if (gens[i].status !== g.status || gens[i].url !== g.url || gens[i].text !== g.text || (gens[i] as any).cost !== g.cost) {
          gens = gens.map((x, j) => (j === i ? synced : x))
          changed = true
        }
      }
      return gens === local ? n : { ...n, data: { ...n.data, generations: gens, activeGenerationId: active } }
    })
    if (changed) set({ nodes, saveState: 'unsaved' })
  },

  updateNodeData(id, patch, opts = {}) {
    const now = Date.now()
    if (opts.history !== false && now - lastDataSnapshotAt > 800) get().snapshot()
    lastDataSnapshotAt = now
    set({
      saveState: 'unsaved',
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: typeof patch === 'function' ? patch(n.data) : { ...n.data, ...patch } } : n,
      ),
    })
  },

  deleteNodes(ids) {
    if (!ids.length) return
    get().snapshot()
    const s = new Set(ids)
    ids.forEach((id) => get().cancelRun(id))
    set({
      nodes: get().nodes.filter((n) => !s.has(n.id)),
      edges: get().edges.filter((e) => !s.has(e.source) && !s.has(e.target)),
    })
  },
  deleteSelection() {
    const nodes = get().nodes.filter((n) => n.selected).map((n) => n.id)
    const edges = get().edges.filter((e) => e.selected).map((e) => e.id)
    if (!nodes.length && !edges.length) return
    get().snapshot()
    const s = new Set(nodes)
    const es = new Set(edges)
    set({
      nodes: get().nodes.filter((n) => !s.has(n.id)),
      edges: get().edges.filter((e) => !es.has(e.id) && !s.has(e.source) && !s.has(e.target)),
    })
  },

  copy(ids) {
    const s = new Set(ids)
    const nodes = get().nodes.filter((n) => s.has(n.id))
    const edges = get().edges.filter((e) => s.has(e.source) && s.has(e.target))
    set({ clipboard: { nodes: clone(strip(nodes)), edges: clone(edges) } })
  },
  paste(at) {
    const cb = get().clipboard
    if (!cb || !cb.nodes.length) return
    get().snapshot()
    const minX = Math.min(...cb.nodes.map((n) => n.position.x))
    const minY = Math.min(...cb.nodes.map((n) => n.position.y))
    const target = at ?? { x: minX + 40, y: minY + 40 }
    const map = new Map<string, string>()
    const nodes = cb.nodes.map((n) => {
      const id = newNodeId()
      map.set(n.id, id)
      return {
        ...clone(n),
        id,
        selected: true,
        position: { x: target.x + (n.position.x - minX), y: target.y + (n.position.y - minY) },
        data: { ...clone(n.data), generations: [], activeGenerationId: null },
      }
    })
    const edges = cb.edges.map((e) => ({
      ...e,
      id: `edge-${map.get(e.source)}-${map.get(e.target)}-${e.targetHandle}`,
      source: map.get(e.source)!,
      target: map.get(e.target)!,
    }))
    set({ nodes: [...get().nodes.map((n) => ({ ...n, selected: false })), ...nodes], edges: [...get().edges, ...edges] })
    // shift clipboard so repeated pastes cascade
    set({ clipboard: { nodes: cb.nodes.map((n) => ({ ...n, position: { x: n.position.x + 40, y: n.position.y + 40 } })), edges: cb.edges } })
  },
  duplicate(ids) {
    const saved = get().clipboard
    get().copy(ids)
    get().paste()
    set({ clipboard: saved })
  },

  selectOnly(ids) {
    const s = new Set(ids)
    set({ nodes: get().nodes.map((n) => ({ ...n, selected: s.has(n.id) })), edges: get().edges.map((e) => ({ ...e, selected: false })) })
  },

  async runNode(id) {
    const node = get().nodes.find((n) => n.id === id)
    if (!node || node.type === 'comment') return
    get().cancelRun(id)
    const ctrl = new AbortController()
    const genId = nanoid(20)
    ;(ctrl as any).genId = genId // cancelRun stops the server-side run too
    const pending: Generation = { id: genId, status: 'running', createdAt: Date.now() }
    set({ running: { ...get().running, [id]: ctrl } })
    get().updateNodeData(
      id,
      (d: BaseNodeData) => ({ ...d, generations: [...(d.generations ?? []), pending], activeGenerationId: genId }),
      { history: false },
    )
    const inputs: Record<string, FlowNode[]> = {}
    for (const e of get().edges.filter((e) => e.target === id)) {
      const src = get().nodes.find((n) => n.id === e.source)
      if (src) (inputs[e.targetHandle ?? 'input'] ??= []).push(src)
    }
    try {
      const result = await api.runNode({ node, inputs, nodes: get().nodes, edges: get().edges, signal: ctrl.signal, flowId: get().flowId || undefined, genId })
      get().updateNodeData(
        id,
        (d: BaseNodeData) => ({
          ...d,
          generations: (d.generations ?? []).map((g) => (g.id === genId ? { ...result, id: genId } : g)),
          activeGenerationId: genId,
        }),
        { history: false },
      )
    } catch (err: any) {
      const aborted = err?.name === 'AbortError'
      get().updateNodeData(
        id,
        (d: BaseNodeData) => ({
          ...d,
          generations: aborted
            ? (d.generations ?? []).filter((g) => g.id !== genId)
            : (d.generations ?? []).map((g) => (g.id === genId ? { ...g, status: 'error', error: String(err?.message ?? err) } : g)),
          activeGenerationId: aborted ? (d.generations ?? []).filter((g) => g.id !== genId).at(-1)?.id ?? null : genId,
        }),
        { history: false },
      )
    } finally {
      const { [id]: _drop, ...rest } = get().running
      set({ running: rest })
    }
  },
  async runFrom(id) {
    // this node + everything downstream, plus any upstream input that has no output yet
    const targets = downstream(id, get().edges)
    const needed = new Set(targets)
    for (const t of targets) for (const a of upstream(t, get().edges)) if (!hasOutput(get().nodes.find((n) => n.id === a))) needed.add(a)
    await runSequence(topoOrder(get().nodes, get().edges, needed), get, (nid) => targets.has(nid))
  },
  async runUpTo(id) {
    await runSequence(topoOrder(get().nodes, get().edges, upstream(id, get().edges)), get, () => true)
  },
  async runAll(onlyMissing = true) {
    const all = new Set(get().nodes.map((n) => n.id))
    await runSequence(topoOrder(get().nodes, get().edges, all), get, (nid) => !onlyMissing || !hasOutput(get().nodes.find((n) => n.id === nid)))
  },
  tidyUp() {
    const { nodes, edges } = get()
    const placed = nodes.filter((n) => n.type !== 'comment')
    if (!placed.length) return
    const ids = new Set(placed.map((n) => n.id))
    const preds = new Map<string, string[]>()
    const succs = new Map<string, string[]>()
    for (const e of edges) {
      if (!ids.has(e.source) || !ids.has(e.target)) continue
      ;(preds.get(e.target) ?? preds.set(e.target, []).get(e.target)!).push(e.source)
      ;(succs.get(e.source) ?? succs.set(e.source, []).get(e.source)!).push(e.target)
    }
    const order = topoOrder(nodes, edges, ids)
    const col = new Map<string, number>()
    for (const id of order) col.set(id, Math.max(0, ...(preds.get(id) ?? []).map((p) => (col.get(p) ?? 0) + 1)))
    // pull pure inputs (no predecessors) right next to their first consumer
    for (const id of [...order].reverse()) {
      if ((preds.get(id) ?? []).length || !(succs.get(id) ?? []).length) continue
      col.set(id, Math.max(0, Math.min(...succs.get(id)!.map((c) => col.get(c)!)) - 1))
    }
    const size = (n: FlowNode) => ({ w: n.measured?.width ?? 400, h: n.measured?.height ?? 320 })
    const columns: FlowNode[][] = []
    for (const n of placed) (columns[col.get(n.id) ?? 0] ??= []).push(n)
    const GAP_X = 140
    const GAP_Y = 110 // room for the toolbar that hangs below each node
    const pos = new Map<string, XYPosition>()
    let x = 0
    for (const column of columns) {
      if (!column) continue
      // order by the average y of already-placed predecessors (fewer crossings), else by current y
      const key = (n: FlowNode) => {
        const ys = (preds.get(n.id) ?? []).map((p) => pos.get(p)).filter(Boolean) as XYPosition[]
        return ys.length ? ys.reduce((a, b) => a + b.y, 0) / ys.length : n.position.y
      }
      // numbered scenes ("S01 Still", "Shot 03", "Clip S05") keep story order: shared refs would scramble them;
      // unnumbered nodes (sheets, sets…) go first, ordered to reduce crossings
      const seq = (n: FlowNode) => {
        const m = /(?:^|[^a-z0-9])(?:s|shot|scene)?\s*#?\s*(\d{1,3})(?![\d.]*s\b|x\d)/i.exec(String(n.data.label ?? ''))
        return m ? Number(m[1]) : Infinity
      }
      column.sort((a, b) => {
        const sa = seq(a)
        const sb = seq(b)
        if (sa !== sb) return sa === Infinity ? -1 : sb === Infinity ? 1 : sa - sb
        return key(a) - key(b)
      })
      const total = column.reduce((a, n) => a + size(n).h, 0) + GAP_Y * (column.length - 1)
      let y = -total / 2
      for (const n of column) {
        pos.set(n.id, { x, y })
        y += size(n).h + GAP_Y
      }
      x += Math.max(...column.map((n) => size(n).w)) + GAP_X
    }
    get().snapshot()
    set({ nodes: nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n)) })
  },
  cancelRun(id) {
    const ctrl = get().running[id]
    if (!ctrl) {
      // reloaded page: no local request, but the server may still be running this node's generation
      const d: any = get().nodes.find((n) => n.id === id)?.data
      const g = d?.generations?.find((x: any) => x.id === d.activeGenerationId && x.status === 'running')
      if (g) {
        api.cancelRun?.(g.id)
        get().updateNodeData(id, (dd: any) => {
          const gens = dd.generations.filter((x: any) => x.id !== g.id)
          return { ...dd, generations: gens, activeGenerationId: gens.at(-1)?.id ?? null }
        }, { history: false })
      }
      return
    }
    const genId = (ctrl as any).genId as string | undefined
    if (genId) api.cancelRun?.(genId)
    ctrl.abort()
  },
  deleteGeneration(id) {
    get().updateNodeData(id, (d: BaseNodeData) => {
      const gens = (d.generations ?? []).filter((g) => g.id !== d.activeGenerationId)
      return { ...d, generations: gens, activeGenerationId: gens.at(-1)?.id ?? null }
    })
  },

  setStructureOpen(v) {
    set({ structureOpen: v })
  },
  setPendingConnection(p) {
    set({ pendingConnection: p })
  },
  setAddMenuOpen(v) {
    set({ addMenuOpen: v })
  },
  setQuickActionsOpen(v) {
    set({ quickActionsOpen: v })
  },
  setSettingsOpen(v) {
    set({ settingsOpen: v })
  },
  setNotice(v) {
    set({ notice: v })
  },
  setRenaming(id) {
    set({ renamingNodeId: id })
  },
  setViewportInfo(center, zoom) {
    set({ viewportCenter: center, zoom })
  },
}))

/** First position near `p` where a node of width `w` doesn't overlap existing nodes. */
export function freeSpot(nodes: FlowNode[], p: XYPosition, w: number, h = 420): XYPosition {
  const boxes = nodes.map((n) => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? 400, h: (n.measured?.height ?? 320) + 70 }))
  const hits = (q: XYPosition) => boxes.some((b) => q.x < b.x + b.w + 24 && q.x + w + 24 > b.x && q.y < b.y + b.h && q.y + h > b.y)
  for (let i = 0; i < 24; i++) {
    const q = { x: p.x, y: p.y + i * 90 }
    if (!hits(q)) return q
  }
  const right = Math.max(...boxes.map((b) => b.x + b.w), p.x) + 120
  return { x: right, y: p.y }
}

const PASSIVE = ['image', 'video', 'text', 'comment']
function hasOutput(n: FlowNode | undefined): boolean {
  if (!n) return false
  if (PASSIVE.includes(n.type!)) return true
  return !!n.data.generations?.some((g) => g.status === 'done' && (g.url || g.text))
}
/**
 * Run nodes respecting dependencies, independent branches in parallel (up to RUN_CONCURRENCY –
 * Muse allows 4 concurrent jobs; the server queues anything beyond that). A node is (re)run when
 * `force(id)` says so, or when it has no output yet. After a failure no new node starts, so
 * downstream nodes don't run on missing inputs.
 */
async function runSequence(order: string[], get: () => FlowState, force: (id: string) => boolean) {
  const deps = (id: string) => get().edges.filter((e) => e.target === id).map((e) => e.source)
  await runDag(order, deps, async (id) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node || PASSIVE.includes(node.type!)) return true
    if (!force(id) && hasOutput(node)) return true
    await get().runNode(id)
    const last = get().nodes.find((n) => n.id === id)?.data.generations?.at(-1)
    return !!last && last.status === 'done'
  })
}

function downstream(id: string, edges: FlowEdge[]): Set<string> {
  const out = new Set([id])
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const e of edges) if (e.source === cur && !out.has(e.target)) out.add(e.target), stack.push(e.target)
  }
  return out
}
function upstream(id: string, edges: FlowEdge[]): Set<string> {
  const out = new Set([id])
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const e of edges) if (e.target === cur && !out.has(e.source)) out.add(e.source), stack.push(e.source)
  }
  return out
}
function topoOrder(nodes: FlowNode[], edges: FlowEdge[], subset: Set<string>): string[] {
  const indeg = new Map<string, number>()
  subset.forEach((id) => indeg.set(id, 0))
  edges.forEach((e) => subset.has(e.source) && subset.has(e.target) && indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1))
  const q = [...subset].filter((id) => !indeg.get(id))
  const order: string[] = []
  while (q.length) {
    const id = q.shift()!
    order.push(id)
    edges.forEach((e) => {
      if (e.source === id && subset.has(e.target)) {
        indeg.set(e.target, indeg.get(e.target)! - 1)
        if (!indeg.get(e.target)) q.push(e.target)
      }
    })
  }
  return order.filter((id) => nodes.some((n) => n.id === id))
}

export const catalogByKey = (key: string) => CATALOG.find((c) => c.key === key)

/** Active (selected) generation of a node, if any. */
export function activeGeneration(d: BaseNodeData): Generation | undefined {
  return d.generations?.find((g) => g.id === d.activeGenerationId) ?? d.generations?.at(-1)
}
