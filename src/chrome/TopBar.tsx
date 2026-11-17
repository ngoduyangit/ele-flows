import { useReactFlow, useStore } from '@xyflow/react'
import { ChevronDown, CloudAlert, CloudCheck, LoaderCircle, Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, MOD, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tip, cn } from '../components/ui'
import { useFlow } from '../store/flowStore'
import { navigate } from '../router'

const pill = 'pointer-events-auto bg-popover/90 backdrop-blur-md rounded-xl flex shadow-natural-sm'

function FlowsLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="4.5" cy="4.5" r="2" />
      <circle cx="13.5" cy="13.5" r="2" />
      <path d="M6.5 4.5h2.5a2.5 2.5 0 0 1 2.5 2.5v4.5" />
      <path d="M4.5 6.5v4.5A2.5 2.5 0 0 0 7 13.5h4.5" opacity=".55" />
    </svg>
  )
}

export function TopBar({ onDuplicate, onDelete, onNewFlow }: { onDuplicate: () => void; onDelete: () => void; onNewFlow: () => void }) {
  const name = useFlow((s) => s.name)
  const setName = useFlow((s) => s.setName)
  const canUndo = useFlow((s) => s.past.length > 0)
  const canRedo = useFlow((s) => s.future.length > 0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) setTimeout(() => inputRef.current?.select(), 0)
  }, [editing])
  const commit = () => {
    const v = draft.trim()
    if (v) setName(v)
    setEditing(false)
  }
  const st = useFlow.getState

  return (
    <div className="absolute top-4 inset-x-4 flex items-start justify-between pointer-events-none z-20">
      <div className={cn(pill, 'h-11')}>
        <div className="p-1 border-r border-border select-none">
          <Menu>
            <MenuTrigger asChild>
              <Button size="md" className="gap-1.5 px-2.5">
                <FlowsLogo />
                <span className="text-md font-medium">Flows</span>
                <ChevronDown className="w-[18px] h-[18px] text-subtle ml-1 -mr-[3px]" strokeWidth={1.5} />
              </Button>
            </MenuTrigger>
            <MenuContent align="start" className="min-w-[200px]">
              <MenuItem onSelect={() => navigate('/')}>Back to home</MenuItem>
              <MenuItem onSelect={onNewFlow}>New flow</MenuItem>
              <MenuItem shortcut={`${MOD}K`} onSelect={() => st().setQuickActionsOpen(true)}>
                Quick actions
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  setDraft(name)
                  setTimeout(() => setEditing(true), 50)
                }}
              >
                Rename
              </MenuItem>
              <MenuItem onSelect={onDuplicate}>Duplicate</MenuItem>
              <MenuItem onSelect={() => navigator.clipboard?.writeText(location.href)}>Share</MenuItem>
              <MenuSeparator />
              <MenuItem shortcut={`${MOD}⇧↵`} onSelect={() => st().runAll(true)}>
                Run all
              </MenuItem>
              <MenuItem shortcut="⇧T" onSelect={() => window.dispatchEvent(new Event('flows:tidy'))}>
                Tidy up
              </MenuItem>
              <MenuSeparator />
              <MenuItem shortcut={`${MOD}Z`} disabled={!canUndo} onSelect={() => st().undo()}>
                Undo
              </MenuItem>
              <MenuItem shortcut={`${MOD}⇧Z`} disabled={!canRedo} onSelect={() => st().redo()}>
                Redo
              </MenuItem>
              <MenuSeparator />
              <MenuItem shortcut={`${MOD},`} onSelect={() => st().setSettingsOpen(true)}>
                Settings
              </MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={onDelete}>Delete flow</MenuItem>
            </MenuContent>
          </Menu>
        </div>
        <div className="p-1">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
              className="h-9 px-2.5 text-md font-medium rounded-lg outline-none ring-1 ring-gray-alpha-300 w-[200px] bg-background"
            />
          ) : (
            <p
              role="button"
              aria-label="Rename flow"
              onClick={() => {
                setDraft(name)
                setEditing(true)
              }}
              className="text-foreground px-2.5 py-1.5 text-md font-medium max-w-[170px] truncate hover:bg-gray-alpha-100 duration-100 transition-colors rounded-lg cursor-pointer focus-ring"
            >
              {name}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <div className={pill}>
          <div className="flex items-center p-1">
            <ZoomMenu />
            <SaveStatus />
            <Button size="md" className="px-3" onClick={() => navigator.clipboard?.writeText(location.href)}>
              Copy link
            </Button>
          </div>
          <div className="flex border-l border-border p-1.5">
            <Tip label="Settings">
              <Button size="icon" aria-label="Settings" onClick={() => st().setSettingsOpen(true)}>
                <Settings className="w-[18px] h-[18px]" strokeWidth={1.5} />
              </Button>
            </Tip>
          </div>
        </div>
      </div>
    </div>
  )
}

function ZoomMenu() {
  const zoom = useStore((s) => s.transform[2])
  const rf = useReactFlow()
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="md" className="px-3 tabular-nums">
          {Math.round(zoom * 100)}%
          <ChevronDown className="w-[18px] h-[18px] text-subtle ml-[5px] -mr-[3px]" strokeWidth={1.5} />
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-[200px]">
        <MenuItem shortcut={`${MOD}+`} onSelect={() => rf.zoomIn({ duration: 150 })}>
          Zoom in
        </MenuItem>
        <MenuItem shortcut={`${MOD}-`} onSelect={() => rf.zoomOut({ duration: 150 })}>
          Zoom out
        </MenuItem>
        <MenuItem shortcut="⇧1" onSelect={() => rf.fitView({ duration: 300, padding: 0.1 })}>
          Zoom to fit
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => rf.zoomTo(0.5, { duration: 150 })}>Zoom to 50%</MenuItem>
        <MenuItem shortcut={`${MOD}0`} onSelect={() => rf.zoomTo(1, { duration: 150 })}>
          Zoom to 100%
        </MenuItem>
        <MenuItem onSelect={() => rf.zoomTo(2, { duration: 150 })}>Zoom to 200%</MenuItem>
      </MenuContent>
    </Menu>
  )
}

function SaveStatus() {
  const s = useFlow((s) => s.saveState)
  const label = s === 'saving' ? 'Saving…' : s === 'error' ? 'Failed to save' : s === 'unsaved' ? 'Unsaved changes' : 'All changes saved'
  return (
    <Tip label={label}>
      <span aria-label="Saving status" className="inline-flex h-9 w-9 items-center justify-center text-secondary rounded-lg cursor-default">
        {s === 'saving' ? (
          <LoaderCircle className="w-[18px] h-[18px] text-subtle animate-spin" strokeWidth={1.5} />
        ) : s === 'error' ? (
          <CloudAlert className="w-[18px] h-[18px] text-red-500" strokeWidth={1.5} />
        ) : (
          <CloudCheck className={cn('w-[18px] h-[18px] text-subtle', s === 'unsaved' && 'opacity-60')} strokeWidth={1.5} />
        )}
      </span>
    </Tip>
  )
}
