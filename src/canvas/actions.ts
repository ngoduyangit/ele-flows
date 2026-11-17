import type { XYPosition } from '@xyflow/react'
import { api } from '../lib/api'
import { newNodeId, type CatalogItem } from '../lib/registry'
import { useFlow, type PendingConnection } from '../store/flowStore'

/** Create a node from a catalog item (handles upload + model override). */
export function pickCatalogItem(item: CatalogItem, opts: { modelId?: string; position?: XYPosition; connect?: PendingConnection | null } = {}): string | undefined {
  const st = useFlow.getState()
  if (item.action === 'upload') {
    openFilePicker((files) => {
      const base = opts.position ?? { x: st.viewportCenter.x - 150, y: st.viewportCenter.y - 100 }
      files.forEach((f, i) => addFileNode(f, { x: base.x + i * 40, y: base.y + i * 40 }, i === 0 ? opts.connect : null))
    })
    return undefined
  }
  const id = st.addNode(item, { position: opts.position, connect: opts.connect })
  if (id && opts.modelId) {
    st.updateNodeData(
      id,
      (d: any) => {
        const p = d.parameters
        if (!p) return d
        if (p.modality === 'video') return { ...d, parameters: { ...p, video: { ...p.video, modelId: opts.modelId } } }
        if (p.modality === 'image') return { ...d, parameters: { ...p, image: { ...p.image, modelId: opts.modelId } } }
        return { ...d, parameters: { ...p, modelId: opts.modelId } }
      },
      { history: false },
    )
  }
  return id ?? undefined
}

export function openFilePicker(cb: (files: File[]) => void, accept = 'image/*,video/*') {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.multiple = true
  input.onchange = () => cb(Array.from(input.files ?? []))
  input.click()
}

export async function addFileNode(file: File, position: XYPosition, connect?: PendingConnection | null) {
  const kind = file.type.startsWith('video') ? 'video' : 'image'
  const st = useFlow.getState()
  const id = newNodeId()
  st.addRawNode(
    {
      id,
      type: kind,
      position,
      width: 300,
      data: { label: file.name.replace(/\.[^.]+$/, ''), assetReference: null, templateInput: null },
    },
    connect,
  )
  const res = await api.uploadAsset(file)
  st.updateNodeData(
    id,
    (d: any) => ({ ...d, assetReference: { content_asset_id: res.content_asset_id, generation_id: null, previewUrl: res.url, mimeType: res.mimeType } }),
    { history: false },
  )
}
