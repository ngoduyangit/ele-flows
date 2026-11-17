import { useReactFlow, useStore } from '@xyflow/react'
import { LayoutGrid, Maximize, Minus, Plus } from 'lucide-react'
import { MOD, Tip } from '../components/ui'

const b = 'inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-foreground hover:bg-gray-alpha-100 focus-ring [&_svg]:w-4 [&_svg]:h-4'

/** Bottom-left canvas controls: zoom and one-click "arrange board". */
export function CanvasControls() {
  const zoom = useStore((s) => s.transform[2])
  const rf = useReactFlow()
  return (
    <div className="absolute left-4 bottom-5 z-20 pointer-events-auto bg-popover/90 backdrop-blur-md rounded-xl shadow-natural-sm flex items-center gap-0.5 p-1">
      <Tip label="Tidy up – arrange board" shortcut="⇧T">
        <button type="button" className={b} onClick={() => window.dispatchEvent(new Event('flows:tidy'))}>
          <LayoutGrid strokeWidth={1.5} />
        </button>
      </Tip>
      <Tip label="Zoom to fit" shortcut="⇧1">
        <button type="button" className={b} onClick={() => rf.fitView({ duration: 300, padding: 0.1 })}>
          <Maximize strokeWidth={1.5} />
        </button>
      </Tip>
      <div className="w-px h-5 bg-gray-alpha-200 mx-0.5" />
      <Tip label="Zoom out" shortcut={`${MOD}-`}>
        <button type="button" className={b} onClick={() => rf.zoomOut({ duration: 150 })}>
          <Minus strokeWidth={1.5} />
        </button>
      </Tip>
      <span className="w-11 text-center text-xs font-medium tabular-nums text-secondary">{Math.round(zoom * 100)}%</span>
      <Tip label="Zoom in" shortcut={`${MOD}+`}>
        <button type="button" className={b} onClick={() => rf.zoomIn({ duration: 150 })}>
          <Plus strokeWidth={1.5} />
        </button>
      </Tip>
    </div>
  )
}
