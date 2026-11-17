import { useReactFlow } from '@xyflow/react'
import { ChevronDown, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AddNodeMenu } from '../components/AddNodeMenu'
import { MOD, cn } from '../components/ui'
import { pickCatalogItem } from '../canvas/actions'
import { nodeIcon } from '../lib/registry'
import { useFlow } from '../store/flowStore'

/* ------------------------------------------------------------------ */
/* Structure (left)                                                   */
/* ------------------------------------------------------------------ */

export function StructurePanel() {
  const open = useFlow((s) => s.structureOpen)
  const setOpen = useFlow((s) => s.setStructureOpen)
  const rf = useReactFlow()
  const [collapsed, setCollapsed] = useState(false)
  // Subscribe to the node list only while open, and only to the fields shown (as a string so
  // unrelated changes – e.g. drag positions – don't re-render the panel).
  const listKey = useFlow((s) =>
    open
      ? JSON.stringify(
          s.nodes
            .filter((n) => n.type !== 'comment')
            .slice()
            .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
            .map((n) => [n.id, n.type, n.data.label, !!n.selected, !!(n.data as any).templateInput]),
        )
      : '[]',
  )
  const list = useMemo(
    () =>
      (JSON.parse(listKey) as [string, string, string, boolean, boolean][]).map(([id, type, label, selected, tpl]) => ({
        id,
        type,
        selected,
        data: { label, templateInput: tpl || null },
      })),
    [listKey],
  )
  return (
    <div className="group/structure">
      {!open && (
        <div className="fixed z-30 flex items-center pointer-events-none" style={{ top: 72, bottom: 16, left: 0, width: 32, transform: 'translateX(-1px)' }}>
          <button type="button" aria-label="Show structure" onClick={() => setOpen(true)} className="group/handle pointer-events-auto flex w-full cursor-pointer items-center justify-start" style={{ height: 128 }}>
            <span className="ml-1 h-8 w-1 rounded-full bg-gray-alpha-300 group-hover/handle:h-12 group-hover/handle:bg-gray-alpha-400 transition-all" />
          </button>
        </div>
      )}
      <div
        className="fixed z-30 bg-background overflow-hidden rounded-2xl ring-1 ring-gray-alpha-100 shadow-lg transition-transform duration-200 ease-out"
        style={{ top: 72, bottom: 16, left: 16, width: 256, transform: open ? 'none' : 'translateX(-272px)', pointerEvents: open ? 'auto' : 'none' }}
      >
        <div className="h-full w-full flex flex-col overflow-hidden">
          <div className="flex items-center justify-between h-12 pl-4 pr-2.5 border-b shrink-0">
            <p className="text-sm text-foreground font-medium truncate">Structure</p>
            <button type="button" onClick={() => setOpen(false)} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-gray-alpha-100">
              <X className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-2">
            <button type="button" onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-1.5 h-8 w-full px-1.5 rounded-lg hover:bg-gray-alpha-100 text-sm font-medium">
              <ChevronDown className={cn('w-3.5 h-3.5 text-secondary transition-transform', collapsed && '-rotate-90')} strokeWidth={1.5} />
              Ungrouped
            </button>
            {!collapsed &&
              list.map((n) => {
                const Icon = nodeIcon(n as any)
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      useFlow.getState().selectOnly([n.id])
                      rf.fitView({ nodes: [{ id: n.id }], duration: 300, maxZoom: 1, padding: 0.5 })
                    }}
                    className={cn('flex items-center gap-2 h-8 w-full pl-6 pr-2 rounded-lg text-sm text-left hover:bg-gray-alpha-100', n.selected && 'bg-gray-alpha-150')}
                  >
                    <Icon className="w-4 h-4 text-secondary shrink-0" strokeWidth={1.5} />
                    <span className="truncate">{n.data.label}</span>
                  </button>
                )
              })}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Quick actions (⌘K)                                                 */
/* ------------------------------------------------------------------ */

export function QuickActions() {
  const open = useFlow((s) => s.quickActionsOpen)
  const rf = useReactFlow()
  const [tab, setTab] = useState<'actions' | 'nodes'>('nodes')
  if (!open) return null
  const close = () => useFlow.getState().setQuickActionsOpen(false)
  const st = useFlow.getState()
  const actions: { label: string; shortcut?: string; run: () => void }[] = [
    { label: 'Run selected nodes', shortcut: `${MOD}↵`, run: () => st.nodes.filter((n) => n.selected).forEach((n) => st.runNode(n.id)) },
    { label: 'Run all (missing outputs)', shortcut: `${MOD}⇧↵`, run: () => st.runAll(true) },
    { label: 'Re-run entire flow', run: () => st.runAll(false) },
    { label: 'Tidy up layout', shortcut: '⇧T', run: () => window.dispatchEvent(new Event('flows:tidy')) },
    { label: 'Zoom to fit', shortcut: '⇧1', run: () => rf.fitView({ duration: 300, padding: 0.1 }) },
    { label: 'Undo', shortcut: `${MOD}Z`, run: st.undo },
    { label: 'Redo', shortcut: `${MOD}⇧Z`, run: st.redo },
    { label: st.structureOpen ? 'Hide structure' : 'Show structure', run: () => st.setStructureOpen(!st.structureOpen) },
    { label: 'Select all', shortcut: `${MOD}A`, run: () => st.selectOnly(st.nodes.map((n) => n.id)) },
  ]
  return (
    <div className="fixed inset-0 z-[95] bg-black/10 flex items-start justify-center pt-[15vh]" onPointerDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="rounded-2xl bg-popover shadow-popover animate-pop overflow-hidden" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex gap-1 p-1.5 border-b">
          {(['nodes', 'actions'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={cn('h-7 px-2.5 rounded-lg text-sm font-medium capitalize', tab === t ? 'bg-gray-alpha-150' : 'hover:bg-gray-alpha-100 text-secondary')}>
              {t === 'nodes' ? 'Add node' : 'Actions'}
            </button>
          ))}
        </div>
        {tab === 'nodes' ? (
          <AddNodeMenu
            className="w-[400px]"
            onPick={(item, modelId) => {
              close()
              pickCatalogItem(item, { modelId })
            }}
          />
        ) : (
          <div className="w-[400px] p-1.5">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  close()
                  a.run()
                }}
                className="flex w-full items-center justify-between h-9 rounded-[10px] px-2.5 text-sm hover:bg-gray-alpha-100"
              >
                {a.label}
                {a.shortcut && <span className="text-xs text-subtle">{a.shortcut}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
