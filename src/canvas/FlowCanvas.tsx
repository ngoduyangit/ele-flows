import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type FinalConnectionState,
  type NodeTypes,
  type NodeProps,
  type EdgeTypes,
  type Viewport,
} from '@xyflow/react'
import { memo, useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { AddNodeMenu } from '../components/AddNodeMenu'
import { MOD, MenuItem, MenuLabel, MenuSeparator, menuContentCls, cn } from '../components/ui'
import { CATALOG, SUGGESTION_LABEL, getInputPort, getOutputType, newNodeId, suggestionsFor } from '../lib/registry'
import type { FlowNode } from '../lib/types'
import { outputUrl } from '../shared/runRequest'
import { CommentNode, ContentGenerationNode, MediaNode, ProcessNode, TextNode } from '../nodes/nodes'
import { NodeMenuItems } from '../nodes/parts'
import { useFlow } from '../store/flowStore'
import { addFileNode, pickCatalogItem } from './actions'
import { ConnectionLine, DataFlowEdge } from './edges'

/**
 * Node components only depend on id/type/data/selected/size. React Flow also passes the absolute
 * position, which changes on every drag frame – skip re-rendering the node body for that.
 */
const sameNodeProps = (a: NodeProps, b: NodeProps) =>
  a.id === b.id && a.type === b.type && a.data === b.data && a.selected === b.selected && a.width === b.width && a.height === b.height && a.dragging === b.dragging
const fast = (C: ComponentType<any>) => memo(C, sameNodeProps as (a: any, b: any) => boolean)

const nodeTypes: NodeTypes = {
  text: fast(TextNode),
  'content-generation': fast(ContentGenerationNode),
  image: fast(MediaNode),
  video: fast(MediaNode),
    process: fast(ProcessNode),
  comment: fast(CommentNode),
}
const edgeTypes: EdgeTypes = { dataflow: DataFlowEdge }
// Stable references: React Flow passes these down to every node/edge wrapper, so a new
// identity on each render would re-render the whole graph on every drag frame.
const DEFAULT_EDGE_OPTIONS = { type: 'dataflow' }
const MIDDLE_BUTTON = [1]
const DELETE_KEYS = ['Backspace', 'Delete']
const MULTI_KEYS = ['Shift', 'Meta', 'Control']
const PRO_OPTIONS = { hideAttribution: true }
const snapshot = () => useFlow.getState().snapshot()

type Floating =
  | { kind: 'pane'; x: number; y: number; flow: { x: number; y: number } }
  | { kind: 'node'; x: number; y: number; nodeId: string }
  | { kind: 'catalog'; x: number; y: number; flow: { x: number; y: number } }
  | null

export function FlowCanvas() {
  const nodes = useFlow((s) => s.nodes)
  const edges = useFlow((s) => s.edges)
  const tool = useFlow((s) => s.tool)
  const pending = useFlow((s) => s.pendingConnection)
  const { onNodesChange, onEdgesChange, onConnect, isValidConnection, setPendingConnection, setViewportInfo } = useFlow.getState()
  const rf = useReactFlow()
  const wrapper = useRef<HTMLDivElement>(null)
  const [floating, setFloating] = useState<Floating>(null)

  const syncViewport = useCallback(
    (vp: Viewport) => {
      const el = wrapper.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setViewportInfo({ x: (r.width / 2 - vp.x) / vp.zoom, y: (r.height / 2 - vp.y) / vp.zoom }, vp.zoom)
    },
    [setViewportInfo],
  )

  // connection dropped on empty canvas → contextual add-node menu
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode || !state.fromHandle) return
      const target = event.target as HTMLElement
      if (!target.closest('.react-flow__pane')) return
      const p = 'changedTouches' in event ? event.changedTouches[0] : event
      const flow = rf.screenToFlowPosition({ x: p.clientX, y: p.clientY })
      setPendingConnection({
        nodeId: state.fromNode.id,
        handleId: state.fromHandle.id ?? null,
        handleType: state.fromHandle.type,
        flowPosition: flow,
        screen: { x: p.clientX, y: p.clientY },
      })
    },
    [rf, setPendingConnection],
  )

  const onMoveEnd = useCallback((_: unknown, vp: Viewport) => syncViewport(vp), [syncViewport])
  const onInit = useCallback(
    (inst: { fitView: (o?: any) => void; getViewport: () => Viewport }) => {
      inst.fitView({ padding: 0.1 })
      setTimeout(() => syncViewport(inst.getViewport()), 50)
    },
    [syncViewport],
  )
  const onPaneClick = useCallback(
    (e: React.MouseEvent) => {
      setFloating(null)
      if (useFlow.getState().tool === 'comment') {
        const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
        useFlow.getState().addRawNode({ id: newNodeId(), type: 'comment', position: pos, data: { label: 'Comment', text: '', author: 'You', createdAt: Date.now() } })
        useFlow.getState().setTool('select')
      }
    },
    [rf],
  )
  const onPaneContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      e.preventDefault()
      setFloating({ kind: 'pane', x: e.clientX, y: e.clientY, flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) })
    },
    [rf],
  )
  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: FlowNode) => {
    e.preventDefault()
    if (!node.selected) useFlow.getState().selectOnly([node.id])
    setFloating({ kind: 'node', x: e.clientX, y: e.clientY, nodeId: node.id })
  }, [])

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t instanceof Element && t.closest('input, textarea, [contenteditable="true"]')) return
      const st = useFlow.getState()
      const mod = e.metaKey || e.ctrlKey
      const selected = st.nodes.filter((n) => n.selected).map((n) => n.id)
      const k = e.key.toLowerCase()
      if (mod && k === 'z') {
        e.preventDefault()
        e.shiftKey ? st.redo() : st.undo()
      } else if (mod && k === 'y') {
        e.preventDefault()
        st.redo()
      } else if (mod && k === 'c' && selected.length) {
        st.copy(selected)
      } else if (mod && k === 'v') {
        st.paste()
      } else if (mod && k === 'd') {
        e.preventDefault()
        if (selected.length) st.duplicate(selected)
      } else if (mod && k === 'a') {
        e.preventDefault()
        st.selectOnly(st.nodes.map((n) => n.id))
      } else if (mod && k === ',') {
        e.preventDefault()
        st.setSettingsOpen(true)
      } else if (mod && k === 'k') {
        e.preventDefault()
        st.setQuickActionsOpen(true)
      } else if (mod && k === '.') {
        e.preventDefault()
        if (selected.length) rf.fitView({ nodes: selected.map((id) => ({ id })), duration: 300, maxZoom: 1, padding: 0.4 })
      } else if (mod && (k === '=' || k === '+')) {
        e.preventDefault()
        rf.zoomIn({ duration: 150 })
      } else if (mod && k === '-') {
        e.preventDefault()
        rf.zoomOut({ duration: 150 })
      } else if (mod && k === '0') {
        e.preventDefault()
        rf.zoomTo(1, { duration: 150 })
      } else if (mod && e.shiftKey && k === 'enter') {
        st.runAll(true)
      } else if (mod && k === 'enter') {
        selected.forEach((id) => st.runNode(id))
      } else if (e.shiftKey && !mod && e.code === 'KeyT') {
        window.dispatchEvent(new Event('flows:tidy'))
      } else if (e.shiftKey && e.code === 'Digit1') {
        rf.fitView({ duration: 300, padding: 0.1 })
      } else if (!mod && !e.altKey) {
        if (k === 'v') st.setTool('select')
        else if (k === 'h') st.setTool('hand')
        else if (k === 'c') st.setTool('comment')
        else if (k === 'n') st.setAddMenuOpen(true)
        else if (k === 'escape') {
          st.selectOnly([])
          setFloating(null)
        } else if (k === 'f2' && selected.length === 1) st.setRenaming(selected[0])
      }
    }
    const onTidy = () => {
      useFlow.getState().tidyUp()
      setTimeout(() => rf.fitView({ duration: 300, padding: 0.1 }), 30)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('flows:tidy', onTidy)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('flows:tidy', onTidy)
    }
  }, [rf])

  const onDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files ?? [])
    if (!files.length) return
    e.preventDefault()
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    files.forEach((f, i) => addFileNode(f, { x: pos.x + i * 40 - 150, y: pos.y + i * 40 - 85 }))
  }

  return (
    <div ref={wrapper} className="h-full flex-1 relative" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <ReactFlow<FlowNode>
        className="flows-canvas light"
        data-tool={tool}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        connectionLineComponent={ConnectionLine}
        connectionRadius={36}
        onNodeDragStart={snapshot}
        onSelectionDragStart={snapshot}
        onMoveEnd={onMoveEnd}
        onInit={onInit}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        minZoom={0.05}
        maxZoom={2}
        zoomOnDoubleClick={false}
        panOnScroll
        panOnScrollSpeed={1}
        zoomOnPinch
        panOnDrag={tool === 'hand' ? true : MIDDLE_BUTTON}
        selectionOnDrag={tool === 'select'}
        selectionMode={SelectionMode.Partial}
        nodesDraggable={tool !== 'hand'}
        elementsSelectable={tool !== 'hand'}
        nodeDragThreshold={2}
        deleteKeyCode={DELETE_KEYS}
        multiSelectionKeyCode={MULTI_KEYS}
        proOptions={PRO_OPTIONS}
      >
        <Background variant={BackgroundVariant.Dots} gap={50} size={2} color="hsl(0 0% 64%)" />
      </ReactFlow>

      {pending && <ConnectionDropMenu />}
      {floating && <FloatingMenu key={floating.kind + floating.x + floating.y} floating={floating} onClose={() => setFloating(null)} onCatalog={(f) => setTimeout(() => setFloating({ kind: 'catalog', ...f }), 0)} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Menu shown when a connection is dropped on empty canvas            */
/* ------------------------------------------------------------------ */

function ConnectionDropMenu() {
  const pending = useFlow((s) => s.pendingConnection)!
  const node = useFlow((s) => s.nodes.find((n) => n.id === pending.nodeId))
  const type = pending.handleType === 'source' ? getOutputType(node) : getInputPort(node, pending.handleId)?.type
  if (!type) return null
  const items = suggestionsFor(type, pending.handleType === 'source')
  const close = () => useFlow.getState().setPendingConnection(null)
  const place = (offsetY = 120) =>
    pending.handleType === 'source' ? { x: pending.flowPosition.x, y: pending.flowPosition.y - offsetY } : { x: pending.flowPosition.x - 420, y: pending.flowPosition.y - offsetY }
  return (
    <DropdownMenu.Root open onOpenChange={(o) => !o && close()} modal={false}>
      <DropdownMenu.Trigger asChild>
        <span className="fixed w-px h-px" style={{ left: pending.screen.x, top: pending.screen.y }} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="right" align="start" sideOffset={6} className={cn(menuContentCls, 'min-w-[160px]')}>
          <MenuLabel>Add node</MenuLabel>
          {items.map((item) => (
            <MenuItem
              key={item.key}
              onSelect={() => {
                const id = pickCatalogItem(item, { position: place(), connect: pending })
                // extracting a frame is instant (local ffmpeg) – run it right away when the video already has an output
                if (id && item.key === 'last-frame' && outputUrl(node as any)) setTimeout(() => useFlow.getState().runNode(id), 50)
              }}
            >
              {SUGGESTION_LABEL[item.key] ?? item.label}
            </MenuItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/* ------------------------------------------------------------------ */
/* Right-click menus                                                  */
/* ------------------------------------------------------------------ */

function FloatingMenu({ floating, onClose, onCatalog }: { floating: NonNullable<Floating>; onClose: () => void; onCatalog: (f: { x: number; y: number; flow: { x: number; y: number } }) => void }) {
  const rf = useReactFlow()
  const st = useFlow.getState
  const hasClipboard = useFlow((s) => !!s.clipboard)
  const node = useFlow((s) => (floating.kind === 'node' ? s.nodes.find((n) => n.id === floating.nodeId) : undefined))
  const catalogAt = floating.kind === 'catalog' ? floating : null

  if (catalogAt)
    return (
      <div className="fixed inset-0 z-[80]" onPointerDown={onClose}>
        <div
          className="absolute rounded-2xl bg-popover shadow-popover animate-pop overflow-hidden"
          style={{ left: Math.min(catalogAt.x, window.innerWidth - 340), top: Math.min(catalogAt.y, window.innerHeight - 480) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <AddNodeMenu
            onPick={(item, modelId) => {
              pickCatalogItem(item, { modelId, position: catalogAt.flow })
              onClose()
            }}
          />
        </div>
      </div>
    )

  const add = (key: string) => {
    if (floating.kind !== 'pane') return
    pickCatalogItem(CATALOG.find((c) => c.key === key)!, { position: floating.flow })
  }

  return (
    <DropdownMenu.Root open onOpenChange={(o) => !o && onClose()} modal={false}>
      <DropdownMenu.Trigger asChild>
        <span className="fixed w-px h-px" style={{ left: floating.x, top: floating.y }} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="start" sideOffset={2} className={cn(menuContentCls, 'min-w-[180px]')} onCloseAutoFocus={(e) => e.preventDefault()}>
          {floating.kind === 'pane' && (
            <>
              <MenuLabel>Add nodes</MenuLabel>
              <MenuItem onSelect={() => add('image-generation')}>Image generation</MenuItem>
              <MenuItem onSelect={() => add('video-generation')}>Video generation</MenuItem>
              <MenuItem onSelect={() => add('text')}>Text</MenuItem>
              <MenuItem
                shortcut="N"
                onSelect={() => onCatalog({ x: floating.x, y: floating.y, flow: floating.flow })}
              >
                View all nodes
              </MenuItem>
              <MenuSeparator />
              <MenuItem shortcut={`${MOD}V`} disabled={!hasClipboard} onSelect={() => st().paste(floating.flow)}>
                Paste
              </MenuItem>
              <MenuItem
                shortcut="C"
                onSelect={() =>
                  st().addRawNode({ id: newNodeId(), type: 'comment', position: floating.flow, data: { label: 'Comment', text: '', author: 'You', createdAt: Date.now() } })
                }
              >
                Comment
              </MenuItem>
              <MenuSeparator />
              <MenuItem shortcut="⇧T" onSelect={() => window.dispatchEvent(new Event('flows:tidy'))}>
                Tidy up
              </MenuItem>
              <MenuItem shortcut={`${MOD}K`} onSelect={() => st().setQuickActionsOpen(true)}>
                Quick actions
              </MenuItem>
            </>
          )}
          {floating.kind === 'node' && node && (
            <NodeMenuItems
              node={node}
              hasGen={!!node.data.generations?.length}
              hasClipboard={hasClipboard}
              st={st}
              onFocus={() => rf.fitView({ nodes: [{ id: node.id }], duration: 300, maxZoom: 1, padding: 0.4 })}
            />
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
