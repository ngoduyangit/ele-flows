/**
 * Node → provider request translation, shared by the editor (browser) and the headless
 * runner (server). Pure: no React, no DOM.
 */

export interface AnyNode {
  id: string
  type?: string
  data: any
}
export interface AnyEdge {
  source: string
  target: string
  targetHandle?: string | null
}
export interface Ctx {
  node: AnyNode
  nodes: AnyNode[]
  edges: AnyEdge[]
  /** Upstream nodes per target handle. */
  inputs: Record<string, AnyNode[]>
}
export interface PassResult {
  text?: string
  url?: string
}

/** Build the run context for a node from the whole graph. */
export function contextFor(node: AnyNode, nodes: AnyNode[], edges: AnyEdge[]): Ctx {
  const inputs: Record<string, AnyNode[]> = {}
  for (const e of edges) {
    if (e.target !== node.id) continue
    const src = nodes.find((n) => n.id === e.source)
    if (src) (inputs[e.targetHandle ?? 'input'] ??= []).push(src)
  }
  return { node, nodes, edges, inputs }
}

/** Plain text of a rich-text doc (prompt-tags become @label). */
export function docToPlain(v: any): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  const walk = (n: any): string => (n.type === 'text' ? n.text : n.type === 'prompt-tag' ? `@${n.attrs?.label}` : (n.content ?? []).map(walk).join(''))
  return (v.content ?? []).map(walk).join('\n')
}

const active = (d: any) => d?.generations?.find((g: any) => g.id === d.activeGenerationId) ?? d?.generations?.filter((g: any) => g.status === 'done').at(-1)

/** Text a node produces (LLM output, text node content, transcript…). */
export function outputText(n: AnyNode): string {
  const g = active(n.data)
  if (g?.text) return g.text
  if (n.type === 'text') return docToPlain(n.data.text)
  return ''
}

/** Media URL a node produces (uploaded asset or last generation). */
export function outputUrl(n: AnyNode): string | undefined {
  return n.data?.assetReference?.previewUrl ?? active(n.data)?.url ?? undefined
}

/** Prompt text with @references resolved to the referenced node's output, plus unreferenced text inputs. */
export function resolvePrompt(prompt: any, ctx: Ctx, handle = 'prompt'): string {
  const byId = new Map(ctx.nodes.map((n) => [n.id, n]))
  // media nodes sent as reference images, in the order the provider receives them
  const refOrder = (ctx.inputs.referenceImages ?? []).map((n) => n.id)
  const used = new Set<string>()
  let text = ''
  if (typeof prompt === 'string') text = prompt
  else if (prompt) {
    const walk = (n: any): string => {
      if (n.type === 'text') return n.text ?? ''
      if (n.type === 'prompt-tag') {
        const id = String(n.attrs?.id ?? '').replace(/^node:/, '')
        const ref = byId.get(id)
        used.add(id)
        const t = ref ? outputText(ref) : ''
        if (t) return t
        // an image/video tag: tell the model which attached reference it is
        // frames are named by role – a node label like "Grid · 3-2" would be drawn as on-screen text
        if ((ctx.inputs.startFrame ?? []).some((x) => x.id === id)) return 'the start frame'
        if ((ctx.inputs.endFrame ?? []).some((x) => x.id === id)) return 'the end frame'
        const label = ref?.data?.label ?? n.attrs?.label ?? ''
        const k = refOrder.indexOf(id)
        return k >= 0 ? `reference image ${k + 1} (${label})` : label
      }
      if (n.type === 'hardBreak') return '\n'
      return (n.content ?? []).map(walk).join('')
    }
    text = (prompt.content ?? []).map(walk).join('\n')
  }
  const extra = (ctx.inputs[handle] ?? []).filter((n) => !used.has(n.id)).map(outputText).filter(Boolean)
  return [text.trim(), ...extra].filter(Boolean).join('\n\n')
}

const urls = (ctx: Ctx, handle: string) => (ctx.inputs[handle] ?? []).map(outputUrl).filter(Boolean) as string[]
/** Labels of the media inputs on a handle, in the same order as `urls`. */
const labels = (ctx: Ctx, handle: string) => (ctx.inputs[handle] ?? []).filter((n) => outputUrl(n)).map((n) => String(n.data?.label ?? ''))

/** Translate a node (+ its connected inputs) into a /api/run request, or a passthrough result. */
export function buildRunRequest(ctx: Ctx): Record<string, unknown> | { passthrough: PassResult } {
  const { node } = ctx
  const d = node.data as any
  const p = d.parameters ?? {}
  switch (node.type) {
    case 'text':
      return { passthrough: { text: outputText(node) } }
    case 'content-generation': {
      if (p.modality === 'video')
        return {
          capability: 'video',
          model: p.video?.modelId,
          resolution: p.resolution,
          generateAudio: p.video?.generateAudio,
          prompt: resolvePrompt(p.prompt, ctx),
          aspectRatio: p.aspectRatio,
          durationSecs: p.video?.durationSecs,
          startFrame: urls(ctx, 'startFrame')[0],
          endFrame: urls(ctx, 'endFrame')[0],
          images: urls(ctx, 'referenceImages'),
          imageLabels: labels(ctx, 'referenceImages'),
          startFrameLabel: labels(ctx, 'startFrame')[0],
          endFrameLabel: labels(ctx, 'endFrame')[0],
        }
      return { capability: 'image', model: p.image?.modelId, resolution: p.resolution, prompt: resolvePrompt(p.prompt, ctx), aspectRatio: p.aspectRatio, images: urls(ctx, 'referenceImages'), imageLabels: labels(ctx, 'referenceImages') }
    }
    case 'process': {
      if (d.kind !== 'last-frame') throw new Error(`“${d.label}” cannot run`)
      const video = urls(ctx, 'video')[0]
      if (!video) throw new Error('Connect a video (it needs an output first)')
      if (p.which === 'time') return { capability: 'frame', video, which: 'time', at: Math.max(0, Number(p.at) || 0) }
      return { capability: 'frame', video, which: p.which === 'first' ? 'first' : 'last' }
    }
    case 'image':
    case 'video': {
      const url = outputUrl(node)
      if (!url) throw new Error('Upload a file first')
      return { passthrough: { url } }
    }
    default:
      throw new Error(`Cannot run ${node.type} nodes`)
  }
}
