/**
 * Backend adapter.
 *
 * Every call the UI makes to "the server" goes through this object, so integrating a real API
 * means replacing the functions below (or calling `setFlowApi()` at startup) — no UI changes needed.
 *
 * The default implementation is a local mock: flows persist in localStorage and "Run" returns
 * placeholder outputs after a short delay.
 */
import { nanoid } from 'nanoid'
import type { FlowDocument, FlowEdge, FlowNode, Generation } from './types'

export interface RunContext {
  /** The node being run. */
  node: FlowNode
  /** Upstream nodes connected to this node's inputs, keyed by target handle id. */
  inputs: Record<string, FlowNode[]>
  /** Whole graph, if the backend wants to resolve references itself. */
  nodes: FlowNode[]
  edges: FlowEdge[]
  signal: AbortSignal
  /** Flow + generation id: lets the backend keep the run going and save its result if the page reloads. */
  flowId?: string
  genId?: string
}

export interface FlowApi {
  listFlows(): Promise<Pick<FlowDocument, 'id' | 'name' | 'updatedAt' | 'createdAt'>[]>
  loadFlow(id: string): Promise<FlowDocument | null>
  saveFlow(flow: FlowDocument): Promise<void>
  deleteFlow(id: string): Promise<void>
  /** Execute one node. Return the generation result (text or media url). */
  runNode(ctx: RunContext): Promise<Generation>
  /** Stop a run on the backend (the user pressed stop – a page reload does not cancel). */
  cancelRun?(genId: string): void
  /** Upload a local file, return an asset id + URL usable as preview. */
  uploadAsset(file: File): Promise<{ content_asset_id: string; url: string; mimeType: string }>
}

/* ------------------------------------------------------------------ */
/* Mock implementation                                                */
/* ------------------------------------------------------------------ */

const LS_KEY = 'flows:v1'

function readAll(): Record<string, FlowDocument> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}')
  } catch {
    return {}
  }
}
function writeAll(all: Record<string, FlowDocument>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(all))
  } catch {
    /* quota – ignore in mock */
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

function placeholderImage(seed: string, w = 1280, h = 720) {
  let hash = 0
  for (const c of seed) hash = (hash * 31 + c.charCodeAt(0)) | 0
  const h1 = Math.abs(hash) % 360
  const h2 = (h1 + 60) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1} 70% 72%)"/><stop offset="1" stop-color="hsl(${h2} 70% 52%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${h * 0.35}" r="${h * 0.18}" fill="#ffffff55"/></svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

export const mockApi: FlowApi = {
  async listFlows() {
    return Object.values(readAll())
      .map(({ id, name, updatedAt, createdAt }) => ({ id, name, updatedAt, createdAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  },
  async loadFlow(id) {
    return readAll()[id] ?? null
  },
  async saveFlow(flow) {
    const all = readAll()
    all[flow.id] = flow
    writeAll(all)
    await sleep(250)
  },
  async deleteFlow(id) {
    const all = readAll()
    delete all[id]
    writeAll(all)
  },
  async runNode({ node, inputs, signal }) {
    await sleep(1200 + Math.random() * 1200, signal)
    const id = nanoid(20)
    const p = (node.data as any).parameters ?? {}
    const base: Generation = { id, status: 'done', createdAt: Date.now() }
    switch (node.type) {
      case 'text':
        return {
          ...base,
          text: `[mock output from ${node.data.label}]\nConnected inputs: ${Object.keys(inputs).join(', ') || 'none'}.\nReplace src/lib/api.ts → runNode with your backend call.`,
        }
      case 'process':
        return { ...base, url: placeholderImage(id) }
      case 'content-generation':
        return { ...base, url: placeholderImage(id, p.modality === 'image' ? 1024 : 1280, p.modality === 'image' ? 1024 : 720) }
      default:
        return { ...base, url: placeholderImage(id) }
    }
  },
  async uploadAsset(file) {
    return { content_asset_id: nanoid(20), url: URL.createObjectURL(file), mimeType: file.type }
  },

}

let current: FlowApi = mockApi
export const api: FlowApi = new Proxy({} as FlowApi, {
  get: (_t, k: keyof FlowApi) => current[k],
})
export function setFlowApi(impl: Partial<FlowApi>) {
  current = { ...mockApi, ...impl }
}
