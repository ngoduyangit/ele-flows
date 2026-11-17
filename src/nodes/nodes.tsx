import type { NodeProps } from '@xyflow/react'
import { posterUrl, thumbUrl } from '../lib/thumb'
import { Copy, Upload } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { PromptEditor, docToPlain } from '../components/PromptEditor'
import { Divider, SelectPill, cn } from '../components/ui'
import { api } from '../lib/api'
import { ContinueButton, FrameButton, PresetMenu } from './nodeActions'
import { PROCESS_KINDS, getPorts, sizeForAspect } from '../lib/registry'
import type { BaseNodeData, CommentNodeData, ContentGenerationData, FlowNode, MediaNodeData, ProcessNodeData, TextNodeData } from '../lib/types'
import { activeGeneration, useFlow } from '../store/flowStore'
import { LazyVideo, MediaPreview } from './media'
import {
  DeleteButton,
  DownloadButton,
  InputHandle,
  MediaHandles,
  NodeCard,
  NodeFrame,
  NodeMoreMenu,
  OutputHandle,
  RunButton,
  RunFromHereButton,
  ToolbarIcon,
} from './parts'

type P<T extends BaseNodeData> = NodeProps<FlowNode & { data: T }>

const useUpdate = (id: string) => {
  const update = useFlow((s) => s.updateNodeData)
  return (fn: (d: any) => any) => update(id, fn)
}
const setParam = (key: string, value: unknown) => (d: any) => ({ ...d, parameters: { ...d.parameters, [key]: value } })
// also true after a page reload, while the server is still working on the node's generation
const useRunning = (id: string) =>
  useFlow((s) => {
    if (s.running[id]) return true
    const d: any = s.nodes.find((n) => n.id === id)?.data
    return d?.generations?.find((g: any) => g.id === d.activeGenerationId)?.status === 'running'
  })


function PromptArea({ id, value, onChange, placeholder, children, handle = true, header }: { id: string; value: any; onChange: (v: any) => void; placeholder: string; children?: ReactNode; handle?: boolean; header?: ReactNode }) {
  return (
    <div className="border-t border-border flex items-start relative">
      {handle && <InputHandle nodeId={id} port={{ id: 'prompt', type: 'text', label: 'Prompt' }} style={{ top: 14 }} />}
      <div className="relative isolate w-full overflow-hidden rounded-b-2xl">
        {header}
        <div className="prompt-clamp max-h-[300px] overflow-y-auto nowheel scrollbar-thin [word-break:break-word] px-2 py-1.5">
          <PromptEditor nodeId={id} value={value} onChange={onChange} placeholder={placeholder} className="text-sm px-1.5 py-2 pr-[72px] font-medium min-h-[54px]" />
        </div>
        <div className="absolute right-3.5 bottom-3.5">{children ?? <RunButton id={id} />}</div>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Text                                                               */
/* ================================================================== */

export function TextNode({ id, data, selected, width }: P<TextNodeData>) {
  const update = useUpdate(id)
  const chars = docToPlain(data.text).length
  return (
    <NodeFrame
      id={id}
      data={data}
      selected={selected}
      width={width ?? 300}
      right={`${chars} characters`}
      toolbar={
        <>
          <ToolbarIcon label="Copy text" onClick={() => navigator.clipboard?.writeText(docToPlain(data.text))}>
            <Copy strokeWidth={1.5} />
          </ToolbarIcon>
          <DeleteButton id={id} />
          <NodeMoreMenu id={id} />
        </>
      }
    >
      <NodeCard selected={selected} className="min-h-[200px] grid">
        <div className="relative isolate min-h-[54px] h-full w-full rounded-2xl">
          <div className="max-h-[450px] overflow-y-auto nowheel scrollbar-thin rounded-2xl px-1.5 py-2 pb-10 font-medium [word-break:break-word]">
            <div className="px-2 py-1.5 h-full">
              <PromptEditor value={data.text} onChange={(doc) => update((d: any) => ({ ...d, text: doc }))} placeholder="Write something..." className="min-h-[80px] text-sm" />
            </div>
          </div>
        </div>
        <div className="absolute right-3.5 bottom-3.5 z-10">
          <RunFromHereButton id={id} />
        </div>
        <OutputHandle type="text" />
      </NodeCard>
    </NodeFrame>
  )
}

/* ================================================================== */
/* Content generation (Muse image / video)                            */
/* ================================================================== */

// aspect ratios and lengths Muse accepts
const IMAGE_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4'].map((v) => ({ value: v, label: v }))
const VIDEO_ASPECTS = ['16:9', '9:16'].map((v) => ({ value: v, label: v }))
const DURATIONS = [10, 20, 30, 60].map((v) => ({ value: v, label: `${v}s` }))


const isVideoUrl = (u: string) => /\.(mp4|webm|mov)(\?|$)/i.test(u)

/** Reference thumbnails beside a port. Once the node has an output they only show on hover, so they never cover it. */
/** Connected media inputs as small thumbnails at the top of the prompt area (never over the output). */
function RefStrip({ id, ports }: { id: string; ports: { id: string; label: string; type: string }[] }) {
  const json = useFlow((s) =>
    JSON.stringify(
      ports.flatMap((p) =>
        s.edges
          .filter((e) => e.target === id && e.targetHandle === p.id)
          .map((e) => s.nodes.find((n) => n.id === e.source))
          .filter(Boolean)
          .map((n) => ({ url: (n!.data as MediaNodeData).assetReference?.previewUrl ?? activeGeneration(n!.data)?.url ?? '', title: `${p.label}: ${n!.data.label}` })),
      ),
    ),
  )
  const items = JSON.parse(json) as { url: string; title: string }[]
  if (!items.length) return null
  const cls = 'w-8 h-8 shrink-0 rounded-lg object-cover ring-2 ring-background shadow-natural-xs bg-gray-100'
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-3">
      {items.slice(0, 8).map((it, i) =>
        !it.url ? (
          <span key={i} title={`${it.title} – no output yet`} className={cn(cls, 'ring-1 ring-dashed ring-gray-alpha-300 shadow-none bg-gray-alpha-50')} />
        ) : isVideoUrl(it.url) ? (
          posterUrl(it.url, 256) ? (
            <img key={i} title={it.title} src={posterUrl(it.url, 256)} className={cls} draggable={false} decoding="async" />
          ) : (
            <span key={i} title={it.title} className={cn(cls, 'bg-gray-900')} />
          )
        ) : (
          <img key={i} title={it.title} src={thumbUrl(it.url, 256)} className={cls} draggable={false} decoding="async" />
        ),
      )}
      {items.length > 8 && <span className="text-[11px] text-subtle">+{items.length - 8}</span>}
    </div>
  )
}

function GenerationMediaHandles({ id, data, hasOutput }: { id: string; data: ContentGenerationData; hasOutput?: boolean }) {
  const ports = getPorts({ type: 'content-generation', data }).inputs.filter((x) => x.zone === 'media')
  return (
    <div className="absolute z-10 bottom-0 left-0 py-3.5 flex flex-col items-start gap-2 pointer-events-none">
      {ports.map((port) => (
        <PortRow key={port.id} id={id} port={port} hasOutput={hasOutput} />
      ))}
    </div>
  )
}
function PortRow({ id, port }: { id: string; port: any; hasOutput?: boolean }) {
  return (
    <div className="relative px-3.5">
      <InputHandle nodeId={id} port={port} />
      <div className="w-9 h-9 pointer-events-none invisible" />
    </div>
  )
}

export function ContentGenerationNode({ id, data, selected, width }: P<ContentGenerationData>) {
  const update = useUpdate(id)
  const gen = activeGeneration(data)
  const running = useRunning(id)
  const p = data.parameters
  const { w, h: mediaH } = sizeForAspect(p.aspectRatio)
  void width
  const modality = p.modality
  const placeholder = modality === 'video' ? 'Describe the video...' : 'Describe the image...'

  return (
    <NodeFrame
      id={id}
      data={data}
      selected={selected}
      width={w}
      right={modality === 'video' ? 'Muse Video' : 'Muse Image'}
      toolbar={
        <>
          <div className="flex items-center">
            <SelectPill value={p.aspectRatio} options={modality === 'video' ? VIDEO_ASPECTS : IMAGE_ASPECTS} title="Aspect ratio" onChange={(v) => update(setParam('aspectRatio', v))} />
            {modality === 'video' && (
              <SelectPill
                value={p.video.durationSecs}
                options={DURATIONS}
                title="Duration"
                onChange={(v) => update((d: any) => ({ ...d, parameters: { ...d.parameters, video: { ...d.parameters.video, durationSecs: v } } }))}
              />
            )}
          </div>
          <Divider />
          {modality === 'image' ? (
            <PresetMenu id={id} />
          ) : (
            <>
              <FrameButton id={id} />
              <ContinueButton id={id} />
            </>
          )}
          <Divider />
          <DownloadButton id={id} />
          <DeleteButton id={id} />
          <NodeMoreMenu id={id} />
        </>
      }
    >
      <NodeCard selected={selected}>
        <div className="relative group" style={{ height: mediaH }}>
          <div className="bg-gray-alpha-50 w-full h-full overflow-hidden relative rounded-t-2xl">
            <MediaPreview gen={gen} kind={modality === 'image' ? 'image' : 'video'} running={running} />
          </div>
          <GenerationMediaHandles id={id} data={data} hasOutput={!!gen?.url || running} />
          {(data.generations?.length ?? 0) > 1 && <GenerationPager id={id} data={data} />}
        </div>
        <PromptArea
          id={id}
          value={p.prompt}
          onChange={(doc) => update(setParam('prompt', doc))}
          placeholder={placeholder}
          header={<RefStrip id={id} ports={getPorts({ type: 'content-generation', data }).inputs.filter((x) => x.zone === 'media')} />}
        />
        <OutputHandle type={modality === 'image' ? 'image' : 'video'} />
      </NodeCard>
    </NodeFrame>
  )
}

function GenerationPager({ id, data }: { id: string; data: BaseNodeData }) {
  const gens = data.generations ?? []
  const idx = Math.max(0, gens.findIndex((g) => g.id === data.activeGenerationId))
  const update = useFlow((s) => s.updateNodeData)
  const go = (d: number) => update(id, { activeGenerationId: gens[(idx + d + gens.length) % gens.length].id }, { history: false })
  return (
    <div className="nodrag absolute top-2.5 right-2.5 z-10 flex items-center gap-1 rounded-lg bg-background/90 backdrop-blur px-1 h-7 text-xs font-medium shadow-natural-xs">
      <button type="button" className="px-1 hover:text-foreground text-secondary" onClick={() => go(-1)}>
        ‹
      </button>
      <span className="tabular-nums">
        {idx + 1}/{gens.length}
      </span>
      <button type="button" className="px-1 hover:text-foreground text-secondary" onClick={() => go(1)}>
        ›
      </button>
    </div>
  )
}

/* ================================================================== */
/* Uploaded media (image / video)                                     */
/* ================================================================== */

export function MediaNode({ id, data, selected, width, type }: P<MediaNodeData>) {
  const kind = (type === 'video' ? 'video' : 'image') as 'image' | 'video'
  const update = useUpdate(id)
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const url = data.assetReference?.previewUrl ?? activeGeneration(data)?.url
  const hasAsset = !!data.assetReference?.content_asset_id
  const accept = kind === 'image' ? 'image/*' : 'video/*'
  const onFile = async (file?: File) => {
    if (!file) return
    const res = await api.uploadAsset(file)
    update((d: any) => ({ ...d, assetReference: { ...(d.assetReference ?? {}), content_asset_id: res.content_asset_id, generation_id: null, previewUrl: res.url, mimeType: res.mimeType } }))
  }
  return (
    <NodeFrame
      id={id}
      data={data}
      selected={selected}
      width={width ?? 300}
      toolbar={
        <>
          <button type="button" onClick={() => inputRef.current?.click()} className="nodrag h-8 px-2.5 rounded-[10px] text-sm font-medium hover:bg-gray-alpha-100">
            Replace
          </button>
          {kind === 'image' && <PresetMenu id={id} />}
          {kind === 'video' && (
            <>
              <FrameButton id={id} />
              <ContinueButton id={id} />
            </>
          )}
          <DownloadButton id={id} />
          <Divider />
          <DeleteButton id={id} />
          <NodeMoreMenu id={id} />
        </>
      }
    >
      <NodeCard selected={selected} style={{ minHeight: 100, aspectRatio: '1.77778' }}>
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <div
          className={cn('relative group h-full rounded-2xl overflow-hidden', drag && 'ring-2 ring-blue-500')}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            onFile(e.dataTransfer.files?.[0])
          }}
        >
          {url ? (
            kind === 'image' ? (
              <img src={thumbUrl(url)} className="w-full h-full object-cover rounded-2xl" draggable={false} decoding="async" />
            ) : url.startsWith('data:image') ? (
              <img src={url} className="w-full h-full object-cover rounded-2xl" />
            ) : (
              <LazyVideo src={url} className="w-full h-full object-cover" rounded="rounded-2xl" />
            )
          ) : hasAsset ? (
            <div className="w-full h-full bg-gradient-to-br from-gray-75 to-gray-150 flex items-center justify-center rounded-2xl">
              <p className="text-xs text-subtle font-medium">Asset {data.assetReference?.content_asset_id?.slice(0, 6)}…</p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="nodrag w-full h-full min-h-[100px] stack items-center justify-center gap-2 text-subtle bg-gray-alpha-50 hover:bg-gray-alpha-100 rounded-2xl"
            >
              <Upload className="w-4 h-4" strokeWidth={1.5} />
              <span className="text-xs font-medium">Click or drop to upload {kind}</span>
            </button>
          )}
        </div>
        {(url || hasAsset) && (
          <div className="absolute right-2.5 bottom-2.5 z-10">
            <RunFromHereButton id={id} />
          </div>
        )}
        <OutputHandle type={kind} />
      </NodeCard>
    </NodeFrame>
  )
}

/* ================================================================== */
/* Process node (local tools)                                              */
/* ================================================================== */

/** Extract frame: end (default) / first / a chosen time in seconds. */
function FramePicker({ value, onChange }: { value: { which?: string; at?: number }; onChange: (p: { which: string; at?: number }) => void }) {
  const which = value.which === 'first' || value.which === 'time' ? value.which : 'last'
  const opt = (w: string, label: string) => (
    <button
      type="button"
      onClick={() => onChange({ which: w, ...(w === 'time' ? { at: value.at ?? 0 } : {}) })}
      className={cn('nodrag h-7 px-2.5 rounded-lg text-xs font-medium', which === w ? 'bg-gray-alpha-200' : 'text-secondary hover:bg-gray-alpha-100')}
    >
      {label}
    </button>
  )
  return (
    <div className="flex items-center gap-1 p-2.5 border-t border-border">
      {opt('last', 'End')}
      {opt('first', 'First')}
      {opt('time', 'At time')}
      {which === 'time' && (
        <label className="ml-auto flex items-center gap-1.5 text-xs text-secondary">
          <input
            type="number"
            min={0}
            step={0.1}
            value={value.at ?? 0}
            onChange={(e) => onChange({ which: 'time', at: Math.max(0, Number(e.target.value) || 0) })}
            onKeyDown={(e) => e.stopPropagation()}
            className="nodrag w-16 h-7 rounded-lg ring-1 ring-gray-alpha-200 px-2 text-xs text-foreground outline-none focus:ring-foreground/60"
          />
          s
        </label>
      )}
    </div>
  )
}

export function ProcessNode({ id, data, selected, width }: P<ProcessNodeData>) {
  const update = useUpdate(id)
  const gen = activeGeneration(data)
  const running = useRunning(id)
  const k = PROCESS_KINDS[data.kind]
  if (!k) return null
  const mediaPorts = k.inputs.filter((p) => p.zone === 'media')
  return (
    <NodeFrame
      id={id}
      data={data}
      selected={selected}
      width={width ?? 400}
      right={k.modelName}
      toolbar={
        <>
          <DownloadButton id={id} />
          <DeleteButton id={id} />
          <NodeMoreMenu id={id} />
        </>
      }
    >
      <NodeCard selected={selected}>
        <div className={cn('relative rounded-t-2xl overflow-hidden', !k.hasPrompt && 'rounded-b-2xl')}>
          <div className="bg-gray-alpha-50" style={{ aspectRatio: '16 / 9' }}>
            <MediaPreview gen={gen} kind={k.output === 'video' ? 'video' : 'image'} running={running} emptyText={k.emptyText} />
          </div>
          {!k.hasPrompt && (
            <div className="absolute right-3.5 bottom-3.5 z-20">
              <RunButton id={id} />
            </div>
          )}
        </div>
        <MediaHandles nodeId={id} ports={mediaPorts} />
        {data.kind === 'last-frame' && <FramePicker value={data.parameters as any} onChange={(patch) => update((d: any) => ({ ...d, parameters: { ...d.parameters, ...patch } }))} />}
        {k.hasPrompt && (
          <PromptArea
            id={id}
            value={data.parameters.prompt ?? ''}
            onChange={(doc) => update(setParam('prompt', doc))}
            placeholder={k.placeholder ?? 'Describe...'}
            handle={k.inputs.some((p) => p.id === 'prompt')}
          />
        )}
        <OutputHandle type={k.output} />
      </NodeCard>
    </NodeFrame>
  )
}

/* ================================================================== */
/* Comment                                                            */
/* ================================================================== */

export function CommentNode({ id, data, selected }: P<CommentNodeData>) {
  const update = useUpdate(id)
  return (
    <div className={cn('flex items-start gap-2 w-[260px]')}>
      <div className="w-8 h-8 rounded-full rounded-bl-none bg-amber-300 text-amber-950 flex items-center justify-center text-xs font-semibold shadow-natural-xs shrink-0">
        {data.author?.[0] ?? 'Y'}
      </div>
      <div className={cn('flex-1 rounded-2xl bg-background shadow-natural-sm p-3', selected && 'ring-2 ring-foreground')}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium">{data.author}</span>
          <span className="text-[11px] text-subtle">{new Date(data.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <textarea
          autoFocus={!data.text}
          value={data.text}
          onChange={(e) => update((d: any) => ({ ...d, text: e.target.value }))}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Add a comment..."
          rows={2}
          className="nodrag nowheel w-full resize-none bg-transparent text-sm outline-none placeholder:text-subtle"
        />
      </div>
    </div>
  )
}
