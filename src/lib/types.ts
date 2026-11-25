import type { Edge, Node } from '@xyflow/react'

/** Port (handle) data type. Determines handle colour/icon and which handles may connect. */
export type PortType = 'text' | 'image' | 'video'

/** Rich-text document (Tiptap/ProseMirror JSON). `prompt-tag` nodes reference other nodes. */
export interface DocJSON {
  type: 'doc'
  content?: DocNode[]
}
export interface DocNode {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  content?: DocNode[]
}

export interface TemplateInput {
  id: string
  description: string
  order: number
}

export interface AssetReference {
  content_asset_id: string | null
  generation_id: string | null
  template_node_id?: string | null
  /** Local preview (object URL / data URL) – set when the user uploads a file. */
  previewUrl?: string | null
  mimeType?: string | null
}

/** Result of running a node. The backend integration fills this in. */
export interface Generation {
  id: string
  status: 'queued' | 'running' | 'done' | 'error'
  /** Text output. */
  text?: string
  /** Media output URL (image / video). */
  url?: string
  error?: string
  /** Real charge in VND reported by the provider (Nov) for this run. */
  cost?: number
  createdAt: number
}

export interface BaseNodeData extends Record<string, unknown> {
  label: string
  templateInput?: TemplateInput | null
  templateOutput?: unknown
  activeGenerationId?: string | null
  generations?: Generation[]
  /** Kind from the node catalog (e.g. "last-frame") – lets one React type serve many menu items. */
  kind?: string
}

export interface TextNodeData extends BaseNodeData {
  text: DocJSON
  allowedValues?: string[] | null
}

export interface ContentGenerationData extends BaseNodeData {
  parameters: {
    prompt: DocJSON
    modality: 'image' | 'video'
    aspectRatio: string
    /** Nov only: video 480p | 720p | 1080p, image 1K | 2K */
    resolution?: string
    referenceImages: unknown[]
    video: {
      modelId: string
      durationSecs: number
      [k: string]: unknown
    }
    image: {
      modelId: string
      [k: string]: unknown
    }
  }
}

export interface MediaNodeData extends BaseNodeData {
  assetReference: AssetReference | null
}

/** Processing node (local tools such as extracting a frame from a video). */
export interface ProcessNodeData extends BaseNodeData {
  kind: string
  parameters: { modelId: string; prompt?: string; [k: string]: unknown }
}

export interface CommentNodeData extends BaseNodeData {
  text: string
  author: string
  createdAt: number
}

export type FlowNodeType = 'text' | 'content-generation' | 'image' | 'video' | 'process' | 'comment'

export type FlowNode = Node<BaseNodeData, FlowNodeType>
export type FlowEdge = Edge

export interface FlowDocument {
  id: string
  name: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  viewport?: { x: number; y: number; zoom: number }
  description?: string
  /** Set by the API for spec-created flows: the editor arranges nodes with real sizes on first open. */
  autoLayout?: boolean
  /** Last external (API) replace – the editor sends back the value it loaded, the server refuses stale saves. */
  externalEditAt?: number
  /** Scenes → shots board (null/absent = detected from node labels, see src/shared/board.ts). */
  board?: import('../shared/board').Board | null
  updatedAt: number
  createdAt: number
}
