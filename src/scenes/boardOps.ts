/**
 * Scenes board actions. Structural edits (order, names, notes) only touch the stored board; "create still /
 * video", "add shot" and "make independent" also add nodes and edges – each action is one undo step.
 */
import { nanoid } from 'nanoid'
import { activeGeneration, freeSpot, useFlow } from '../store/flowStore'
import { baseContentGen, emptyDoc, newNodeId, nodeFootprint } from '../lib/registry'
import { isImageGen, isVideoGen, labelCode, resolveBoard, type Board, type BoardNode, type ResolvedShot } from '../shared/board'
import type { FlowEdge, FlowNode } from '../lib/types'
import { NOV_TEST_RESOLUTION, isNovVideo } from '../shared/novPricing'

const st = useFlow.getState
const label = (n: BoardNode | null | undefined) => String(n?.data?.label ?? '')
const pad = (n: number) => String(n).padStart(2, '0')

export const currentBoard = () => resolveBoard(st().board, st().nodes, st().edges)

/** Apply an edit to (a copy of) the effective board and store it. */
function edit(fn: (b: Board) => void) {
  const b = structuredClone(currentBoard().board)
  fn(b)
  st().setBoard(b)
}

function findShot(shotId: string): ResolvedShot | undefined {
  return currentBoard().scenes.flatMap((s) => s.shots).find((s) => s.id === shotId)
}

function mostCommon<T>(values: (T | undefined | null)[]): T | undefined {
  const counts = new Map<T, number>()
  for (const v of values) if (v != null && v !== '') counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: T | undefined
  let n = 0
  for (const [v, c] of counts)
    if (c > n) {
      best = v
      n = c
    }
  return best
}

const edgeOf = (source: string, target: string, targetHandle: string): FlowEdge => ({
  id: `edge-${source}-${target}-${targetHandle}`,
  source,
  sourceHandle: 'output',
  target,
  targetHandle,
  type: 'dataflow',
})

/** Nodes + edges + board as one undo step. */
function commit(nodes: FlowNode[], edges: FlowEdge[], board: Board) {
  st().snapshot()
  useFlow.setState({ nodes, edges, board, saveState: 'unsaved' })
}

/** How this flow wires stills into videos (Muse: reference image, Flow/Veo: start frame). */
function stillHandle(modelId: string): string {
  const { edges } = st()
  const used = currentBoard()
    .scenes.flatMap((s) => s.shots)
    .filter((s) => s.video && s.still)
    .map((s) => edges.find((e) => e.source === s.still!.id && e.target === s.video!.id)?.targetHandle)
  return mostCommon(used) ?? (modelId.startsWith('muse') || modelId === 'auto' ? 'referenceImages' : 'startFrame')
}

/* ------------------------------------------------------------------ */
/* Scenes                                                             */
/* ------------------------------------------------------------------ */

export function addScene(): string {
  const r = currentBoard()
  const used = new Set([...r.board.scenes.map((s) => s.key ?? ''), ...st().nodes.map((n) => labelCode(label(n))?.letters ?? '')])
  // V is the video prefix ("V12 (a03)") – never a scene letter
  const key = 'ABCDEFGHIJKLMNOPQRSTUWXYZ'.split('').find((k) => !used.has(k))
  const id = `scene-${nanoid(8)}`
  edit((b) => b.scenes.push({ id, name: key ? `Scene ${key}` : 'New scene', ...(key ? { key } : {}), shots: [] }))
  return id
}

export function renameScene(sceneId: string, name: string) {
  edit((b) => {
    const s = b.scenes.find((x) => x.id === sceneId)
    if (s) s.name = name
  })
}

export function moveScene(sceneId: string, delta: number) {
  edit((b) => {
    const i = b.scenes.findIndex((x) => x.id === sceneId)
    const j = i + delta
    if (i < 0 || j < 0 || j >= b.scenes.length) return
    const [s] = b.scenes.splice(i, 1)
    b.scenes.splice(j, 0, s)
  })
}

/** Remove a scene from the board; its shots are hidden (the nodes stay on the canvas). */
export function deleteScene(sceneId: string) {
  edit((b) => {
    const s = b.scenes.find((x) => x.id === sceneId)
    if (!s) return
    b.hidden = [...(b.hidden ?? []), ...s.shots.map((sh) => sh.node)]
    b.scenes = b.scenes.filter((x) => x !== s)
  })
}

export function resetBoard() {
  st().setBoard(null)
}

export function restoreHidden() {
  edit((b) => void (b.hidden = []))
}

/* ------------------------------------------------------------------ */
/* Shots (board only)                                                 */
/* ------------------------------------------------------------------ */

export function moveShot(shotId: string, toSceneId: string, index: number) {
  edit((b) => {
    const from = b.scenes.find((s) => s.shots.some((sh) => sh.id === shotId))
    const to = b.scenes.find((s) => s.id === toSceneId)
    if (!from || !to) return
    const i = from.shots.findIndex((sh) => sh.id === shotId)
    const [shot] = from.shots.splice(i, 1)
    const at = from === to && i < index ? index - 1 : index
    to.shots.splice(Math.max(0, Math.min(at, to.shots.length)), 0, shot)
  })
}

/** Take a shot off the board (nodes stay) – detection won't bring it back. */
export function removeShot(shotId: string) {
  edit((b) => {
    for (const s of b.scenes) {
      const sh = s.shots.find((x) => x.id === shotId)
      if (!sh) continue
      s.shots = s.shots.filter((x) => x !== sh)
      b.hidden = [...(b.hidden ?? []), sh.node]
    }
  })
}

export function setShotNote(shotId: string, note: string) {
  edit((b) => {
    for (const s of b.scenes) for (const sh of s.shots) if (sh.id === shotId) sh.note = note.trim() || undefined
  })
}

/** Canvas nodes as shots at the end of a scene (nodes already on the board are skipped). */
export function addNodesAsShots(sceneId: string, nodeIds: string[]) {
  edit((b) => {
    const s = b.scenes.find((x) => x.id === sceneId)
    if (!s) return
    const present = new Set(b.scenes.flatMap((x) => x.shots.map((sh) => sh.node)))
    for (const id of nodeIds) if (!present.has(id)) s.shots.push({ id: `shot-${id}`, node: id })
    b.hidden = (b.hidden ?? []).filter((id) => !nodeIds.includes(id))
  })
}

/* ------------------------------------------------------------------ */
/* Shots that create nodes                                            */
/* ------------------------------------------------------------------ */

/** New shot = a new still (image generation) in this scene, after `after` (or at the end). Returns the shot id. */
export function addShot(sceneId: string, after?: string | null): string | null {
  const r = currentBoard()
  const scene = r.scenes.find((s) => s.id === sceneId)
  if (!scene) return null
  const { nodes, edges } = st()
  const stills = r.scenes.flatMap((s) => s.shots.map((sh) => sh.still)).filter(isImageGen) as FlowNode[]
  const pool = stills.length ? stills : (nodes.filter(isImageGen) as FlowNode[])
  const aspect = mostCommon(pool.map((n) => (n.data as any).parameters?.aspectRatio)) ?? '16:9'
  const model = mostCommon(stills.map((n) => (n.data as any).parameters?.image?.modelId)) ?? 'auto'
  const key = scene.key ?? ''
  const nums = nodes.map((n) => labelCode(label(n))).filter((c) => !!key && c?.letters === key).map((c) => c!.num)
  const name = key ? `${key}${pad((nums.length ? Math.max(...nums) : 0) + 1)} – New shot` : `Shot ${scene.shots.length + 1} – New shot`

  const anchor = (after ? scene.shots.find((s) => s.id === after) : scene.shots.at(-1)) ?? null
  const ref = (anchor?.still ?? anchor?.head ?? null) as FlowNode | null
  const fp = nodeFootprint(aspect)
  const base = ref ? { x: ref.position.x, y: ref.position.y + (ref.measured?.height ?? fp.h) + 80 } : { x: st().viewportCenter.x - fp.w / 2, y: st().viewportCenter.y }
  const data: any = baseContentGen('image', name)
  data.parameters.aspectRatio = aspect
  data.parameters.image.modelId = model
  const node = { id: newNodeId(), type: 'content-generation', position: freeSpot(nodes, base, fp.w, fp.h), data } as FlowNode

  const b = structuredClone(r.board)
  const sc = b.scenes.find((s) => s.id === sceneId)!
  const at = after ? sc.shots.findIndex((s) => s.id === after) + 1 : sc.shots.length
  const shot = { id: `shot-${node.id}`, node: node.id }
  sc.shots.splice(at > 0 ? at : sc.shots.length, 0, shot)
  commit([...nodes.map((n) => ({ ...n, selected: false })), node], edges, b)
  return shot.id
}

/** Video for a still-only shot: same model/duration as the flow's other videos, wired from the still. */
export function createVideo(shotId: string): string | null {
  const shot = findShot(shotId)
  if (!shot?.still || shot.video) return null
  const still = shot.still as FlowNode
  const { nodes, edges } = st()
  const vids = nodes.filter(isVideoGen)
  const model = mostCommon(vids.map((n) => (n.data as any).parameters?.video?.modelId as string)) ?? 'auto'
  // default provider is Muse (10/20/30/60 s only) – one small 10 s shot per clip
  const dur = mostCommon(vids.map((n) => (n.data as any).parameters?.video?.durationSecs as number)) ?? (model.startsWith('flowkit') ? 8 : 10)
  const aspect = (still.data as any).parameters?.aspectRatio ?? mostCommon(vids.map((n) => (n.data as any).parameters?.aspectRatio)) ?? '16:9'
  // follow the flow's naming: "V12 (a03) – …" when its videos are V-numbered, else "VE05M3 – …" from the still's
  // code (order-independent, and the scene letter survives)
  const vnums = vids.map((n) => labelCode(label(n))).filter((c) => c?.letters === 'V').map((c) => c!.num)
  const code = /^\s*[A-Z]{1,3} ?\d{1,3}[A-Za-z0-9]*/.exec(label(still))?.[0].replace(' ', '').trim()
  const rest = label(still).replace(/^\s*[A-Z]{1,3} ?\d{1,3}[A-Za-z0-9]*\s*[–-]?\s*/, '').trim()
  const name = vnums.length
    ? `V${pad(Math.max(...vnums) + 1)}${code ? ` (${code.toLowerCase()})` : ''} – ${rest || 'shot'}`
    : code
      ? `V${code} – ${rest || 'shot'}`
      : `${label(still)} · video`

  const data: any = baseContentGen('video', name)
  data.parameters.prompt = emptyDoc()
  data.parameters.aspectRatio = aspect
  data.parameters.video = { ...data.parameters.video, modelId: model, durationSecs: dur }
  if (isNovVideo(model)) data.parameters.resolution = NOV_TEST_RESOLUTION
  const fp = nodeFootprint(aspect)
  const w = still.measured?.width ?? 533
  const node = { id: newNodeId(), type: 'content-generation', position: freeSpot(nodes, { x: still.position.x + w + 140, y: still.position.y }, fp.w, fp.h), data } as FlowNode

  const b = structuredClone(currentBoard().board)
  for (const s of b.scenes) for (const sh of s.shots) if (sh.id === shotId) sh.node = node.id
  commit([...nodes, node], [...edges, edgeOf(still.id, node.id, stillHandle(model))], b)
  return node.id
}

/** Still for a video that has none (text-to-video so far): new image generation wired into the video. */
export function createStill(shotId: string): string | null {
  const shot = findShot(shotId)
  const video = shot?.video as FlowNode | null
  if (!shot || !video || shot.still) return null
  const { nodes, edges } = st()
  const p = (video.data as any).parameters ?? {}
  const aspect = p.aspectRatio ?? '16:9'
  const stills = currentBoard().scenes.flatMap((s) => s.shots.map((sh) => sh.still)).filter(isImageGen) as FlowNode[]
  const data: any = baseContentGen('image', `${label(video)} · still`)
  data.parameters.aspectRatio = aspect
  data.parameters.image.modelId = mostCommon(stills.map((n) => (n.data as any).parameters?.image?.modelId)) ?? 'auto'
  const fp = nodeFootprint(aspect)
  const node = { id: newNodeId(), type: 'content-generation', position: freeSpot(nodes, { x: video.position.x - fp.w - 140, y: video.position.y }, fp.w, fp.h), data } as FlowNode
  commit([...nodes, node], [...edges, edgeOf(node.id, video.id, stillHandle(p.video?.modelId ?? 'auto'))], structuredClone(currentBoard().board))
  return node.id
}

/** Point prompt chips at another node (after a still was copied for one shot). */
function retag(doc: any, from: string, to: string, toLabel: string): any {
  if (!doc || typeof doc !== 'object') return doc
  if (Array.isArray(doc)) return doc.map((x) => retag(x, from, to, toLabel))
  if (doc.type === 'prompt-tag' && String(doc.attrs?.id ?? '').replace(/^node:/, '') === from) return { ...doc, attrs: { ...doc.attrs, id: `node:${to}`, label: toLabel } }
  return doc.content ? { ...doc, content: retag(doc.content, from, to, toLabel) } : doc
}

/**
 * A still shared by several shots: give this shot its own copy (same prompt, inputs and current image) so
 * fixing its angle no longer changes the other shots.
 */
export function detachStill(shotId: string): string | null {
  const shot = findShot(shotId)
  const still = shot?.still as FlowNode | null
  if (!shot || !still || !shot.sharedWith.length) return null
  const { nodes, edges } = st()
  const id = newNodeId()
  const ids = new Map<string, string>()
  const gens = (still.data.generations ?? []).filter((g) => g.status === 'done').map((g) => {
    const nid = nanoid(20)
    ids.set(g.id, nid)
    return { ...g, id: nid }
  })
  const active = activeGeneration(still.data)
  const suffix = labelCode(label(shot.head)) ? /^\s*[A-Z]{1,3} ?\d{1,3}[A-Za-z0-9]*/.exec(label(shot.head))![0].trim() : 'copy'
  const copyLabel = `${label(still)} · ${suffix}`
  const { measured: _m, width: _w, height: _h, selected: _s, ...rest } = still
  const fp = { w: still.measured?.width ?? 533, h: still.measured?.height ?? 600 }
  const copy = {
    ...structuredClone(rest),
    id,
    position: freeSpot(nodes, { x: still.position.x + 60, y: still.position.y + 60 }, fp.w, fp.h),
    data: { ...structuredClone(still.data), label: copyLabel, generations: gens, activeGenerationId: (active && ids.get(active.id)) ?? gens.at(-1)?.id ?? null },
  } as FlowNode
  const inputs = edges.filter((e) => e.target === still.id).map((e) => ({ ...e, id: `edge-${e.source}-${id}-${e.targetHandle}`, target: id, selected: false }))
  const b = structuredClone(currentBoard().board)
  let nextNodes = [...nodes, copy]
  let nextEdges = [...edges, ...inputs]
  if (shot.video) {
    const vid = shot.video.id
    nextEdges = nextEdges.map((e) => (e.source === still.id && e.target === vid ? { ...e, source: id, id: `edge-${id}-${vid}-${e.targetHandle}` } : e))
    nextNodes = nextNodes.map((n) =>
      n.id === vid ? { ...n, data: { ...n.data, parameters: { ...(n.data as any).parameters, prompt: retag((n.data as any).parameters?.prompt, still.id, id, copyLabel) } } } : n,
    )
  } else {
    for (const s of b.scenes) for (const sh of s.shots) if (sh.id === shotId) sh.node = id
  }
  commit(nextNodes, nextEdges, b)
  return id
}

/** Disconnect one input of a node. */
export function disconnect(edgeId: string) {
  st().snapshot()
  useFlow.setState({ edges: st().edges.filter((e) => e.id !== edgeId), saveState: 'unsaved' })
}
