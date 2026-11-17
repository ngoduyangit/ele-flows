/**
 * Shared, framework-free flow schema: ports per node type, node defaults and the
 * "workflow spec" → flow document builder. Used by the UI and by the server API so that
 * other projects can create workflows with a short JSON spec.
 *
 * Keep this file free of React / DOM imports (it runs in Node too).
 */
import { nanoid } from 'nanoid'

/* ================================================================== */
/* Core types                                                          */
/* ================================================================== */

export type PortType = 'text' | 'image' | 'video'

export interface PortDef {
  id: string
  type: PortType
  label: string
  optional?: boolean
  /** Accepts more than one edge. */
  multiple?: boolean
  /** Where the handle sits: in the media area (top) or next to the prompt (bottom). */
  zone?: 'media' | 'prompt'
}

export interface Doc {
  type: 'doc'
  content?: any[]
}

export interface FlowNodeJSON {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, any>
}
export interface FlowEdgeJSON {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
  type?: string
}
export interface FlowDocumentJSON {
  id: string
  name: string
  description?: string
  nodes: FlowNodeJSON[]
  edges: FlowEdgeJSON[]
  createdAt: number
  updatedAt: number
  /** Ask the editor to auto-arrange with measured sizes on first open. */
  autoLayout?: boolean
  /** Last time the flow was replaced from outside the editor (API/script PUT); a stale editor save is refused. */
  externalEditAt?: number
}

export const newNodeId = () => nanoid(20)
export const emptyDoc = (text?: string): Doc => ({
  type: 'doc',
  content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }],
})

/* ================================================================== */
/* Ports                                                               */
/* ================================================================== */

export const PROCESS_PORTS: Record<string, { inputs: PortDef[]; output: PortType; modelId: string; label: string; hasPrompt?: boolean }> = {
  // local ffmpeg, no API: grab a frame of a clip to chain the next shot from it
  'last-frame': { label: 'Extract frame', modelId: 'ffmpeg', output: 'image', inputs: [{ id: 'video', type: 'video', label: 'Video', zone: 'media' }] },
}

/** Input ports + output type of a node, given its type and data. */
export function portsFor(type: string | undefined, d: Record<string, any> = {}): { inputs: PortDef[]; output: PortType | null } {
  switch (type) {
    case 'text':
      return { inputs: [], output: 'text' }
    case 'content-generation': {
      const modality = d.parameters?.modality ?? 'image'
      if (modality === 'video')
        return {
          inputs: [
            { id: 'startFrame', type: 'image', label: 'Start frame', zone: 'media' },
            { id: 'endFrame', type: 'image', label: 'End frame', zone: 'media' },
            { id: 'referenceImages', type: 'image', label: 'Reference images', optional: true, multiple: true, zone: 'media' },
            { id: 'prompt', type: 'text', label: 'Prompt', multiple: true, zone: 'prompt' },
          ],
          output: 'video',
        }
      return {
        inputs: [
          { id: 'referenceImages', type: 'image', label: 'Reference images', multiple: true, zone: 'media' },
          { id: 'prompt', type: 'text', label: 'Prompt', multiple: true, zone: 'prompt' },
        ],
        output: 'image',
      }
    }
    case 'image':
      return { inputs: [], output: 'image' }
    case 'video':
      return { inputs: [], output: 'video' }
    case 'process': {
      const k = PROCESS_PORTS[d.kind as string]
      return k ? { inputs: k.inputs, output: k.output } : { inputs: [], output: null }
    }
    default:
      return { inputs: [], output: null }
  }
}

/* ================================================================== */
/* Node defaults                                                       */
/* ================================================================== */

export const baseContentGen = (modality: 'image' | 'video', label: string, extra: Record<string, unknown> = {}) => ({
  label,
  parameters: {
    prompt: emptyDoc(),
    modality,
    aspectRatio: '16:9',
    referenceImages: [],
    // Muse renders 10, 20, 30 or 60 s videos
    video: { modelId: 'muse', durationSecs: 10 },
    image: { modelId: 'muse' },
    ...extra,
  },
  templateOutput: null,
})

/* ================================================================== */
/* Workflow spec                                                       */
/* ================================================================== */

/** Ref to another spec node by key (or a list of keys). */
type Ref = string
type Refs = string | string[]

export interface SpecNode {
  /** Unique key inside the spec – used for references and `@key` mentions. */
  key: string
  /** Node kind, see specKinds(). */
  kind: string
  label?: string
  /** Optional fixed position; omit for auto layout. */
  position?: { x: number; y: number }
  /** Prompt / text. `@key` mentions reference other nodes (and create the edge). */
  prompt?: string
  text?: string
  /** 1:1, 16:9, 9:16, 3:4 or 4:3 for images; videos are 16:9 or 9:16. */
  aspectRatio?: string
  /** Video length in seconds (Muse: 10, 20, 30 or 60 – other values snap to the nearest). */
  duration?: number
  /** Reference images (image-generation, video-generation). Muse uses at most 3; extras are tiled into a sheet. */
  refs?: Refs
  /** Video: image shown at the start / end (sent to Muse as a labelled reference). */
  startFrame?: Ref
  endFrame?: Ref
  /** `last-frame`: which frame to extract – "last" (default, for chaining), "first" or "time" (the frame at `at` seconds). */
  which?: 'first' | 'last' | 'time'
  /** `last-frame` with which "time": position in seconds from the start of the video. */
  at?: number
  /** Generic: connect keys into any input port id, e.g. { "video": "clip1" }. */
  inputs?: Record<string, Refs>
  /** Asset nodes (image | video): file URL (http(s), data:, or /api/media/...). */
  url?: string
  mimeType?: string
}

export interface WorkflowSpec {
  /** Optional stable id (letters, digits, - and _). Generated if omitted. */
  id?: string
  name: string
  description?: string
  /** Defaults applied to nodes that don't set them. */
  defaults?: { aspectRatio?: string }
  nodes: SpecNode[]
  /** Extra explicit connections. */
  edges?: { from: string; to: string; port?: string }[]
}

export interface SpecKindInfo {
  kind: string
  nodeType: string
  description: string
  output: PortType | null
  inputs: PortDef[]
  fields: string[]
}

const ASSET_KINDS = ['image', 'video'] as const
const GEN_KINDS: Record<string, { modality: 'image' | 'video'; label: string }> = {
  'image-generation': { modality: 'image', label: 'Image' },
  'video-generation': { modality: 'video', label: 'Video' },
}

/** Every kind a spec can use, with its ports and accepted fields (served at GET /api/spec/kinds). */
export function specKinds(): SpecKindInfo[] {
  const common = ['key', 'kind', 'label', 'position']
  return [
    { kind: 'text', nodeType: 'text', description: 'Static text / brief', ...portsFor('text'), fields: [...common, 'text'] },
    ...ASSET_KINDS.map((k) => ({ kind: k, nodeType: k, description: `Uploaded ${k} asset`, ...portsFor(k), fields: [...common, 'url', 'mimeType'] })),
    { kind: 'image-generation', nodeType: 'content-generation', description: 'Text/reference images → image (Muse)', ...portsFor('content-generation', { parameters: { modality: 'image' } }), fields: [...common, 'prompt', 'aspectRatio', 'refs'] },
    { kind: 'video-generation', nodeType: 'content-generation', description: 'Text/frames/reference images → video (Muse)', ...portsFor('content-generation', { parameters: { modality: 'video' } }), fields: [...common, 'prompt', 'aspectRatio', 'duration', 'startFrame', 'endFrame', 'refs'] },
    { kind: 'last-frame', nodeType: 'process', description: 'Extract a frame from a video (local ffmpeg) – chain the next shot from it', inputs: PROCESS_PORTS['last-frame'].inputs, output: 'image', fields: [...common, 'inputs', 'which', 'at'] },
    { kind: 'comment', nodeType: 'comment', description: 'Sticky comment (no ports)', inputs: [], output: null, fields: [...common, 'text'] },
  ]
}

export interface BuildResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  flow?: FlowDocumentJSON
}

const asList = (r: Refs | undefined): string[] => (r == null ? [] : Array.isArray(r) ? r : [r])
const MENTION = /@([A-Za-z0-9_-]+)/g

/** Convert a spec into a full flow document (ids, defaults, edges, mentions, layout). */
export function buildFlowFromSpec(spec: WorkflowSpec): BuildResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (!spec || typeof spec !== 'object') return { ok: false, errors: ['Spec must be an object'], warnings }
  if (!spec.name || typeof spec.name !== 'string') errors.push('name is required')
  if (spec.id && !/^[A-Za-z0-9_-]{3,64}$/.test(spec.id)) errors.push('id must be 3–64 chars of letters, digits, - or _')
  if (!Array.isArray(spec.nodes) || !spec.nodes.length) errors.push('nodes must be a non-empty array')
  if (errors.length) return { ok: false, errors, warnings }

  const kinds = new Map(specKinds().map((k) => [k.kind, k]))
  const byKey = new Map<string, { spec: SpecNode; node: FlowNodeJSON }>()
  const d = spec.defaults ?? {}

  // 1) nodes
  spec.nodes.forEach((s, i) => {
    const where = `nodes[${i}]${s?.key ? ` (${s.key})` : ''}`
    if (!s?.key || !/^[A-Za-z0-9_-]+$/.test(s.key)) return void errors.push(`${where}: key is required (letters, digits, - or _)`)
    if (byKey.has(s.key)) return void errors.push(`${where}: duplicate key`)
    const info = kinds.get(s.kind)
    if (!info) return void errors.push(`${where}: unknown kind "${s.kind}" (see GET /api/spec/kinds)`)
    const data = nodeDataFor(s, d, warnings, where)
    data.specKey = s.key // lets API callers address nodes by key (run inputs/outputs)
    byKey.set(s.key, { spec: s, node: { id: newNodeId(), type: info.nodeType, position: s.position ?? { x: 0, y: 0 }, data } })
  })
  if (errors.length) return { ok: false, errors, warnings }

  // 2) edges from shorthand fields, mentions and explicit list
  const edges: FlowEdgeJSON[] = []
  const seen = new Set<string>()
  const connect = (fromKey: string, toKey: string, port: string | undefined, where: string) => {
    const from = byKey.get(fromKey)
    const to = byKey.get(toKey)
    if (!from) return void errors.push(`${where}: unknown node key "${fromKey}"`)
    if (!to) return void errors.push(`${where}: unknown node key "${toKey}"`)
    const out = portsFor(from.node.type, from.node.data).output
    if (!out) return void errors.push(`${where}: "${fromKey}" has no output`)
    const inputs = portsFor(to.node.type, to.node.data).inputs
    const p = port ? inputs.find((x) => x.id === port) : inputs.find((x) => x.type === out && x.zone !== 'prompt') ?? inputs.find((x) => x.type === out)
    if (!p) return void errors.push(`${where}: "${toKey}" (${to.spec.kind}) has no ${port ? `port "${port}"` : `${out} input`} – ports: ${inputs.map((x) => `${x.id}:${x.type}`).join(', ') || 'none'}`)
    if (p.type !== out) return void errors.push(`${where}: "${fromKey}" outputs ${out} but port "${p.id}" of "${toKey}" takes ${p.type}`)
    const id = `edge-${from.node.id}-${to.node.id}-${p.id}`
    if (seen.has(id)) return
    seen.add(id)
    if (!p.multiple && edges.some((e) => e.target === to.node.id && e.targetHandle === p.id)) warnings.push(`${where}: port "${p.id}" of "${toKey}" takes one input – extra connection kept but only the first is used`)
    edges.push({ id, source: from.node.id, sourceHandle: 'output', target: to.node.id, targetHandle: p.id, type: 'dataflow' })
  }

  for (const { spec: s } of byKey.values()) {
    const w = `node "${s.key}"`
    for (const r of asList(s.refs)) connect(r, s.key, 'referenceImages', w)
    if (s.startFrame) connect(s.startFrame, s.key, 'startFrame', w)
    if (s.endFrame) connect(s.endFrame, s.key, 'endFrame', w)
    for (const [port, refs] of Object.entries(s.inputs ?? {})) for (const r of asList(refs)) connect(r, s.key, port, w)
  }
  for (const [i, e] of (spec.edges ?? []).entries()) connect(e.from, e.to, e.port, `edges[${i}]`)

  // 3) @mentions inside prompts / texts → prompt-tag chips (+ edge into the prompt port)
  for (const { spec: s, node } of byKey.values()) {
    const raw = s.prompt ?? (s.kind === 'text' ? s.text : undefined)
    if (raw == null) continue
    const mentioned = [...raw.matchAll(MENTION)].map((m) => m[1]).filter((k) => byKey.has(k) && k !== s.key)
    for (const k of mentioned) {
      const out = portsFor(byKey.get(k)!.node.type, byKey.get(k)!.node.data).output
      if (s.kind === 'text') {
        warnings.push(`node "${s.key}": text nodes have no inputs – "@${k}" kept as plain text`)
        continue
      }
      // already wired (refs / startFrame / inputs) → the mention is just a chip
      if (edges.some((e) => e.source === byKey.get(k)!.node.id && e.target === node.id)) continue
      const inputs = portsFor(node.type, node.data).inputs
      // a mentioned image is a reference, never silently the start frame
      const port = out === 'text' && inputs.some((p) => p.id === 'prompt') ? 'prompt' : out === 'image' && inputs.some((p) => p.id === 'referenceImages') ? 'referenceImages' : undefined
      connect(k, s.key, port, `node "${s.key}" @${k}`)
    }
    if (node.type === 'content-generation') node.data.parameters.prompt = mentionDoc(raw, byKey)
  }

  // cycles
  const ids = [...byKey.values()].map((x) => x.node.id)
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]))
  edges.forEach((e) => adj.get(e.source)!.push(e.target))
  const state = new Map<string, number>()
  const dfs = (v: string): boolean => {
    state.set(v, 1)
    for (const w of adj.get(v)!) {
      if (state.get(w) === 1) return true
      if (!state.get(w) && dfs(w)) return true
    }
    state.set(v, 2)
    return false
  }
  if (ids.some((v) => !state.get(v) && dfs(v))) errors.push('the graph has a cycle')
  if (errors.length) return { ok: false, errors, warnings }

  const nodes = [...byKey.values()].map((x) => x.node)
  const fixed = new Set(spec.nodes.filter((n) => n.position).map((n) => byKey.get(n.key)!.node.id))
  autoLayout(nodes, edges, fixed)
  const now = Date.now()
  return {
    ok: true,
    errors,
    warnings,
    flow: {
      id: spec.id ?? nanoid(20),
      name: spec.name,
      ...(spec.description ? { description: spec.description } : {}),
      nodes,
      edges,
      createdAt: now,
      updatedAt: now,
      autoLayout: fixed.size === 0,
    },
  }
}

function mentionDoc(text: string, byKey: Map<string, { spec: SpecNode; node: FlowNodeJSON }>): Doc {
  return mentionDocWith(text, (k) => byKey.get(k)?.node)
}

/** All `@key` mentions in a prompt (unique, in order of appearance). */
export function mentionKeys(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION)].map((m) => m[1]))]
}

/** Prompt text → rich-text doc, turning each `@key` that `resolve` finds into a node-reference chip; unknown `@words` stay text. */
export function mentionDocWith(text: string, resolve: (key: string) => FlowNodeJSON | undefined): Doc {
  const paragraphs = text.split('\n').map((line) => {
    const content: any[] = []
    let last = 0
    for (const m of line.matchAll(MENTION)) {
      const target = resolve(m[1])
      if (!target) continue
      if (m.index! > last) content.push({ type: 'text', text: line.slice(last, m.index) })
      content.push({ type: 'prompt-tag', attrs: { id: `node:${target.id}`, type: 'node-reference', label: target.data.label } })
      last = m.index! + m[0].length
    }
    if (last < line.length) content.push({ type: 'text', text: line.slice(last) })
    return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
  })
  return { type: 'doc', content: paragraphs }
}

function nodeDataFor(s: SpecNode, d: NonNullable<WorkflowSpec['defaults']>, warnings: string[], where: string): Record<string, any> {
  const label = s.label
  switch (s.kind) {
    case 'text':
      return { label: label ?? 'Text', text: emptyDoc(s.text ?? s.prompt ?? ''), allowedValues: null }
    case 'image':
    case 'video':
      if (!s.url) warnings.push(`${where}: no url – the node will ask for an upload`)
      return {
        label: label ?? s.kind[0].toUpperCase() + s.kind.slice(1),
        assetReference: s.url ? { content_asset_id: s.url, generation_id: null, previewUrl: s.url, mimeType: s.mimeType ?? null } : null,
        templateInput: null,
      }
    case 'image-generation':
    case 'video-generation': {
      const g = GEN_KINDS[s.kind]
      const data: any = baseContentGen(g.modality, label ?? g.label)
      const p = data.parameters
      p.aspectRatio = s.aspectRatio ?? d.aspectRatio ?? '16:9'
      if (g.modality === 'video' && s.duration) p.video.durationSecs = s.duration
      return data
    }
    case 'last-frame': {
      const which = s.which === 'first' ? { which: 'first' } : s.which === 'time' || s.at != null ? { which: 'time', at: Math.max(0, Number(s.at ?? 0)) } : {}
      const name = which.which === 'first' ? 'First frame' : which.which === 'time' ? `Frame @ ${(which as any).at}s` : 'Last frame'
      return { label: label ?? name, kind: 'last-frame', parameters: { modelId: 'ffmpeg', prompt: '', ...which }, templateOutput: null }
    }
    case 'comment':
      return { label: 'Comment', text: s.text ?? s.prompt ?? '', author: label ?? 'API', createdAt: Date.now() }
    default:
      throw new Error(`unknown kind ${s.kind}`)
  }
}

/* ================================================================== */
/* Layout (estimated sizes; the editor re-tidies with real sizes)     */
/* ================================================================== */

function aspectSize(a: string) {
  const [w, h] = (a ?? '16:9').split(':').map(Number)
  const r = w && h ? w / h : 16 / 9
  if (r >= 1.2) return { w: 533, h: Math.round(533 / r) }
  if (r >= 0.9) return { w: 420, h: Math.round(420 / r) }
  const ww = Math.max(300, Math.round(480 * r))
  return { w: ww, h: Math.round(ww / r) }
}

export function estimateSize(n: FlowNodeJSON): { w: number; h: number } {
  switch (n.type) {
    case 'content-generation': {
      const s = aspectSize(n.data.parameters?.aspectRatio ?? '16:9')
      return { w: s.w, h: s.h + 24 + 300 }
    }
    case 'text':
      return { w: 300, h: 260 }
    case 'process':
      return { w: 400, h: 420 }
    case 'comment':
      return { w: 260, h: 120 }
    default:
      return { w: 300, h: 230 }
  }
}

/** Column layout by dependency depth (same idea as the editor's Tidy up). */
export function autoLayout(nodes: FlowNodeJSON[], edges: FlowEdgeJSON[], fixed = new Set<string>()) {
  const free = nodes.filter((n) => !fixed.has(n.id))
  if (!free.length) return
  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  for (const e of edges) {
    ;(preds.get(e.target) ?? preds.set(e.target, []).get(e.target)!).push(e.source)
    ;(succs.get(e.source) ?? succs.set(e.source, []).get(e.source)!).push(e.target)
  }
  // topological order (Kahn)
  const indeg = new Map(nodes.map((n) => [n.id, (preds.get(n.id) ?? []).length]))
  const queue = nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const t of succs.get(id) ?? []) {
      indeg.set(t, indeg.get(t)! - 1)
      if (!indeg.get(t)) queue.push(t)
    }
  }
  const col = new Map<string, number>()
  for (const id of order) col.set(id, Math.max(0, ...(preds.get(id) ?? []).map((p) => (col.get(p) ?? 0) + 1)))
  for (const id of [...order].reverse()) {
    if ((preds.get(id) ?? []).length || !(succs.get(id) ?? []).length) continue
    col.set(id, Math.max(0, Math.min(...succs.get(id)!.map((c) => col.get(c)!)) - 1))
  }
  const columns: FlowNodeJSON[][] = []
  for (const n of free) (columns[col.get(n.id) ?? 0] ??= []).push(n)
  let x = 0
  const placed = new Map<string, number>()
  for (const column of columns) {
    if (!column) continue
    const key = (n: FlowNodeJSON) => {
      const ys = (preds.get(n.id) ?? []).map((p) => placed.get(p)).filter((v): v is number => v != null)
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0
    }
    column.sort((a, b) => key(a) - key(b))
    const total = column.reduce((a, n) => a + estimateSize(n).h, 0) + 110 * (column.length - 1)
    let y = -total / 2
    for (const n of column) {
      n.position = { x, y }
      placed.set(n.id, y + estimateSize(n).h / 2)
      y += estimateSize(n).h + 110
    }
    x += Math.max(...column.map((n) => estimateSize(n).w)) + 140
  }
}
