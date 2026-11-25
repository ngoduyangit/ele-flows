/**
 * Scene board: scenes → shots, a structured view on top of the node graph (no React/DOM – shared with the server).
 *
 * A shot points at its "head" node: the video when there is one, otherwise the still. The still of a video is
 * derived from the video's image inputs, so rewiring on the canvas shows up on the board. The stored board only
 * keeps what the graph can't tell (order, scene names, notes, removed shots); shots for nodes added later are
 * detected from their labels ("A01 …" stills, "V12 (a03) …" videos) every time the board is resolved.
 */

export interface BoardShot {
  id: string
  /** Head node: the shot's video, or its still while there is no video yet. */
  node: string
  note?: string
}

export interface BoardScene {
  id: string
  name: string
  /** Letter code ("A" for A01, A02 …) – groups newly detected shots and names new stills. */
  key?: string
  note?: string
  shots: BoardShot[]
}

export interface Board {
  scenes: BoardScene[]
  /** Node ids the user removed from the board – never re-added by detection. */
  hidden?: string[]
}

/** Minimal graph shapes (editor FlowNode and server FlowNodeJSON both fit). */
export interface BoardNode {
  id: string
  type?: string
  position?: { x: number; y: number }
  data: any
}
export interface BoardEdge {
  source: string
  target: string
  targetHandle?: string | null
}

export interface ResolvedShot {
  id: string
  sceneId: string
  note?: string
  head: BoardNode
  /** Still (start frame / reference) – the head itself for a still-only shot. */
  still: BoardNode | null
  video: BoardNode | null
  /** Other shots that use the same still: editing it changes them too. */
  sharedWith: string[]
}

export interface ResolvedScene {
  id: string
  name: string
  key?: string
  note?: string
  shots: ResolvedShot[]
}

export interface ResolvedBoard {
  /** Plain board including detected shots – what an edit stores. */
  board: Board
  scenes: ResolvedScene[]
  /** true while nothing was stored yet (everything comes from detection). */
  auto: boolean
}

const label = (n: BoardNode | null | undefined) => String(n?.data?.label ?? '')
const modality = (n: BoardNode) => n.data?.parameters?.modality as string | undefined

export const isVideoGen = (n: BoardNode | null | undefined) => !!n && n.type === 'content-generation' && (modality(n) === 'video' || modality(n) === 'lipsync')
export const isImageGen = (n: BoardNode | null | undefined) => !!n && n.type === 'content-generation' && !isVideoGen(n)

/**
 * Shot code at the start of a label: "A01 Fly – …" → A/1, "A04M1 – …" → A/4/M1, "V04A (a03m6f)" → V/4/A,
 * "V 1 – …" → V/1. Upper-case letters only, so ordinary titles ("Mai 2", "Cat 3") don't count.
 */
export function labelCode(text: string): { letters: string; num: number; rest: string } | null {
  const m = /^\s*([A-Z]{1,3}) ?(\d{1,3})([A-Za-z0-9]*)(?![\p{L}\p{N}])/u.exec(text)
  return m ? { letters: m[1], num: Number(m[2]), rest: m[3] } : null
}

/** Old flows kept retakes as separate "… take 2" nodes – they are not shots of their own. */
const RETAKE = /\btake\s*(?:[2-9]|\d{2,})\b/i
/** Image inputs that are identity/setting references, not the shot's frame. */
const IDENTITY = /sheet|character|nhân vật|\bface\b|mặt|outfit|trang phục|costume|bối cảnh|setting|location|\bref\b|casting/i
const STILL_PORTS = ['startFrame', 'referenceImages', 'image']

export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

interface Graph {
  nodes: BoardNode[]
  byId: Map<string, BoardNode>
  index: Map<string, number>
  ins: Map<string, BoardEdge[]>
  outs: Map<string, BoardEdge[]>
}

function graph(nodes: BoardNode[], edges: BoardEdge[]): Graph {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const index = new Map(nodes.map((n, i) => [n.id, i]))
  const ins = new Map<string, BoardEdge[]>()
  const outs = new Map<string, BoardEdge[]>()
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue
    ;(ins.get(e.target) ?? ins.set(e.target, []).get(e.target)!).push(e)
    ;(outs.get(e.source) ?? outs.set(e.source, []).get(e.source)!).push(e)
  }
  return { nodes, byId, index, ins, outs }
}

/** The still of a shot head: the head itself unless it is a video, else the video's frame input. */
function stillOf(head: BoardNode, g: Graph): BoardNode | null {
  if (!isVideoGen(head)) return head
  const ins = (g.ins.get(head.id) ?? []).filter((e) => STILL_PORTS.includes(e.targetHandle ?? ''))
  // start frame first, then references in wiring order
  ins.sort((a, b) => Number(b.targetHandle === 'startFrame') - Number(a.targetHandle === 'startFrame'))
  const srcs = ins.map((e) => ({ e, n: g.byId.get(e.source)! })).filter((x) => x.n.type !== 'video')
  if (!srcs.length) return null
  if (srcs.length === 1) return srcs[0].n
  const framey = srcs.filter((x) => !IDENTITY.test(label(x.n)) && (labelCode(label(x.n)) || /frame|still|khung|shot/i.test(label(x.n))))
  // storyboard "references" mode wires the character sheets first and the shot keyframe last
  return (framey[0] ?? srcs.find((x) => x.e.targetHandle === 'startFrame') ?? srcs.at(-1)!).n
}

export function shotStill(head: BoardNode, nodes: BoardNode[], edges: BoardEdge[]): BoardNode | null {
  return stillOf(head, graph(nodes, edges))
}

/** Scene letter of a node: its own code, or (frames pulled from a clip) the code of the clip's shot. */
function sceneKeyOf(n: BoardNode | null, g: Graph, depth = 0): string {
  if (!n || depth > 4) return ''
  const c = labelCode(label(n))
  if (c && !(c.letters.startsWith('V') && !isImageGen(n))) return c.letters
  if (c && c.letters.length > 1) return c.letters.slice(1) // "VC01" → scene C
  if (isVideoGen(n)) return sceneKeyOf(stillOf(n, g), g, depth + 1)
  // last-frame / asset frames: follow what they were made from
  const src = (g.ins.get(n.id) ?? []).map((e) => g.byId.get(e.source)!).find((x) => isVideoGen(x) || isImageGen(x))
  return src ? sceneKeyOf(src, g, depth + 1) : ''
}

interface Candidate {
  head: BoardNode
  still: BoardNode | null
  video: boolean
  key: string
  /** creation order used to order scenes (head or own still, whichever came first) */
  pos: number
  headPos: number
}

/** Nodes that read as shots: every video generation, plus coded stills nothing consumes yet. */
function candidates(g: Graph): Candidate[] {
  const out: Candidate[] = []
  for (const n of g.nodes) {
    if (n.type !== 'content-generation' || RETAKE.test(label(n))) continue
    if (isVideoGen(n)) {
      const still = stillOf(n, g)
      const key = sceneKeyOf(n, g)
      // a still borrowed from another scene ("VE06" reusing C07) must not pull this scene forward
      const own = still && sceneKeyOf(still, g) === key ? g.index.get(still.id)! : Infinity
      out.push({ head: n, still, video: true, key, pos: Math.min(g.index.get(n.id)!, own), headPos: g.index.get(n.id)! })
    } else if (labelCode(label(n)) && !(g.outs.get(n.id) ?? []).length) {
      // consumed stills are masters (multi-cam, fixes) or the frames of videos – those videos are the shots
      out.push({ head: n, still: n, video: false, key: sceneKeyOf(n, g), pos: g.index.get(n.id)!, headPos: g.index.get(n.id)! })
    }
  }
  keepIntercutsInScene(out)
  return out
}

/**
 * Scene letters name sets, V-numbers carry the story. A short run of videos (≤ 3) that reuses stills of a set
 * already seen earlier is a cutaway inside the running scene (V63A–C cutting back to the courtyard in the middle
 * of scene C) – keep it in that scene instead of moving it to the end of the old one.
 */
function keepIntercutsInScene(cands: Candidate[]) {
  const seq = cands.filter((c) => c.video && labelCode(label(c.head))?.letters === 'V').sort((a, b) => naturalCompare(label(a.head), label(b.head)))
  const runs: { key: string; items: Candidate[] }[] = []
  for (const c of seq) {
    const last = runs.at(-1)
    if (last && last.key === c.key) last.items.push(c)
    else runs.push({ key: c.key, items: [c] })
  }
  const longest = new Map<string, number>()
  let current: string | null = null
  for (const r of runs) {
    const best = longest.get(r.key) ?? 0
    if (current !== null && current !== r.key && r.items.length <= 3 && best > r.items.length) {
      // the borrowed still no longer places the scene – only the video's own creation order does
      for (const c of r.items) (c.key = current), (c.pos = c.headPos)
      continue
    }
    longest.set(r.key, Math.max(best, r.items.length))
    current = r.key
  }
}

interface Sortable {
  video: boolean
  head: string
  still: string
  /** creation order of the head node */
  pos: number
}
/**
 * Coded labels sort by code: videos by their own label (V-numbers carry story order), anything else by the
 * still's label. Without codes ("V Hook", "Puzzle assembles") nodes keep the order they were created in.
 */
function compareShots(a: Sortable, b: Sortable) {
  const ka = a.video ? a.head : a.still || a.head
  const kb = b.video ? b.head : b.still || b.head
  if (labelCode(ka) && labelCode(kb)) return a.video && b.video ? naturalCompare(a.head, b.head) : naturalCompare(a.still || a.head, b.still || b.head)
  return a.pos - b.pos
}

export const sceneName = (key: string) => (key ? `Scene ${key}` : 'Shots')
const sceneId = (key: string) => `scene-${key || 'main'}`
const shotId = (nodeId: string) => `shot-${nodeId}`

/**
 * Stored board + graph → what the board view shows. Shots whose node was deleted drop out; detected shots that
 * aren't on the board yet (and weren't removed by the user) are added to the scene of their letter code.
 */
export function resolveBoard(stored: Board | null | undefined, nodes: BoardNode[], edges: BoardEdge[]): ResolvedBoard {
  const g = graph(nodes, edges)
  const board: Board = {
    scenes: (stored?.scenes ?? []).map((s) => ({ ...s, shots: s.shots.filter((sh) => g.byId.has(sh.node)) })),
    hidden: (stored?.hidden ?? []).filter((id) => g.byId.has(id)),
  }
  const present = new Set(board.scenes.flatMap((s) => s.shots.map((sh) => sh.node)))
  const hidden = new Set(board.hidden)
  const fresh = candidates(g)
    .filter((c) => !present.has(c.head.id) && !hidden.has(c.head.id))
    .sort((a, b) => a.pos - b.pos)

  const onBoard = (sh: BoardShot): Sortable => {
    const head = g.byId.get(sh.node)!
    return { video: isVideoGen(head), head: label(head), still: label(stillOf(head, g)), pos: g.index.get(head.id)! }
  }
  // scenes appear in the order their first member was created; shots inside follow the codes
  const groups = new Map<string, Candidate[]>()
  for (const c of fresh) (groups.get(c.key) ?? groups.set(c.key, []).get(c.key)!).push(c)
  for (const [key, list] of groups) {
    const sortable = (c: Candidate): Sortable => ({ video: c.video, head: label(c.head), still: label(c.still), pos: g.index.get(c.head.id)! })
    list.sort((a, b) => compareShots(sortable(a), sortable(b)))
    for (const c of list) {
      // a new video made from a still-only shot takes that shot over (keeps its place, id and note)
      if (c.video && c.still) {
        const owner = board.scenes.flatMap((s) => s.shots).find((sh) => sh.node === c.still!.id)
        if (owner) {
          owner.node = c.head.id
          continue
        }
      }
      let scene = board.scenes.find((s) => (s.key ?? '') === key)
      if (!scene) board.scenes.push((scene = { id: uniqueSceneId(board, key), name: sceneName(key), key: key || undefined, shots: [] }))
      const me = sortable(c)
      let at = 0
      scene.shots.forEach((sh, i) => {
        if (compareShots(onBoard(sh), me) <= 0) at = i + 1
      })
      scene.shots.splice(at, 0, { id: shotId(c.head.id), node: c.head.id })
    }
  }

  const scenes: ResolvedScene[] = board.scenes.map((s) => ({
    id: s.id,
    name: s.name,
    key: s.key,
    note: s.note,
    shots: s.shots.map((sh) => {
      const head = g.byId.get(sh.node)!
      const video = isVideoGen(head) ? head : null
      return { id: sh.id, sceneId: s.id, note: sh.note, head, still: stillOf(head, g), video, sharedWith: [] }
    }),
  }))
  const byStill = new Map<string, ResolvedShot[]>()
  for (const sh of scenes.flatMap((s) => s.shots)) if (sh.still) (byStill.get(sh.still.id) ?? byStill.set(sh.still.id, []).get(sh.still.id)!).push(sh)
  for (const list of byStill.values()) if (list.length > 1) for (const sh of list) sh.sharedWith = list.filter((x) => x !== sh).map((x) => x.id)
  return { board, scenes, auto: !stored }
}

function uniqueSceneId(board: Board, key: string) {
  let id = sceneId(key)
  for (let i = 2; board.scenes.some((s) => s.id === id); i++) id = `${sceneId(key)}-${i}`
  return id
}

/** Board from an API spec: `scenes: [{ name, key?, note?, shots: ["v01", { node: "v02", note }] }]` with spec keys → node ids. */
export function boardFromSpec(
  scenes: { name: string; key?: string; note?: string; shots: (string | { node: string; note?: string })[] }[],
  idOf: (key: string) => string | undefined,
  errors: string[],
): Board {
  const used = new Set<string>()
  return {
    scenes: scenes.map((s, i) => {
      const where = `scenes[${i}]`
      if (!s?.name) errors.push(`${where}: name is required`)
      const shots: BoardShot[] = []
      for (const [j, raw] of (Array.isArray(s?.shots) ? s.shots : []).entries()) {
        const key = typeof raw === 'string' ? raw : raw?.node
        const id = key ? idOf(key) : undefined
        if (!id) {
          errors.push(`${where}.shots[${j}]: unknown node key "${key}"`)
          continue
        }
        if (used.has(id)) errors.push(`${where}.shots[${j}]: "${key}" is already a shot`)
        used.add(id)
        shots.push({ id: shotId(id), node: id, ...(typeof raw === 'object' && raw.note ? { note: raw.note } : {}) })
      }
      return { id: `scene-${i + 1}`, name: s?.name ?? `Scene ${i + 1}`, ...(s?.key ? { key: s.key } : {}), ...(s?.note ? { note: s.note } : {}), shots }
    }),
  }
}
