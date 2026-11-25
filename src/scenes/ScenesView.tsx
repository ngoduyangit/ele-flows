/**
 * Scenes & shots board: the flow as scenes → shots instead of a node graph. A horizontal strip of stills per
 * scene to see the cut at a glance, and one shot open at a time (its still and video side by side) so an angle
 * is fixed in its own nodes without touching the other shots. Same store, history and autosave as the canvas.
 */
import { ChevronDown, ChevronRight, Clapperboard, Ellipsis, ImageIcon, LoaderCircle, Play, Plus, Video } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Button, MOD, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tip, cn } from '../components/ui'
import { navigate } from '../router'
import { resolveBoard, type ResolvedBoard, type ResolvedScene, type ResolvedShot } from '../shared/board'
import { docToPlain } from '../shared/runRequest'
import { useFlow } from '../store/flowStore'
import { addNodesAsShots, addScene, addShot, deleteScene, moveScene, moveShot, renameScene, resetBoard, restoreHidden } from './boardOps'
import { ShotEditor } from './ShotEditor'
import { fmtDuration, nodeStatus, promptExcerpt, shotAspect, shotCode, shotDuration, shotThumb, shotTitle, type Status } from './shotInfo'

type Sel = { scene: string | null; shot: string | null }
type Drop = { scene: string; index: number } | null
const pad = (n: number) => String(n).padStart(2, '0')
const selKey = (flowId: string) => `flows:scenes:${flowId}`

function loadSel(flowId: string): Sel {
  try {
    const v = JSON.parse(localStorage.getItem(selKey(flowId)) ?? 'null')
    if (v && typeof v === 'object') return { scene: v.scene ?? null, shot: v.shot ?? null }
  } catch {
    /* private mode / blocked storage – start at the first shot */
  }
  return { scene: null, shot: null }
}

/** dataTransfer can't be read during dragover – the dragged shot lives here. */
let dragShot: string | null = null

interface Dnd {
  start: (shotId: string) => (e: DragEvent) => void
  over: (sceneId: string, index: number, axis: 'x' | 'y') => (e: DragEvent) => void
  overEnd: (sceneId: string, count: number) => (e: DragEvent) => void
  drop: (e: DragEvent) => void
  end: () => void
}

export function ScenesView({ flowId }: { flowId: string }) {
  const nodes = useFlow((s) => s.nodes)
  const edges = useFlow((s) => s.edges)
  const stored = useFlow((s) => s.board)
  const running = useFlow((s) => s.running)
  const r = useMemo(() => resolveBoard(stored, nodes, edges), [stored, nodes, edges])
  const [sel, setSel] = useState<Sel>(() => loadSel(flowId))
  const [drop, setDrop] = useState<Drop>(null)
  const dropRef = useRef<Drop>(null)
  dropRef.current = drop

  // opened from the canvas with a node selected → select that node's shot
  useEffect(() => {
    const focus = useFlow.getState().scenesFocus
    if (!focus) return
    useFlow.setState({ scenesFocus: null })
    for (const sc of r.scenes) for (const sh of sc.shots) if (sh.head.id === focus || sh.still?.id === focus) return setSel({ scene: sc.id, shot: sh.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scene = r.scenes.find((s) => s.shots.some((sh) => sh.id === sel.shot)) ?? r.scenes.find((s) => s.id === sel.scene) ?? r.scenes[0] ?? null
  const shot = scene?.shots.find((s) => s.id === sel.shot) ?? scene?.shots[0] ?? null
  const index = shot && scene ? scene.shots.indexOf(shot) : -1

  useEffect(() => {
    try {
      localStorage.setItem(selKey(flowId), JSON.stringify({ scene: scene?.id ?? null, shot: shot?.id ?? null }))
    } catch {
      /* storage unavailable – selection just isn't remembered */
    }
  }, [flowId, scene?.id, shot?.id])

  const select = useCallback((sceneId: string, shotId: string | null) => setSel({ scene: sceneId, shot: shotId }), [])
  const flat = r.scenes.flatMap((s) => s.shots.map((sh) => ({ scene: s.id, shot: sh.id })))
  const pos = shot ? flat.findIndex((x) => x.shot === shot.id) : -1
  const go = (d: number) => {
    const t = flat[pos + d]
    if (t) setSel(t)
  }
  const live = useRef({ go, shot })
  live.current = { go, shot }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t instanceof Element && t.closest('input, textarea, [contenteditable="true"]')) return
      if (document.querySelector('[role="menu"], [role="dialog"]')) return
      const st = useFlow.getState()
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) st.redo()
        else st.undo()
      } else if (mod && k === 'y') {
        e.preventDefault()
        st.redo()
      } else if (mod && k === 'k') {
        e.preventDefault()
        st.setQuickActionsOpen(true)
      } else if (mod && k === ',') {
        e.preventDefault()
        st.setSettingsOpen(true)
      } else if (mod && k === 'enter') {
        const sh = live.current.shot
        const target = sh?.video ?? sh?.still
        if (target) {
          e.preventDefault()
          void st.runNodes([target.id], false)
        }
      } else if (!mod && e.shiftKey && e.code === 'KeyS') {
        navigate(`/flows/${flowId}`)
      } else if (!mod && !e.shiftKey && (k === 'arrowright' || k === 'arrowleft')) {
        e.preventDefault()
        live.current.go(k === 'arrowright' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flowId])

  const dnd = useMemo<Dnd>(() => {
    const set = (scene: string, index: number) => setDrop((d) => (d?.scene === scene && d.index === index ? d : { scene, index }))
    return {
      start: (shotId) => (e) => {
        dragShot = shotId
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', shotId)
      },
      over: (sceneId, i, axis) => (e) => {
        if (!dragShot) return
        e.preventDefault()
        e.stopPropagation()
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const after = axis === 'x' ? e.clientX > rect.left + rect.width / 2 : e.clientY > rect.top + rect.height / 2
        set(sceneId, i + (after ? 1 : 0))
      },
      overEnd: (sceneId, count) => (e) => {
        if (!dragShot) return
        e.preventDefault()
        e.stopPropagation()
        set(sceneId, count)
      },
      drop: (e) => {
        e.preventDefault()
        e.stopPropagation()
        const d = dropRef.current
        if (dragShot && d) {
          moveShot(dragShot, d.scene, d.index)
          setSel((s) => ({ scene: d.scene, shot: s.shot }))
        }
        dragShot = null
        setDrop(null)
      },
      end: () => {
        dragShot = null
        setDrop(null)
      },
    }
  }, [])

  const onAddShot = () => {
    if (!scene) return
    const id = addShot(scene.id, shot?.id)
    if (id) select(scene.id, id)
  }

  return (
    <div className="absolute inset-0 pt-[72px] flex gap-4 px-4 pb-4 bg-gray-50">
      <SceneTree r={r} sceneId={scene?.id} shotId={shot?.id} running={running} onSelect={select} drop={drop} dnd={dnd} />
      <main className="flex-1 min-w-0 flex flex-col gap-3">
        {scene ? (
          <>
            <SceneHeader key={scene.id} scene={scene} scenes={r.scenes} running={running} onAddShot={onAddShot} onSelect={select} />
            <ShotStrip scene={scene} shotId={shot?.id} running={running} onSelect={select} onAdd={onAddShot} drop={drop} dnd={dnd} />
            {shot ? (
              <ShotEditor
                key={shot.id}
                shot={shot}
                scene={scene}
                scenes={r.scenes}
                index={index}
                onPrev={pos > 0 ? () => go(-1) : undefined}
                onNext={pos >= 0 && pos < flat.length - 1 ? () => go(1) : undefined}
              />
            ) : (
              <EmptyScene onAdd={onAddShot} />
            )}
          </>
        ) : (
          <EmptyBoard onAdd={() => select(addScene(), null)} />
        )}
      </main>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Left: scene / shot tree                                            */
/* ------------------------------------------------------------------ */

function SceneTree({
  r,
  sceneId,
  shotId,
  running,
  onSelect,
  drop,
  dnd,
}: {
  r: ResolvedBoard
  sceneId?: string
  shotId?: string
  running: Record<string, unknown>
  onSelect: (scene: string, shot: string | null) => void
  drop: Drop
  dnd: Dnd
}) {
  // long flows (100+ shots) open with only the current scene expanded
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    r.scenes.reduce((a, s) => a + s.shots.length, 0) > 40 ? new Set(r.scenes.filter((s) => s.id !== sceneId).map((s) => s.id)) : new Set(),
  )
  // the scene of the selected shot always opens (selected from the strip, the canvas or ← →)
  const [openedFor, setOpenedFor] = useState(sceneId)
  if (sceneId !== openedFor) {
    setOpenedFor(sceneId)
    if (sceneId && collapsed.has(sceneId)) setCollapsed((c) => new Set([...c].filter((x) => x !== sceneId)))
  }
  const hidden = r.board.hidden?.length ?? 0
  const total = r.scenes.reduce((a, s) => a + s.shots.length, 0)
  const dur = r.scenes.reduce((a, s) => a + s.shots.reduce((b, sh) => b + shotDuration(sh), 0), 0)
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  return (
    <aside className="w-[264px] shrink-0 rounded-2xl bg-background shadow-natural-xs flex flex-col min-h-0">
      <div className="h-11 pl-3.5 pr-1.5 flex items-center gap-1 border-b border-border shrink-0">
        <p className="text-sm font-semibold">Scenes & shots</p>
        <div className="ml-auto flex items-center">
          <Tip label="Add scene">
            <Button size="icon-sm" onClick={() => onSelect(addScene(), null)}>
              <Plus className="w-4 h-4" strokeWidth={1.5} />
            </Button>
          </Tip>
          <Menu>
            <MenuTrigger asChild>
              <Button size="icon-sm" aria-label="Board options">
                <Ellipsis className="w-4 h-4" strokeWidth={1.5} />
              </Button>
            </MenuTrigger>
            <MenuContent align="end" className="min-w-[240px]">
              <MenuItem onSelect={() => onSelect(addScene(), null)}>Add scene</MenuItem>
              <MenuItem disabled={!hidden} onSelect={restoreHidden}>
                Restore removed shots{hidden ? ` (${hidden})` : ''}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                disabled={r.auto}
                onSelect={() => confirm('Regroup every shot from node labels? Scene names, order and notes are discarded.') && resetBoard()}
              >
                Regroup from labels
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-1.5">
        {r.scenes.map((sc) => {
          const closed = collapsed.has(sc.id)
          const endDrop = !!drop && drop.scene === sc.id && drop.index === sc.shots.length
          return (
            <div key={sc.id} className="mb-1">
              <div
                role="button"
                tabIndex={0}
                onClick={() => onSelect(sc.id, sc.shots[0]?.id ?? null)}
                onKeyDown={(e) => e.key === 'Enter' && onSelect(sc.id, sc.shots[0]?.id ?? null)}
                onDragOver={dnd.overEnd(sc.id, sc.shots.length)}
                onDrop={dnd.drop}
                className={cn(
                  'group flex items-center gap-1 h-8 pl-0.5 pr-2 rounded-lg cursor-pointer select-none focus-ring',
                  sc.id === sceneId ? 'bg-gray-alpha-100' : 'hover:bg-gray-alpha-50',
                  endDrop && closed && 'ring-1 ring-foreground',
                )}
              >
                <button
                  type="button"
                  aria-label={closed ? 'Expand' : 'Collapse'}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(sc.id)
                  }}
                  className="w-6 h-6 flex items-center justify-center rounded text-subtle hover:text-foreground"
                >
                  {closed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                <span className="text-sm font-medium truncate">{sc.name}</span>
                <span className="ml-auto text-[11px] text-subtle tabular-nums">{sc.shots.length}</span>
              </div>
              {!closed && (
                <div className="mt-0.5" onDragOver={dnd.overEnd(sc.id, sc.shots.length)} onDrop={dnd.drop}>
                  {sc.shots.map((sh, i) => (
                    <TreeShotRow
                      key={sh.id}
                      sceneId={sc.id}
                      id={sh.id}
                      index={i}
                      code={shotCode(sh)}
                      title={shotTitle(sh) || String(sh.head.data.label ?? '')}
                      thumb={shotThumb(sh, 256)}
                      still={nodeStatus(sh.still, running)}
                      video={nodeStatus(sh.video, running)}
                      selected={sh.id === shotId}
                      dropBefore={!!drop && drop.scene === sc.id && drop.index === i}
                      onSelect={onSelect}
                      dnd={dnd}
                    />
                  ))}
                  {endDrop && <div className="mx-2 h-0.5 rounded bg-foreground" />}
                  {!sc.shots.length && <p className="pl-8 py-1.5 text-[11px] text-subtle">Empty – drop shots here</p>}
                </div>
              )}
            </div>
          )
        })}
        {!r.scenes.length && <p className="px-2 py-6 text-xs text-subtle text-center">No scenes yet</p>}
      </div>
      <div className="px-3.5 py-2.5 border-t border-border text-[11px] text-subtle shrink-0">
        {r.scenes.length} scenes · {total} shots{dur ? ` · ${fmtDuration(dur)}` : ''}
        {r.auto && total > 0 && <p>Grouped from node labels (A01…, V12 (a03)…)</p>}
      </div>
    </aside>
  )
}

const TreeShotRow = memo(function TreeShotRow({
  sceneId,
  id,
  index,
  code,
  title,
  thumb,
  still,
  video,
  selected,
  dropBefore,
  onSelect,
  dnd,
}: {
  sceneId: string
  id: string
  index: number
  code: string
  title: string
  thumb?: string
  still: Status | null
  video: Status | null
  selected: boolean
  dropBefore: boolean
  onSelect: (scene: string, shot: string | null) => void
  dnd: Dnd
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <div ref={ref} className="relative">
      {dropBefore && <div className="absolute -top-px left-2 right-2 h-0.5 rounded bg-foreground" />}
      <button
        type="button"
        draggable
        onDragStart={dnd.start(id)}
        onDragEnd={dnd.end}
        onDragOver={dnd.over(sceneId, index, 'y')}
        onDrop={dnd.drop}
        onClick={() => onSelect(sceneId, id)}
        title={`${code} ${title}`.trim()}
        className={cn('flex w-full items-center gap-2 h-9 pl-2 pr-2 rounded-lg text-left', selected ? 'bg-foreground text-background' : 'hover:bg-gray-alpha-50')}
      >
        <span className={cn('w-5 text-[11px] tabular-nums text-right shrink-0', selected ? 'text-background/70' : 'text-subtle')}>{pad(index + 1)}</span>
        {thumb ? (
          <img src={thumb} className="w-11 h-[25px] rounded object-cover shrink-0 bg-gray-100" draggable={false} decoding="async" loading="lazy" />
        ) : (
          <span className={cn('w-11 h-[25px] rounded shrink-0', selected ? 'bg-background/15' : 'bg-gray-alpha-100')} />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
        <span className="flex gap-0.5 shrink-0">
          <Dot status={still} inverted={selected} />
          <Dot status={video} inverted={selected} />
        </span>
      </button>
    </div>
  )
})

function Dot({ status, inverted }: { status: Status | null; inverted?: boolean }) {
  if (!status) return <span className="w-1.5 h-1.5" />
  if (status === 'running') return <LoaderCircle className="w-2.5 h-2.5 animate-spin" />
  return (
    <span
      className={cn(
        'w-1.5 h-1.5 rounded-full',
        status === 'done' && 'bg-emerald-500',
        status === 'error' && 'bg-red-500',
        status === 'none' && (inverted ? 'ring-1 ring-background/60' : 'ring-1 ring-gray-alpha-400'),
      )}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Scene header                                                       */
/* ------------------------------------------------------------------ */

function SceneHeader({
  scene,
  scenes,
  running,
  onAddShot,
  onSelect,
}: {
  scene: ResolvedScene
  scenes: ResolvedScene[]
  running: Record<string, unknown>
  onAddShot: () => void
  onSelect: (scene: string, shot: string | null) => void
}) {
  const n = scene.shots.length
  const stills = scene.shots.filter((s) => nodeStatus(s.still, running) === 'done').length
  const videos = scene.shots.filter((s) => nodeStatus(s.video, running) === 'done').length
  const busy = scene.shots.some((s) => nodeStatus(s.still, running) === 'running' || nodeStatus(s.video, running) === 'running')
  const dur = scene.shots.reduce((a, s) => a + shotDuration(s), 0)
  const canvasSel = useFlow((s) => s.nodes.reduce((a, x) => a + (x.selected && x.type !== 'comment' ? 1 : 0), 0))
  const idx = scenes.indexOf(scene)
  const st = useFlow.getState
  const runnable = (list: (ResolvedShot['still'] | null)[]) => list.filter((x) => x && (x.type === 'content-generation' || x.type === 'process')).map((x) => x!.id)
  return (
    <div className="flex items-center gap-3 h-10 shrink-0 min-w-0">
      <InlineEdit value={scene.name} onCommit={(v) => renameScene(scene.id, v)} className="text-base font-semibold" />
      <span className="text-xs text-secondary tabular-nums whitespace-nowrap truncate">
        {n} shots · stills {stills}/{n} · videos {videos}/{n}
        {dur ? ` · ${fmtDuration(dur)}` : ''}
      </span>
      {busy && <LoaderCircle className="w-4 h-4 animate-spin text-subtle shrink-0" />}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        <Menu>
          <MenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={!n}>
              <Play className="w-3.5 h-3.5" strokeWidth={1.5} />
              Run scene
              <ChevronDown className="w-3.5 h-3.5 text-secondary" strokeWidth={1.5} />
            </Button>
          </MenuTrigger>
          <MenuContent align="end" className="min-w-[250px]">
            <MenuItem onSelect={() => void st().runNodes(runnable(scene.shots.map((s) => s.still)))}>Missing stills</MenuItem>
            <MenuItem onSelect={() => void st().runNodes(runnable(scene.shots.map((s) => s.video)))}>Missing videos (+ their stills)</MenuItem>
          </MenuContent>
        </Menu>
        <Button variant="primary" size="sm" className="gap-1" onClick={onAddShot}>
          <Plus className="w-4 h-4" strokeWidth={1.5} />
          Shot
        </Button>
        <Menu>
          <MenuTrigger asChild>
            <Button size="icon-sm" aria-label="Scene actions">
              <Ellipsis className="w-4 h-4" strokeWidth={1.5} />
            </Button>
          </MenuTrigger>
          <MenuContent align="end" className="min-w-[240px]">
            <MenuItem
              disabled={!canvasSel}
              onSelect={() =>
                addNodesAsShots(
                  scene.id,
                  st()
                    .nodes.filter((x) => x.selected && x.type !== 'comment')
                    .map((x) => x.id),
                )
              }
            >
              Add canvas selection as shots{canvasSel ? ` (${canvasSel})` : ''}
            </MenuItem>
            <MenuSeparator />
            <MenuItem disabled={idx <= 0} onSelect={() => moveScene(scene.id, -1)}>
              Move scene up
            </MenuItem>
            <MenuItem disabled={idx >= scenes.length - 1} onSelect={() => moveScene(scene.id, 1)}>
              Move scene down
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              onSelect={() => {
                if (n && !confirm(`Remove "${scene.name}" from the board? Its ${n} shots are hidden; the nodes stay on the canvas.`)) return
                const next = scenes[idx + 1] ?? scenes[idx - 1]
                deleteScene(scene.id)
                if (next) onSelect(next.id, next.shots[0]?.id ?? null)
              }}
            >
              Delete scene
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  )
}

function InlineEdit({ value, onCommit, className }: { value: string; onCommit: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const commit = () => {
    const v = draft.trim()
    if (v && v !== value) onCommit(v)
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
        className={cn('h-8 px-1.5 -mx-1.5 rounded-lg outline-none ring-1 ring-gray-alpha-300 bg-background min-w-[160px]', className)}
      />
    )
  return (
    <button
      type="button"
      title="Rename scene"
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      className={cn('h-8 px-1.5 -mx-1.5 rounded-lg truncate max-w-[40%] shrink-0 hover:bg-gray-alpha-100 text-left', className)}
    >
      {value}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Strip of stills                                                    */
/* ------------------------------------------------------------------ */

function ShotStrip({
  scene,
  shotId,
  running,
  onSelect,
  onAdd,
  drop,
  dnd,
}: {
  scene: ResolvedScene
  shotId?: string
  running: Record<string, unknown>
  onSelect: (scene: string, shot: string | null) => void
  onAdd: () => void
  drop: Drop
  dnd: Dnd
}) {
  // one card size per scene (its most common aspect) so the strip reads like a storyboard
  const ratios = scene.shots.map(shotAspect)
  const ratio = ratios.sort((a, b) => ratios.filter((x) => x === b).length - ratios.filter((x) => x === a).length)[0] ?? 16 / 9
  const w = ratio >= 1 ? 196 : Math.max(124, Math.round(180 * ratio))
  const mediaH = ratio >= 1 ? Math.round(196 / ratio) : 180
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (shotId) scroller.current?.querySelector(`[data-shot="${shotId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [shotId])
  return (
    <div ref={scroller} className="flex gap-3 overflow-x-auto scrollbar-thin pt-1 pb-2 px-1 -mx-1 shrink-0" onDragOver={dnd.overEnd(scene.id, scene.shots.length)} onDrop={dnd.drop}>
      {scene.shots.map((sh, i) => (
        <ShotCard
          key={sh.id}
          sceneId={scene.id}
          id={sh.id}
          index={i}
          code={shotCode(sh)}
          title={shotTitle(sh) || String(sh.head.data.label ?? '')}
          note={sh.note || promptExcerpt(docToPlain(sh.video?.data?.parameters?.prompt)) || promptExcerpt(docToPlain(sh.still?.data?.parameters?.prompt))}
          thumb={shotThumb(sh)}
          still={nodeStatus(sh.still, running)}
          video={nodeStatus(sh.video, running)}
          duration={shotDuration(sh)}
          shared={sh.sharedWith.length > 0}
          selected={sh.id === shotId}
          w={w}
          mediaH={mediaH}
          dropBefore={!!drop && drop.scene === scene.id && drop.index === i}
          onSelect={onSelect}
          dnd={dnd}
        />
      ))}
      <div className="relative shrink-0" style={{ width: Math.min(w, 160) }}>
        {!!drop && drop.scene === scene.id && drop.index === scene.shots.length && <span className="absolute -left-[8px] top-1 bottom-1 w-0.5 rounded bg-foreground" />}
        <button
          type="button"
          onClick={onAdd}
          className="w-full rounded-xl border border-dashed border-gray-alpha-300 text-secondary hover:bg-background hover:text-foreground flex flex-col items-center justify-center gap-1.5 text-xs font-medium"
          style={{ height: mediaH + 58 }}
        >
          <Plus className="w-5 h-5" strokeWidth={1.5} />
          Add shot
        </button>
      </div>
    </div>
  )
}

const ShotCard = memo(function ShotCard({
  sceneId,
  id,
  index,
  code,
  title,
  note,
  thumb,
  still,
  video,
  duration,
  shared,
  selected,
  w,
  mediaH,
  dropBefore,
  onSelect,
  dnd,
}: {
  sceneId: string
  id: string
  index: number
  code: string
  title: string
  note: string
  thumb?: string
  still: Status | null
  video: Status | null
  duration: number
  shared: boolean
  selected: boolean
  w: number
  mediaH: number
  dropBefore: boolean
  onSelect: (scene: string, shot: string | null) => void
  dnd: Dnd
}) {
  const busy = still === 'running' || video === 'running'
  return (
    <div data-shot={id} className="relative shrink-0" style={{ width: w }}>
      {dropBefore && <span className="absolute -left-[8px] top-1 bottom-1 w-0.5 rounded bg-foreground" />}
      <button
        type="button"
        draggable
        onDragStart={dnd.start(id)}
        onDragEnd={dnd.end}
        onDragOver={dnd.over(sceneId, index, 'x')}
        onDrop={dnd.drop}
        onClick={() => onSelect(sceneId, id)}
        className={cn('block w-full text-left rounded-xl bg-background shadow-natural-xs overflow-hidden transition-shadow duration-100', selected ? 'ring-2 ring-foreground' : 'hover:shadow-natural-sm')}
      >
        <div className="relative bg-gray-alpha-100" style={{ height: mediaH }}>
          {thumb ? (
            <img src={thumb} className="w-full h-full object-cover" draggable={false} decoding="async" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-subtle">
              <ImageIcon className="w-5 h-5" strokeWidth={1.5} />
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
              <LoaderCircle className="w-5 h-5 animate-spin text-white" />
            </div>
          )}
          <span className="absolute top-1.5 left-1.5 h-5 px-1.5 rounded-md bg-black/65 text-white text-[11px] font-semibold leading-5 tabular-nums">S{pad(index + 1)}</span>
          <div className="absolute top-1.5 right-1.5 flex gap-1">
            <Badge kind="still" status={still} />
            <Badge kind="video" status={video} />
          </div>
          {duration > 0 && <span className="absolute bottom-1.5 right-1.5 h-5 px-1.5 rounded-md bg-black/65 text-white text-[11px] font-medium leading-5 tabular-nums">{duration}s</span>}
          {shared && <span className="absolute bottom-1.5 left-1.5 h-5 px-1.5 rounded-md bg-amber-300 text-amber-950 text-[10px] font-semibold leading-5">shared still</span>}
        </div>
        <div className="px-2.5 pt-2 pb-2.5">
          <p className="text-xs font-medium truncate">
            {code && <span className="text-subtle tabular-nums mr-1">{code}</span>}
            {title}
          </p>
          <p className="mt-0.5 text-[11px] leading-[15px] text-secondary line-clamp-2 h-[30px]">{note}</p>
        </div>
      </button>
    </div>
  )
})

function Badge({ kind, status }: { kind: 'still' | 'video'; status: Status | null }) {
  if (!status || status === 'running') return null
  const Icon = kind === 'video' ? Video : ImageIcon
  return (
    <span
      title={`${kind}: ${status === 'none' ? 'not generated' : status}`}
      className={cn(
        'w-5 h-5 rounded-md flex items-center justify-center',
        status === 'done' && 'bg-emerald-500 text-white',
        status === 'error' && 'bg-red-500 text-white',
        status === 'none' && 'bg-black/45 text-white/70',
      )}
    >
      <Icon className="w-3 h-3" strokeWidth={2} />
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Empty states                                                       */
/* ------------------------------------------------------------------ */

function EmptyScene({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="flex-1 min-h-0 rounded-2xl bg-background shadow-natural-xs flex flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm font-medium">This scene has no shots</p>
      <p className="text-xs text-secondary max-w-[420px]">
        Add a shot (creates a still node), drag shots here from the list, or select nodes on the canvas and use ⋯ → Add canvas selection.
      </p>
      <Button variant="primary" size="sm" className="gap-1" onClick={onAdd}>
        <Plus className="w-4 h-4" strokeWidth={1.5} />
        Add shot
      </Button>
    </section>
  )
}

function EmptyBoard({ onAdd }: { onAdd: () => void }) {
  const flowId = useFlow((s) => s.flowId)
  return (
    <section className="flex-1 rounded-2xl bg-background shadow-natural-xs flex flex-col items-center justify-center gap-3 p-8 text-center">
      <Clapperboard className="w-6 h-6 text-subtle" strokeWidth={1.5} />
      <p className="text-sm font-medium">No shots in this flow yet</p>
      <p className="text-xs text-secondary max-w-[460px]">
        Video generation nodes become shots automatically; stills count when their label starts with a shot code (A01, B12…) and nothing uses them yet. The letter is the scene.
      </p>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" className="gap-1" onClick={onAdd}>
          <Plus className="w-4 h-4" strokeWidth={1.5} />
          Add scene
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate(`/flows/${flowId}`)}>
          Back to canvas
        </Button>
      </div>
      <p className="text-[11px] text-subtle">
        ⇧S switches canvas ⇄ scenes · ← → previous / next shot · {MOD}↵ runs the open shot
      </p>
    </section>
  )
}
