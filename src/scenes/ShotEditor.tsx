import { ChevronLeft, ChevronRight, Ellipsis, ImageIcon, ImagePlus, LocateFixed, Plus, Split, Video, Volume2, VolumeX, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PromptEditor } from '../components/PromptEditor'
import { Button, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, PopoverContent, PopoverRoot, PopoverTrigger, SelectPill, Tip, cn } from '../components/ui'
import { nodeOutputUrl } from '../lib/graphOps'
import { getOutputType } from '../lib/registry'
import { posterUrl, thumbUrl } from '../lib/thumb'
import type { FlowNode } from '../lib/types'
import { GenerationPlaceholder, RunButton } from '../nodes/parts'
import { navigate } from '../router'
import { naturalCompare, type ResolvedScene, type ResolvedShot } from '../shared/board'
import { IMAGE_MODELS, NOV_TEST_RESOLUTION, VIDEO_MODELS, novPricing } from '../shared/novPricing'
import { activeGeneration, useFlow } from '../store/flowStore'
import { createStill, createVideo, detachStill, disconnect, moveShot, removeShot, setShotNote } from './boardOps'
import { aspectNum, shotCode, shotTitle } from './shotInfo'

const IMAGE_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4'].map((v) => ({ value: v, label: v }))
const VIDEO_ASPECTS = ['16:9', '9:16'].map((v) => ({ value: v, label: v }))

const IMAGE_PORTS = ['startFrame', 'endFrame', 'referenceImages', 'image']
const PORT_TAG: Record<string, string> = { startFrame: 'Start', endFrame: 'End', image: 'Src' }
const isVideoUrl = (u: string) => /\.(mp4|webm|mov)(\?|$)/i.test(u)

function openInCanvas(nodeId: string) {
  const st = useFlow.getState()
  useFlow.setState({ canvasFocus: nodeId })
  navigate(`/flows/${st.flowId}`)
}

export function ShotEditor({
  shot,
  scene,
  scenes,
  index,
  onPrev,
  onNext,
}: {
  shot: ResolvedShot
  scene: ResolvedScene
  scenes: ResolvedScene[]
  index: number
  onPrev?: () => void
  onNext?: () => void
}) {
  const shared = shot.sharedWith.map((id) => {
    for (const sc of scenes) {
      const i = sc.shots.findIndex((s) => s.id === id)
      if (i >= 0) return `${sc.id === scene.id ? '' : `${sc.name} · `}S${String(i + 1).padStart(2, '0')}`
    }
    return ''
  })
  return (
    <section className="flex-1 min-h-0 overflow-y-auto scrollbar-thin rounded-2xl bg-background shadow-natural-xs">
      <div className="sticky top-0 z-10 flex items-center gap-2 h-12 px-4 border-b border-border bg-background/95 backdrop-blur">
        <span className="shrink-0 inline-flex items-center h-6 px-2 rounded-md bg-foreground text-background text-xs font-semibold tabular-nums">S{String(index + 1).padStart(2, '0')}</span>
        {shotCode(shot) && <span className="shrink-0 text-xs font-medium text-secondary tabular-nums">{shotCode(shot)}</span>}
        <p className="min-w-0 truncate text-sm font-medium" title={String(shot.head.data.label ?? '')}>
          {shotTitle(shot) || String(shot.head.data.label ?? '')}
        </p>
        <span className="text-xs text-subtle shrink-0">· {scene.name}</span>
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          <Tip label="Previous shot" shortcut="←">
            <Button size="icon-sm" disabled={!onPrev} onClick={onPrev}>
              <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
            </Button>
          </Tip>
          <Tip label="Next shot" shortcut="→">
            <Button size="icon-sm" disabled={!onNext} onClick={onNext}>
              <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
            </Button>
          </Tip>
          <Menu>
            <MenuTrigger asChild>
              <Button size="icon-sm" aria-label="Shot actions">
                <Ellipsis className="w-4 h-4" strokeWidth={1.5} />
              </Button>
            </MenuTrigger>
            <MenuContent align="end" className="min-w-[220px]">
              <MenuItem onSelect={() => openInCanvas(shot.head.id)}>Open in canvas</MenuItem>
              {scenes.length > 1 && (
                <>
                  <MenuSeparator />
                  <MenuLabel>Move to scene</MenuLabel>
                  {scenes
                    .filter((s) => s.id !== scene.id)
                    .map((s) => (
                      <MenuItem key={s.id} onSelect={() => moveShot(shot.id, s.id, s.shots.length)}>
                        {s.name}
                      </MenuItem>
                    ))}
                </>
              )}
              <MenuSeparator />
              <MenuItem onSelect={() => removeShot(shot.id)}>Remove from board (keep nodes)</MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* keyed by the stored note: undo/redo shows up, typing (saved on blur) is never reset */}
        <NoteField key={`${shot.id}:${shot.note ?? ''}`} shotId={shot.id} note={shot.note} />
        {shot.sharedWith.length > 0 && shot.still && (
          <div className="flex items-center gap-3 rounded-xl bg-amber-50 text-amber-900 px-3 py-2 text-xs">
            <Split className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            <p className="min-w-0">
              This still is shared with {shared.filter(Boolean).join(', ') || `${shot.sharedWith.length} other shots`} – editing or re-running it changes those shots too.
            </p>
            <Button size="xs" variant="outline" className="ml-auto shrink-0" onClick={() => detachStill(shot.id)}>
              Make independent
            </Button>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {shot.still ? (
            <NodePane id={shot.still.id} role="still" />
          ) : (
            <MissingPane role="still" onCreate={() => createStill(shot.id)} />
          )}
          {shot.video ? <NodePane id={shot.video.id} role="video" /> : <MissingPane role="video" disabled={!shot.still} onCreate={() => createVideo(shot.id)} />}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Notes                                                              */
/* ------------------------------------------------------------------ */

function NoteField({ shotId, note }: { shotId: string; note?: string }) {
  const [draft, setDraft] = useState(note ?? '')
  return (
    <textarea
      value={draft}
      rows={1}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== (note ?? '') && setShotNote(shotId, draft)}
      placeholder="Notes – dialogue, action, camera, trim…"
      className="w-full resize-y min-h-9 rounded-xl bg-gray-alpha-50 px-3 py-2 text-sm leading-5 outline-none placeholder:text-subtle focus:ring-1 focus:ring-gray-alpha-300"
    />
  )
}

/* ------------------------------------------------------------------ */
/* Still / video pane                                                 */
/* ------------------------------------------------------------------ */

const setParam = (key: string, value: unknown) => (d: any) => ({ ...d, parameters: { ...d.parameters, [key]: value } })

function NodePane({ id, role }: { id: string; role: 'still' | 'video' }) {
  const node = useFlow((s) => s.nodes.find((n) => n.id === id))
  const running = useFlow((s) => {
    if (s.running[id]) return true
    const d: any = s.nodes.find((n) => n.id === id)?.data
    return d?.generations?.find((g: any) => g.id === d.activeGenerationId)?.status === 'running'
  })
  if (!node) return null
  const update = (fn: (d: any) => any) => useFlow.getState().updateNodeData(id, fn)
  const d: any = node.data
  const p = d.parameters ?? {}
  const isGen = node.type === 'content-generation'
  const isVideo = isGen && p.modality !== 'image'
  const gens = d.generations ?? []
  const Icon = role === 'video' ? Video : ImageIcon
  const ratio = aspectNum(p.aspectRatio ?? '16:9')
  const modelId = isVideo ? p.video?.modelId : p.image?.modelId
  const setModel = (v: string) =>
    update((dd: any) => ({
      ...dd,
      parameters: {
        ...dd.parameters,
        [isVideo ? 'video' : 'image']: { ...dd.parameters[isVideo ? 'video' : 'image'], modelId: v },
        // Seedance via Nov: test runs at 480p (cheapest), raise for the final take
        ...(isVideo && v.startsWith('nov/') && !String(modelId).startsWith('nov/') ? { resolution: '480p' } : {}),
      },
    }))
  // same choices as the canvas node: Seedance → its own durations/resolutions, Muse → 10/20/30/60 s
  const pricing = isVideo ? novPricing(modelId) : undefined
  const durations = (pricing ? pricing.durations : [10, 20, 30, 60]).map((v: number) => ({ value: v, label: `${v}s` }))
  const resolutions = (pricing ? pricing.resolutions : ['1K', '2K']).map((v: string) => ({ value: v, label: v }))
  const isNov = String(modelId ?? '').startsWith('nov/')

  return (
    <div className="rounded-xl ring-1 ring-gray-alpha-150 overflow-hidden flex flex-col bg-background min-w-0">
      <div className="h-10 px-3 flex items-center gap-2 border-b border-border">
        <Icon className="w-4 h-4 shrink-0 text-secondary" strokeWidth={1.5} />
        <span className="text-xs font-semibold uppercase tracking-wide text-secondary shrink-0">{role}</span>
        <InlineLabel id={id} label={String(d.label ?? '')} />
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {gens.length > 1 && <Pager id={id} gens={gens} active={d.activeGenerationId} />}
          <Tip label="Open in canvas">
            <Button size="icon-xs" onClick={() => openInCanvas(id)}>
              <LocateFixed className="w-3.5 h-3.5" strokeWidth={1.5} />
            </Button>
          </Tip>
        </div>
      </div>
      {/* capped height: the prompt and Run stay on screen without scrolling */}
      <div className="bg-gray-alpha-50 flex justify-center" style={ratio >= 1 ? { aspectRatio: String(ratio), maxHeight: '30vh' } : { height: 'min(420px, 42vh)' }}>
        <div className="relative overflow-hidden h-full" style={ratio >= 1 ? { width: '100%' } : { aspectRatio: String(ratio) }}>
          <BigPreview node={node} kind={role === 'video' ? 'video' : 'image'} running={running} />
        </div>
      </div>
      {(isGen || node.type === 'process') && <RefRow id={id} />}
      {isGen && (
        <div className="px-2 py-1 border-t border-border max-h-[260px] overflow-y-auto scrollbar-thin [word-break:break-word]">
          <PromptEditor
            nodeId={id}
            value={p.prompt}
            onChange={(doc) => update(setParam('prompt', doc))}
            placeholder={role === 'video' ? 'Describe the motion, action and dialogue… (@ to reference a node)' : 'Describe the frame… (@ to reference a character, set or sheet)'}
            className="text-sm px-1.5 py-2 font-medium min-h-[72px]"
          />
        </div>
      )}
      <div className="flex items-center gap-0.5 px-2 py-2 border-t border-border flex-wrap">
        {isGen && (
          <>
            <SelectPill value={modelId ?? 'muse'} options={isVideo ? VIDEO_MODELS : IMAGE_MODELS} title="Model" onChange={setModel} />
            {isVideo && (
              <SelectPill
                value={p.video?.durationSecs ?? 10}
                options={durations}
                title="Duration"
                onChange={(v) => update((dd: any) => ({ ...dd, parameters: { ...dd.parameters, video: { ...dd.parameters.video, durationSecs: v } } }))}
              />
            )}
            <SelectPill value={p.aspectRatio ?? '16:9'} options={isVideo ? VIDEO_ASPECTS : IMAGE_ASPECTS} title="Aspect ratio" onChange={(v) => update(setParam('aspectRatio', v))} />
            {isNov && <SelectPill value={p.resolution ?? (isVideo ? NOV_TEST_RESOLUTION : '2K')} options={resolutions} title="Resolution" onChange={(v) => update(setParam('resolution', v))} />}
            {isVideo && isNov && (
              <Tip label={p.video?.generateAudio ? 'Audio on' : 'Audio off'}>
                <Button
                  size="icon-sm"
                  onClick={() => update((dd: any) => ({ ...dd, parameters: { ...dd.parameters, video: { ...dd.parameters.video, generateAudio: !dd.parameters.video?.generateAudio } } }))}
                >
                  {p.video?.generateAudio ? <Volume2 className="w-4 h-4" strokeWidth={1.5} /> : <VolumeX className="w-4 h-4" strokeWidth={1.5} />}
                </Button>
              </Tip>
            )}
          </>
        )}
        {!isGen && node.type !== 'process' && <span className="px-1 text-xs text-subtle">Uploaded asset – replace it on the canvas</span>}
        {(isGen || node.type === 'process') && (
          <div className="ml-auto">
            <RunButton id={id} label={gens.length ? 'Retake' : 'Run'} />
          </div>
        )}
      </div>
    </div>
  )
}

function InlineLabel({ id, label }: { id: string; label: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const commit = () => {
    const v = draft.trim()
    if (v && v !== label) useFlow.getState().updateNodeData(id, { label: v })
    setEditing(false)
  }
  if (editing)
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        className="min-w-0 flex-1 h-6 px-1 text-xs font-medium rounded outline-none ring-1 ring-gray-alpha-300 bg-background"
      />
    )
  return (
    <span
      className="min-w-0 truncate text-xs font-medium cursor-text"
      title={`${label} – double-click to rename`}
      onDoubleClick={() => {
        setDraft(label)
        setEditing(true)
      }}
    >
      {label}
    </span>
  )
}

function Pager({ id, gens, active }: { id: string; gens: { id: string }[]; active?: string | null }) {
  const idx = Math.max(0, gens.findIndex((g) => g.id === active))
  const go = (delta: number) => useFlow.getState().updateNodeData(id, { activeGenerationId: gens[(idx + delta + gens.length) % gens.length].id }, { history: false })
  return (
    <Tip label="Takes – pick the one used downstream">
      <div className="flex items-center h-6 rounded-md bg-gray-alpha-100 text-xs font-medium tabular-nums">
        <button type="button" className="px-1.5 text-secondary hover:text-foreground" onClick={() => go(-1)}>
          ‹
        </button>
        <span>
          {idx + 1}/{gens.length}
        </span>
        <button type="button" className="px-1.5 text-secondary hover:text-foreground" onClick={() => go(1)}>
          ›
        </button>
      </div>
    </Tip>
  )
}

function BigPreview({ node, kind, running }: { node: FlowNode; kind: 'image' | 'video'; running: boolean }) {
  const gen = activeGeneration(node.data)
  const url = nodeOutputUrl(node)
  if (running) return <GenerationPlaceholder running />
  if (gen?.status === 'error' && !url)
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-4 text-center">
        <p className="text-xs font-medium text-red-600">Generation failed</p>
        <p className="text-xs text-subtle line-clamp-4">{gen.error}</p>
      </div>
    )
  if (!url) return <GenerationPlaceholder text={kind === 'video' ? 'No video yet – write the motion and press Run' : 'No still yet – write the frame and press Run'} />
  if (kind === 'video' || isVideoUrl(url))
    // one clip at a time on the board: a real player, but nothing downloads before play
    return <video key={url} src={url} poster={posterUrl(url, 768)} controls preload="none" playsInline className="w-full h-full object-contain bg-black" />
  return (
    <a href={url} target="_blank" rel="noreferrer" title="Open full size" className="block w-full h-full">
      <img src={thumbUrl(url, 768)} className="w-full h-full object-contain" draggable={false} decoding="async" />
    </a>
  )
}

/* ------------------------------------------------------------------ */
/* Inputs: start frame, references                                    */
/* ------------------------------------------------------------------ */

function RefRow({ id }: { id: string }) {
  const json = useFlow((s) =>
    JSON.stringify(
      s.edges
        .filter((e) => e.target === id && [...IMAGE_PORTS, 'video'].includes(e.targetHandle ?? ''))
        .map((e) => {
          const n = s.nodes.find((x) => x.id === e.source)
          return { edge: e.id, port: e.targetHandle ?? '', label: String(n?.data.label ?? ''), url: nodeOutputUrl(n) ?? '' }
        })
        .sort((a, b) => IMAGE_PORTS.indexOf(a.port) - IMAGE_PORTS.indexOf(b.port)),
    ),
  )
  // references are numbered as the provider receives them ("reference image 1, 2…")
  const items = (JSON.parse(json) as { edge: string; port: string; label: string; url: string }[]).map((it, i, all) => ({
    ...it,
    tag: it.port === 'referenceImages' ? String(all.slice(0, i + 1).filter((x) => x.port === 'referenceImages').length) : (PORT_TAG[it.port] ?? ''),
  }))
  const isProcess = useFlow((s) => s.nodes.find((n) => n.id === id)?.type === 'process')
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-t border-border">
      <span className="text-[11px] font-medium text-subtle mr-1">{items.length ? 'Inputs' : 'No inputs'}</span>
      {items.map((it) => {
        const tag = it.tag
        return (
          <div key={it.edge} className="group relative" title={`${it.port === 'referenceImages' ? `Reference image ${tag}` : it.port}: ${it.label}`}>
            {it.url ? (
              <img src={isVideoUrl(it.url) ? posterUrl(it.url, 256) : thumbUrl(it.url, 256)} className="w-9 h-9 rounded-lg object-cover bg-gray-100 ring-1 ring-gray-alpha-150" draggable={false} decoding="async" />
            ) : (
              <span className="block w-9 h-9 rounded-lg ring-1 ring-dashed ring-gray-alpha-300 bg-gray-alpha-50" />
            )}
            {tag && <span className="absolute -bottom-1 -left-1 min-w-4 h-4 px-1 rounded bg-foreground text-background text-[10px] font-semibold leading-4 text-center">{tag}</span>}
            {!isProcess && (
              <button
                type="button"
                aria-label="Disconnect"
                onClick={() => disconnect(it.edge)}
                className="absolute -top-1.5 -right-1.5 hidden group-hover:flex w-4 h-4 rounded-full bg-foreground text-background items-center justify-center"
              >
                <X className="w-2.5 h-2.5" strokeWidth={2.5} />
              </button>
            )}
          </div>
        )
      })}
      {!isProcess && <AddRef id={id} />}
    </div>
  )
}

function AddRef({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <Tip label="Add reference image">
        <PopoverTrigger asChild>
          <button type="button" className="w-9 h-9 rounded-lg border border-dashed border-gray-alpha-300 text-secondary hover:bg-gray-alpha-50 flex items-center justify-center">
            <Plus className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent className="w-[340px] p-0" align="start">
        {open && <RefPicker id={id} q={q} setQ={setQ} onPick={() => setOpen(false)} />}
      </PopoverContent>
    </PopoverRoot>
  )
}

/** Mounted only while open – reads the graph once instead of subscribing to every change. */
function RefPicker({ id, q, setQ, onPick }: { id: string; q: string; setQ: (v: string) => void; onPick: () => void }) {
  const items = useMemo(() => {
    const s = useFlow.getState()
    const ql = q.trim().toLowerCase()
    return s.nodes
      .filter((n) => n.id !== id && getOutputType(n) === 'image' && (!ql || String(n.data.label ?? '').toLowerCase().includes(ql)))
      .filter((n) => s.isValidConnection({ source: n.id, sourceHandle: 'output', target: id, targetHandle: 'referenceImages' }))
      // uploaded assets (faces, sheets) first, then generated images
      .sort((a, b) => Number(b.type === 'image') - Number(a.type === 'image') || naturalCompare(String(a.data.label ?? ''), String(b.data.label ?? '')))
      .slice(0, 60)
  }, [id, q])
  return (
    <div className="flex flex-col max-h-[420px]">
      <div className="p-2 border-b border-border">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search images, sheets, sets…"
          className="w-full h-8 px-2.5 rounded-lg bg-gray-alpha-50 text-sm outline-none focus:ring-1 focus:ring-gray-alpha-300"
        />
      </div>
      <div className="overflow-y-auto scrollbar-thin p-1">
        {!items.length && <p className="px-2 py-6 text-center text-xs text-subtle">No matching image nodes</p>}
        {items.map((n) => {
          const url = nodeOutputUrl(n)
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                useFlow.getState().onConnect({ source: n.id, sourceHandle: 'output', target: id, targetHandle: 'referenceImages' })
                onPick()
              }}
              className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-gray-alpha-100"
            >
              {url ? <img src={thumbUrl(url, 256)} className="w-9 h-9 rounded-md object-cover bg-gray-100 shrink-0" decoding="async" /> : <span className="w-9 h-9 rounded-md bg-gray-alpha-100 shrink-0" />}
              <span className="text-xs font-medium truncate">{String(n.data.label ?? '')}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MissingPane({ role, onCreate, disabled }: { role: 'still' | 'video'; onCreate: () => void; disabled?: boolean }) {
  const Icon = role === 'video' ? Video : ImagePlus
  return (
    <div className="rounded-xl border border-dashed border-gray-alpha-300 min-h-[240px] flex flex-col items-center justify-center gap-3 p-6 text-center">
      <Icon className="w-5 h-5 text-subtle" strokeWidth={1.5} />
      <div className="space-y-1">
        <p className="text-sm font-medium">{role === 'video' ? 'No video for this shot yet' : 'This video has no still'}</p>
        <p className="text-xs text-secondary max-w-[300px]">
          {role === 'video'
            ? 'Creates a video node wired from the still, with the model and duration the other shots use.'
            : 'Creates an image node for the frame and wires it into the video (start frame / reference).'}
        </p>
      </div>
      <Button variant="primary" size="sm" disabled={disabled} onClick={onCreate} className={cn(disabled && 'opacity-60')}>
        {role === 'video' ? 'Create video' : 'Create still'}
      </Button>
    </div>
  )
}
