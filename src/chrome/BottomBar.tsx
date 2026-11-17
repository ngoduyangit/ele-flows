import { Hand, MessageCircle, MousePointer2, Plus } from 'lucide-react'
import { AddNodeMenu } from '../components/AddNodeMenu'
import { PopoverContent, PopoverRoot, PopoverTrigger, Tip } from '../components/ui'
import { pickCatalogItem } from '../canvas/actions'
import { useFlow, type Tool } from '../store/flowStore'

function ToolButton({ tool, label, shortcut, children }: { tool: Tool; label: string; shortcut: string; children: React.ReactNode }) {
  const active = useFlow((s) => s.tool === tool)
  return (
    <Tip label={label} shortcut={shortcut}>
      <button
        type="button"
        onClick={() => useFlow.getState().setTool(tool)}
        data-state={active ? 'on' : 'off'}
        className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-foreground hover:bg-gray-alpha-100 data-[state=on]:bg-gray-alpha-200 focus-ring transition-colors"
      >
        {children}
      </button>
    </Tip>
  )
}

export function BottomBar() {
  const addOpen = useFlow((s) => s.addMenuOpen)
  const setAddOpen = useFlow((s) => s.setAddMenuOpen)
  return (
    <div className="absolute bottom-5 inset-x-0 pointer-events-none flex justify-center z-20">
      <div className="flex items-end gap-3">
        <div className="pointer-events-auto bg-popover/90 backdrop-blur-md rounded-2xl flex items-center shadow-natural-sm gap-1.5 p-2">
          <ToolButton tool="select" label="Select" shortcut="V">
            <MousePointer2 className="w-[18px] h-[18px]" strokeWidth={1.5} />
          </ToolButton>
          <ToolButton tool="hand" label="Hand" shortcut="H">
            <Hand className="w-[18px] h-[18px]" strokeWidth={1.5} />
          </ToolButton>
          <ToolButton tool="comment" label="Comment" shortcut="C">
            <MessageCircle className="w-[18px] h-[18px]" strokeWidth={1.5} />
          </ToolButton>
          <PopoverRoot open={addOpen} onOpenChange={setAddOpen}>
            <Tip label="Add node" shortcut="N">
              <PopoverTrigger asChild>
                <div className="size-[34px] flex items-center justify-center">
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background hover:bg-gray-800 data-[state=open]:bg-gray-700 focus-ring"
                  >
                    <Plus className="w-[18px] h-[18px]" strokeWidth={1.5} />
                  </button>
                </div>
              </PopoverTrigger>
            </Tip>
            <PopoverContent side="top" align="start" sideOffset={14} className="overflow-hidden" onOpenAutoFocus={(e) => e.preventDefault()}>
              <AddNodeMenu
                onPick={(item, modelId) => {
                  setAddOpen(false)
                  pickCatalogItem(item, { modelId })
                }}
              />
            </PopoverContent>
          </PopoverRoot>
        </div>
      </div>
    </div>
  )
}
