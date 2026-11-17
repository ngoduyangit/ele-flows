import {
  ArrowRightToLine,
  Image as ImageIcon,
  ImagePlus,
  ImageDown,
  MessageSquare,
  Sparkles,
  Type,
  Upload,
  Video,
  VideoIcon,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import type { BaseNodeData, DocJSON, FlowNode, FlowNodeType, PortType } from './types'
import { PROCESS_PORTS, baseContentGen, portsFor, type PortDef } from '../shared/flowSpec'

export const emptyDoc = (text?: string): DocJSON => ({
  type: 'doc',
  content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }],
})

export const newNodeId = () => nanoid(20)

/* ------------------------------------------------------------------ */
/* Ports                                                              */
/* ------------------------------------------------------------------ */

export type { PortDef }

export const PORT_ICON: Record<PortType, LucideIcon> = {
  text: Type,
  image: ImageIcon,
  video: VideoIcon,
}

export const PORT_LABEL: Record<PortType, string> = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
}

/** Process kinds and their I/O. */
export interface ProcessKind {
  kind: string
  label: string
  icon: LucideIcon
  inputs: PortDef[]
  output: PortType
  modelId: string
  modelName: string
  hasPrompt?: boolean
  placeholder?: string
  emptyText: string
}

export const PROCESS_KINDS: Record<string, ProcessKind> = {
  'last-frame': {
    kind: 'last-frame',
    label: 'Extract frame',
    icon: ImageDown,
    inputs: [{ id: 'video', type: 'video', label: 'Video', zone: 'media' }],
    output: 'image',
    modelId: 'ffmpeg',
    modelName: 'Local · ffmpeg',
    emptyText: 'The extracted frame will appear here',
  },
}

// I/O of process kinds comes from the shared schema (single source of truth for UI + server)
for (const [k, v] of Object.entries(PROCESS_KINDS)) {
  const shared = PROCESS_PORTS[k]
  if (shared) Object.assign(v, { inputs: shared.inputs, output: shared.output })
}

export function getPorts(node: Pick<FlowNode, 'type' | 'data'>): { inputs: PortDef[]; output: PortType | null } {
  return portsFor(node.type, node.data as Record<string, any>)
}

export function getOutputType(node: Pick<FlowNode, 'type' | 'data'> | undefined): PortType | null {
  return node ? getPorts(node).output : null
}

export function getInputPort(node: Pick<FlowNode, 'type' | 'data'> | undefined, handleId: string | null | undefined) {
  if (!node || !handleId) return undefined
  return getPorts(node).inputs.find((p) => p.id === handleId)
}

/* ------------------------------------------------------------------ */
/* Node header icon                                                   */
/* ------------------------------------------------------------------ */

export function nodeIcon(node: Pick<FlowNode, 'type' | 'data'>): LucideIcon {
  const d = node.data as any
  switch (node.type) {
    case 'text':
      return d?.templateInput ? ArrowRightToLine : Type
    case 'content-generation':
      return d?.parameters?.modality === 'video' ? Video : ImagePlus
    case 'image':
      return d?.templateInput ? ArrowRightToLine : ImageIcon
    case 'video':
      return d?.templateInput ? ArrowRightToLine : Video
    case 'process':
      return PROCESS_KINDS[d?.kind]?.icon ?? WandSparkles
    case 'comment':
      return MessageSquare
    default:
      return Sparkles
  }
}

/* ------------------------------------------------------------------ */
/* Catalog (add-node menu)                                            */
/* ------------------------------------------------------------------ */

export type CatalogCategory = 'Image' | 'Video' | 'Text' | 'Other'

export interface CatalogItem {
  key: string
  label: string
  icon: LucideIcon
  category: CatalogCategory
  mostUsed?: boolean
  keywords?: string
  /** Special action instead of creating a node right away. */
  action?: 'upload'
  create?: () => { type: FlowNodeType; data: BaseNodeData; width?: number }
}

export { baseContentGen }

const processItem = (kind: string, category: CatalogCategory): CatalogItem => {
  const k = PROCESS_KINDS[kind]
  return {
    key: kind,
    label: k.label,
    icon: k.icon,
    category,
    create: () => ({
      type: 'process',
      width: 400,
      data: { label: k.label, kind, parameters: { modelId: k.modelId, prompt: '' }, templateOutput: null },
    }),
  }
}

export const CATALOG: CatalogItem[] = [
  {
    key: 'image-generation',
    label: 'Image generation',
    icon: ImagePlus,
    category: 'Image',
    mostUsed: true,
    keywords: 'text to image picture photo muse',
    create: () => ({ type: 'content-generation', width: 533, data: baseContentGen('image', 'Image') }),
  },
  {
    key: 'video-generation',
    label: 'Video generation',
    icon: Video,
    category: 'Video',
    mostUsed: true,
    keywords: 'text to video image to video muse',
    create: () => ({ type: 'content-generation', width: 533, data: baseContentGen('video', 'Video') }),
  },
  { key: 'upload', label: 'Upload media', icon: Upload, category: 'Other', mostUsed: true, action: 'upload', keywords: 'file image video' },
  processItem('last-frame', 'Video'),
  {
    key: 'text',
    label: 'Text',
    icon: Type,
    category: 'Text',
    mostUsed: true,
    create: () => ({ type: 'text', width: 300, data: { label: 'Text', text: emptyDoc(), allowedValues: null } }),
  },
]

export const CATALOG_SECTIONS: CatalogCategory[] = ['Image', 'Video', 'Text', 'Other']

/** Items offered when a connection is dropped on empty canvas, given the dragged port type & direction. */
export function suggestionsFor(portType: PortType, fromSource: boolean): CatalogItem[] {
  const keys: string[] = (fromSource
    ? {
        image: ['video-generation', 'image-generation'],
        video: ['last-frame'],
        text: ['image-generation', 'video-generation'],
      }[portType]
    : {
        image: ['image-generation', 'last-frame', 'upload'],
        video: ['video-generation', 'upload'],
        text: ['text'],
      }[portType]) as string[]
  return keys.map((k) => CATALOG.find((c) => c.key === k)!).filter(Boolean)
}

/** Label overrides in the drop-on-canvas menu. */
export const SUGGESTION_LABEL: Record<string, string> = {
  'last-frame': 'Extract end frame',
}

export const DEFAULT_WIDTH: Partial<Record<FlowNodeType, number>> = {
  text: 300,
  'content-generation': 533,
  image: 300,
  video: 300,
  process: 400,
}


const aspectRatioNum = (a: string) => {
  const [w, h] = a.split(':').map(Number)
  return w && h ? w / h : 16 / 9
}

/** Node size for a media aspect ratio: landscape keeps the reference 533px width, portrait gets narrower. */
export function sizeForAspect(a: string): { w: number; h: number } {
  const r = aspectRatioNum(a)
  if (r >= 1.2) return { w: 533, h: Math.round(533 / r) }
  if (r >= 0.9) return { w: 420, h: Math.round(420 / r) }
  const w = Math.max(300, Math.round(480 * r))
  return { w, h: Math.round(w / r) }
}

/** Approximate full height of a generation node (label + media + prompt + toolbar) – used for auto placement. */
export function nodeFootprint(aspect: string) {
  const { w, h } = sizeForAspect(aspect)
  // label 24 + prompt area (grows up to 300px) + toolbar ~70
  return { w, h: h + 24 + 300 + 70 }
}
