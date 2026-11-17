/** Toolbar actions: one-click image presets and first/last-frame continuation. */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useReactFlow } from '@xyflow/react'
import { ImageDown, LayoutGrid, LoaderCircle, StepForward } from 'lucide-react'
import { useState } from 'react'
import { Menu, MenuContent, MenuLabel, Tip, cn, menuItemCls } from '../components/ui'
import { applyImagePreset, continueFromFrame, extractFrameNode, nodeOutputUrl } from '../lib/graphOps'
import { IMAGE_PRESETS } from '../lib/presets'
import { useFlow } from '../store/flowStore'

const btn =
  'nodrag inline-flex h-8 items-center gap-1 rounded-[10px] px-2 text-sm font-medium text-foreground hover:bg-gray-alpha-100 data-[state=open]:bg-gray-alpha-200 disabled:text-subtle disabled:hover:bg-transparent focus-ring [&_svg]:w-[18px] [&_svg]:h-[18px]'

export function PresetMenu({ id }: { id: string }) {
  const hasImage = useFlow((s) => !!nodeOutputUrl(s.nodes.find((n) => n.id === id)))
  const { fitView } = useReactFlow()
  return (
    <Menu>
      <Tip label={hasImage ? 'Presets – one click, no prompt' : 'Generate or upload an image first'}>
        <DropdownMenu.Trigger asChild disabled={!hasImage}>
          <button type="button" className={btn} disabled={!hasImage}>
            <LayoutGrid strokeWidth={1.5} />
            <span className="text-xm">Presets</span>
          </button>
        </DropdownMenu.Trigger>
      </Tip>
      <MenuContent align="start" className="w-[260px]">
        <MenuLabel>Create from this image</MenuLabel>
        {IMAGE_PRESETS.map((p) => {
          const Icon = p.icon
          return (
            <DropdownMenu.Item
              key={p.id}
              className={cn(menuItemCls, 'h-auto py-1.5 items-start')}
              onSelect={() => {
                const nid = applyImagePreset(id, p.id)
                if (nid) setTimeout(() => fitView({ nodes: [{ id }, { id: nid }], duration: 350, padding: 0.25, maxZoom: 1 }), 60)
              }}
            >
              <Icon className="w-4 h-4 mt-0.5 text-secondary shrink-0" strokeWidth={1.5} />
              <span className="min-w-0">
                <span className="block">{p.label}</span>
                <span className="block text-xs text-subtle">{p.hint}</span>
              </span>
            </DropdownMenu.Item>
          )
        })}
      </MenuContent>
    </Menu>
  )
}

export function ContinueButton({ id }: { id: string }) {
  const hasVideo = useFlow((s) => !!nodeOutputUrl(s.nodes.find((n) => n.id === id)))
  const [busy, setBusy] = useState(false)
  const { fitView } = useReactFlow()
  return (
    <Tip label={hasVideo ? 'Continue from last frame' : 'Generate or upload a video first'}>
      <button
        type="button"
        disabled={!hasVideo || busy}
        className={btn}
        onClick={async () => {
          setBusy(true)
          try {
            const next = await continueFromFrame(id, 'last')
            setTimeout(() => fitView({ nodes: [{ id }, { id: next }], duration: 350, padding: 0.2, maxZoom: 1 }), 60)
          } catch (e: any) {
            alert(e?.message ?? String(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? <LoaderCircle className="animate-spin" /> : <StepForward strokeWidth={1.5} />}
        <span className="text-xm">Continue</span>
      </button>
    </Tip>
  )
}

/** Video toolbar: add an "Extract frame" node (end frame by default; pick any time on the node). */
export function FrameButton({ id }: { id: string }) {
  const hasVideo = useFlow((s) => !!nodeOutputUrl(s.nodes.find((n) => n.id === id)))
  const { fitView } = useReactFlow()
  return (
    <Tip label={hasVideo ? 'Extract end frame (or pick a time) – use it as the next shot’s reference' : 'Generate or upload a video first'}>
      <button
        type="button"
        disabled={!hasVideo}
        className={btn}
        onClick={() => {
          const nid = extractFrameNode(id)
          if (nid) setTimeout(() => fitView({ nodes: [{ id }, { id: nid }], duration: 350, padding: 0.25, maxZoom: 1 }), 60)
        }}
      >
        <ImageDown strokeWidth={1.5} />
        <span className="text-xm whitespace-nowrap">End frame</span>
      </button>
    </Tip>
  )
}
