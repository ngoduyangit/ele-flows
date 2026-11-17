import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Handle, Position, useReactFlow } from '@xyflow/react'
import { ChevronDown, Ellipsis, LoaderCircle, Square, Trash2, Download } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { MOD, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tip, cn } from '../components/ui'
import { PORT_ICON, newNodeId, nodeIcon, type PortDef } from '../lib/registry'
import type { BaseNodeData, FlowNode, PortType } from '../lib/types'
import { activeGeneration, useFlow } from '../store/flowStore'

/* ------------------------------------------------------------------ */
/* Handles                                                            */
/* ------------------------------------------------------------------ */

export function InputHandle({ nodeId, port, style }: { nodeId: string; port: PortDef; style?: CSSProperties }) {
  const connected = useFlow((s) => s.edges.some((e) => e.target === nodeId && e.targetHandle === port.id))
  const Icon = PORT_ICON[port.type]
  return (
    <Tip label={port.label} side="left">
      <Handle
        type="target"
        id={port.id}
        position={Position.Left}
        className={cn('node-handle', `port-${port.type}`)}
        data-optional={port.optional ? 'true' : undefined}
        data-connected={connected ? 'true' : undefined}
        style={{ top: 2, left: -6, transform: 'translateX(-100%)', ...style }}
      >
        <Icon className="pointer-events-none" strokeWidth={1.5} />
      </Handle>
    </Tip>
  )
}

export function OutputHandle({ type, style }: { type: PortType; style?: CSSProperties }) {
  const Icon = PORT_ICON[type]
  return (
    <Handle
      type="source"
      id="output"
      position={Position.Right}
      className={cn('node-handle', `port-${type}`)}
      style={{ top: 14, right: -6, left: 'auto', transform: 'translateX(100%)', ...style }}
    >
      <Icon className="pointer-events-none" strokeWidth={1.5} />
    </Handle>
  )
}

/** Column of input handles rendered at the bottom-left of a media area. */
export function MediaHandles({ nodeId, ports }: { nodeId: string; ports: PortDef[] }) {
  if (!ports.length) return null
  return (
    <div className="absolute z-10 bottom-0 left-0 py-3.5 flex flex-col items-start gap-2 pointer-events-none">
      {ports.map((p) => (
        <div key={p.id} className="relative px-3.5">
          <InputHandle nodeId={nodeId} port={p} />
          <div className="w-9 h-9 pointer-events-none invisible" />
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Node frame                                                         */
/* ------------------------------------------------------------------ */

export function NodeLabel({ id, data, selected, right }: { id: string; data: BaseNodeData; selected?: boolean; right?: ReactNode }) {
  const type = useFlow((s) => s.nodes.find((n) => n.id === id)?.type)
  const renaming = useFlow((s) => s.renamingNodeId === id)
  const setRenaming = useFlow((s) => s.setRenaming)
  const update = useFlow((s) => s.updateNodeData)
  const [draft, setDraft] = useState(data.label)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renaming) {
      setDraft(data.label)
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [renaming, data.label])
  const Icon = nodeIcon({ type, data } as FlowNode)
  const color = selected ? 'text-foreground' : 'text-secondary'
  const commit = () => {
    const v = draft.trim()
    if (v && v !== data.label) update(id, { label: v })
    setRenaming(null)
  }
  return (
    <div className="flex items-center mb-2 gap-1 min-w-0 h-4">
      <Icon className={cn('shrink-0 w-4 h-4 transition-colors duration-100', color)} strokeWidth={1.5} />
      <span className="relative isolate inline-flex min-w-0 max-w-[60%] shrink">
        {renaming ? (
          <input
            ref={inputRef}
            className="nodrag text-xs font-medium bg-transparent outline-none ring-1 ring-gray-alpha-300 rounded px-0.5 -mx-0.5 min-w-[80px]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setRenaming(null)
            }}
          />
        ) : (
          <span
            className={cn('relative z-1 w-full min-w-0 truncate text-xs font-medium transition-colors duration-100', color)}
            title="Double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation()
              setRenaming(id)
            }}
          >
            {data.label}
          </span>
        )}
      </span>
      {right != null && (
        <p className={cn('text-xs ml-auto shrink-0 pl-3 font-medium transition-colors duration-100 whitespace-nowrap tabular-nums', color)}>{right}</p>
      )}
    </div>
  )
}

export function NodeCard({ selected, children, className, style }: { selected?: boolean; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={cn(
        'relative bg-background rounded-2xl shadow-natural-xs transition duration-100',
        selected ? 'ring-2 ring-foreground' : 'ring-0 ring-transparent',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  )
}

export function NodeToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="absolute top-full pt-4 left-1/2 -translate-x-1/2 min-w-full flex justify-center">
      <div className="nodrag p-1 bg-background rounded-[14px] inline-flex items-center shadow-natural-xs overflow-hidden">{children}</div>
    </div>
  )
}

export function NodeFrame({
  id,
  data,
  selected,
  width,
  minWidth = 300,
  right,
  children,
  toolbar,
}: {
  id: string
  data: BaseNodeData
  selected?: boolean
  width?: number
  minWidth?: number
  right?: ReactNode
  children: ReactNode
  toolbar?: ReactNode
}) {
  return (
    <div className="relative" style={{ width, minWidth }}>
      <NodeLabel id={id} data={data} selected={selected} right={right} />
      {children}
      {toolbar && <NodeToolbar>{toolbar}</NodeToolbar>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Run button (split)                                                 */
/* ------------------------------------------------------------------ */

export function RunButton({ id, disabled, label = 'Run' }: { id: string; disabled?: boolean; label?: string }) {
  // a server-side run survives a page reload – show Stop for it too
  const running = useFlow((s) => {
    if (s.running[id]) return true
    const d: any = s.nodes.find((n) => n.id === id)?.data
    return d?.generations?.find((g: any) => g.id === d.activeGenerationId)?.status === 'running'
  })
  const { runNode, runFrom, runUpTo, cancelRun } = useFlow.getState()
  if (running)
    return (
      <button
        type="button"
        onClick={() => cancelRun(id)}
        className="nodrag inline-flex items-center gap-1.5 h-7 px-2 rounded-lg text-xm font-medium bg-foreground text-background hover:bg-gray-800"
      >
        <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
        <span>Stop</span>
        <Square className="w-3 h-3 fill-current" />
      </button>
    )
  return (
    <div
      data-disabled={disabled || undefined}
      className="nodrag group relative inline-flex w-fit bg-foreground text-background border border-foreground data-[disabled=true]:bg-gray-400 data-[disabled=true]:border-gray-400 h-7 rounded-lg text-xm overflow-hidden"
    >
      <button type="button" disabled={disabled} onClick={() => runNode(id)} className="px-2 font-medium hover:bg-gray-800 active:bg-gray-700 disabled:hover:bg-transparent">
        {label}
      </button>
      <div className="w-px h-1/2 self-center bg-gray-600" />
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className="px-1 hover:bg-gray-800 data-[state=open]:bg-gray-700 flex items-center">
            <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={() => runNode(id)} shortcut={`${MOD}↵`}>
            Run this node
          </MenuItem>
          <MenuItem onSelect={() => runFrom(id)}>Run from here</MenuItem>
          <MenuItem onSelect={() => runUpTo(id)}>Run up to here</MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}

export function RunFromHereButton({ id }: { id: string }) {
  const running = useFlow((s) => !!s.running[id])
  return (
    <button
      type="button"
      onClick={() => useFlow.getState().runFrom(id)}
      className="nodrag inline-flex items-center gap-1 h-7 px-2 rounded-lg text-xm font-medium bg-foreground text-background hover:bg-gray-800"
    >
      {running && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
      Run from here
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Toolbar buttons                                                    */
/* ------------------------------------------------------------------ */

export function ToolbarIcon({ label, onClick, children, disabled }: { label: string; onClick?: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Tip label={label}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="nodrag inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-foreground hover:bg-gray-alpha-100 disabled:text-subtle disabled:hover:bg-transparent focus-ring [&_svg]:w-[18px] [&_svg]:h-[18px]"
      >
        {children}
      </button>
    </Tip>
  )
}

export function DownloadButton({ id }: { id: string }) {
  const gen = useFlow((s) => {
    const n = s.nodes.find((n) => n.id === id)
    return n ? activeGeneration(n.data) : undefined
  })
  return (
    <ToolbarIcon
      label="Download"
      disabled={!gen?.url && !gen?.text}
      onClick={() => {
        if (!gen) return
        const a = document.createElement('a')
        if (gen.url) a.href = gen.url
        else a.href = URL.createObjectURL(new Blob([gen.text ?? ''], { type: 'text/plain' }))
        a.download = `generation-${gen.id}`
        a.click()
      }}
    >
      <Download strokeWidth={1.5} />
    </ToolbarIcon>
  )
}

export function DeleteButton({ id }: { id: string }) {
  return (
    <ToolbarIcon label="Delete" onClick={() => useFlow.getState().deleteNodes([id])}>
      <Trash2 strokeWidth={1.5} />
    </ToolbarIcon>
  )
}

export function NodeMoreMenu({ id }: { id: string }) {
  return (
    <Menu>
      <Tip label="More">
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="nodrag inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-foreground hover:bg-gray-alpha-100 data-[state=open]:bg-gray-alpha-200 focus-ring"
          >
            <Ellipsis className="w-[18px] h-[18px]" strokeWidth={1.5} />
          </button>
        </DropdownMenu.Trigger>
      </Tip>
      <MenuContent align="start" side="bottom">
        <NodeMoreMenuBody id={id} />
      </MenuContent>
    </Menu>
  )
}

/** Mounted only while the menu is open, so the trigger doesn't subscribe to the node (which changes every drag frame). */
function NodeMoreMenuBody({ id }: { id: string }) {
  const { fitView } = useReactFlow()
  const node = useFlow((s) => s.nodes.find((n) => n.id === id))
  const hasClipboard = useFlow((s) => !!s.clipboard)
  if (!node) return null
  return (
    <NodeMenuItems
      node={node}
      hasGen={!!node.data.generations?.length}
      hasClipboard={hasClipboard}
      onFocus={() => fitView({ nodes: [{ id }], duration: 300, maxZoom: 1, padding: 0.4 })}
      st={useFlow.getState}
    />
  )
}

export function NodeMenuItems({
  node,
  hasGen,
  hasClipboard,
  onFocus,
  st,
  Item = MenuItem,
  Separator = MenuSeparator,
}: {
  node: FlowNode
  hasGen: boolean
  hasClipboard: boolean
  onFocus: () => void
  st: typeof useFlow.getState
  Item?: typeof MenuItem
  Separator?: () => ReactNode
}) {
  const id = node.id
  const isMedia = ['image', 'video'].includes(node.type!)
  return (
    <>
      {isMedia && <Item disabled>Set as thumbnail</Item>}
      <Item onSelect={() => setTimeout(() => st().setRenaming(id), 50)}>Rename</Item>
      <Item shortcut={`${MOD}C`} onSelect={() => st().copy([id])}>
        Copy
      </Item>
      <Item shortcut={`${MOD}V`} disabled={!hasClipboard} onSelect={() => st().paste()}>
        Paste
      </Item>
      <Item shortcut={`${MOD}D`} onSelect={() => st().duplicate([id])}>
        Duplicate
      </Item>
      <Item shortcut={`${MOD}.`} onSelect={onFocus}>
        Focus node
      </Item>
      <Separator />
      <Item disabled={!hasGen} onSelect={() => st().deleteGeneration(id)}>
        Delete generation
      </Item>
      <Item shortcut="⌫" onSelect={() => st().deleteNodes([id])}>
        Delete node
      </Item>
      <Separator />
      <Item
        onSelect={() =>
          st().updateNodeData(id, (d: BaseNodeData) => ({ ...d, templateOutput: d.templateOutput ? null : { id: id, description: d.label } }))
        }
      >
        {node.data.templateOutput ? 'Unmark template output' : 'Mark template output'}
      </Item>
      <Item
        onSelect={() =>
          st().addRawNode({
            id: newNodeId(),
            type: 'comment',
            position: { x: node.position.x + (node.measured?.width ?? 400) + 24, y: node.position.y },
            data: { label: 'Comment', text: '', author: 'You', createdAt: Date.now() },
          })
        }
      >
        Comment
      </Item>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Empty / loading states                                             */
/* ------------------------------------------------------------------ */

export function GenerationPlaceholder({ icon, text = 'Your generation will appear here', running }: { icon?: ReactNode; text?: string; running?: boolean }) {
  return (
    <div className={cn('w-full h-full stack items-center gap-2 justify-center text-subtle', running && 'animate-shimmer')}>
      {running ? <LoaderCircle className="w-4 h-4 animate-spin" /> : icon ?? <ScanSpark />}
      <p className="text-xs text-subtle font-medium text-center">{running ? 'Generating…' : text}</p>
    </div>
  )
}

/** Small "scan + spark" glyph used in empty media areas. */
export function ScanSpark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5V3.5A1.5 1.5 0 0 1 3.5 2H5M11 2h1.5A1.5 1.5 0 0 1 14 3.5V5M14 11v1.5a1.5 1.5 0 0 1-1.5 1.5H11M5 14H3.5A1.5 1.5 0 0 1 2 12.5V11" />
      <path d="M8.6 4.8 6.6 8.2h2.8l-2 3.2" />
    </svg>
  )
}
