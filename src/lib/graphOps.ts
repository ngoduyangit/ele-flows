/**
 * Graph-building actions: image presets and first/last-frame chaining.
 */
import { emptyDoc, baseContentGen, newNodeId, nodeFootprint } from './registry'
import { IMAGE_PRESETS } from './presets'
import type { DocJSON, FlowEdge, FlowNode, MediaNodeData } from './types'
import { activeGeneration, freeSpot, useFlow } from '../store/flowStore'

const st = useFlow.getState
const edge = (source: string, target: string, targetHandle: string): FlowEdge => ({
  id: `edge-${source}-${target}-${targetHandle}`,
  source,
  sourceHandle: 'output',
  target,
  targetHandle,
  type: 'dataflow',
})
const doc = (text: string): DocJSON => emptyDoc(text)

const sizeOf = (n: FlowNode) => ({ w: n.measured?.width ?? 400, h: n.measured?.height ?? 400 })

/** Media URL a node currently outputs. */
export function nodeOutputUrl(n: FlowNode | undefined): string | undefined {
  if (!n) return undefined
  return (n.data as MediaNodeData).assetReference?.previewUrl ?? activeGeneration(n.data)?.url ?? undefined
}

function imageGenNode(label: string, prompt: string | DocJSON, aspect: string, x: number, y: number, ): FlowNode {
  const data: any = baseContentGen('image', label)
  data.parameters.prompt = typeof prompt === 'string' ? doc(prompt) : prompt
  data.parameters.aspectRatio = aspect
  return { id: newNodeId(), type: 'content-generation', position: { x, y }, data } as FlowNode
}

function videoGenNode(label: string, prompt: string | DocJSON, aspect: string, x: number, y: number, duration: number): FlowNode {
  const data: any = baseContentGen('video', label)
  data.parameters.prompt = typeof prompt === 'string' ? doc(prompt) : prompt
  data.parameters.aspectRatio = aspect
  data.parameters.video = { ...data.parameters.video, durationSecs: duration }
  return { id: newNodeId(), type: 'content-generation', position: { x, y }, data } as FlowNode
}

/* ------------------------------------------------------------------ */
/* 1. Image presets                                                    */
/* ------------------------------------------------------------------ */

export function applyImagePreset(sourceId: string, presetId: string, run = true) {
  const src = st().nodes.find((n) => n.id === sourceId)
  const preset = IMAGE_PRESETS.find((p) => p.id === presetId)
  if (!src || !preset) return
  const srcAspect = (src.data as any).parameters?.aspectRatio ?? '16:9'
  // stack presets created from the same source so they don't land on top of each other
  const siblings = st().edges.filter((e) => e.source === sourceId).length
  const { w } = sizeOf(src)
  const aspect = preset.aspect ?? srcAspect
  const fp = nodeFootprint(aspect)
  const spot = freeSpot(st().nodes, { x: src.position.x + w + 160, y: src.position.y + siblings * (fp.h + 40) }, fp.w, fp.h)
  const node = imageGenNode(preset.needs ? `${preset.label} – ${preset.needs}` : preset.label, preset.prompt, aspect, spot.x, spot.y)
  st().addGraph([node], [edge(sourceId, node.id, 'referenceImages')])
  if (run && preset.run !== false) void st().runNode(node.id)
  return node.id
}

/* ------------------------------------------------------------------ */
/* 3. Continue from the last (or first) frame of a video              */
/* ------------------------------------------------------------------ */

export async function continueFromFrame(videoNodeId: string, which: 'first' | 'last' = 'last') {
  const src = st().nodes.find((n) => n.id === videoNodeId)
  const url = nodeOutputUrl(src)
  if (!src || !url) throw new Error('This video has no output yet')
  const r = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capability: 'frame', video: url, which }) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error ?? 'Frame extraction failed')
  const { w } = sizeOf(src)
  const p = (src.data as any).parameters ?? {}
  const aspect = p.aspectRatio ?? '16:9'
  const fp = nodeFootprint(aspect)
  // reserve a strip wide enough for frame + next video, clear of other nodes
  const spot = freeSpot(st().nodes, { x: src.position.x + w + 140, y: src.position.y }, 300 + 140 + fp.w, Math.max(fp.h, 320))
  const frame: FlowNode = {
    id: newNodeId(),
    type: 'image',
    position: spot,
    data: { label: `${src.data.label} – ${which} frame`, assetReference: { content_asset_id: j.url, generation_id: null, previewUrl: j.url, mimeType: 'image/png' } },
  } as FlowNode
  const next = videoGenNode(
    `${src.data.label} → next`,
    '',
    aspect,
    spot.x + 300 + 140,
    spot.y,
    p.video?.durationSecs ?? 10,
  )
  st().addGraph([frame, next], [edge(frame.id, next.id, 'startFrame')])
  return next.id
}

/** Add an "Extract frame" node wired to a video (end frame by default) and run it when the video has an output. */
export function extractFrameNode(videoNodeId: string) {
  const src = st().nodes.find((n) => n.id === videoNodeId)
  if (!src) return null
  const { w } = sizeOf(src)
  const node: FlowNode = {
    id: newNodeId(),
    type: 'process',
    position: freeSpot(st().nodes, { x: src.position.x + w + 140, y: src.position.y }, 400, 320),
    width: 400,
    data: { label: `${src.data.label} – end frame`, kind: 'last-frame', parameters: { modelId: 'ffmpeg', prompt: '' }, templateOutput: null },
  } as FlowNode
  st().addGraph([node], [edge(src.id, node.id, 'video')])
  if (nodeOutputUrl(src)) setTimeout(() => st().runNode(node.id), 50)
  return node.id
}
