import { useEffect, useMemo, useRef, useState } from 'react'
import { CATALOG, CATALOG_SECTIONS, type CatalogItem } from '../lib/registry'
import { cn } from './ui'

const CHIPS = ['Image', 'Video', 'Text'] as const

/** Searchable node catalog – used by the "+" button, pane menu "View all nodes" and Quick actions. */
export function AddNodeMenu({ onPick, autoFocus = true, className }: { onPick: (item: CatalogItem, modelId?: string) => void; autoFocus?: boolean; className?: string }) {
  const [q, setQ] = useState('')
  const [chip, setChip] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus(), 0)
  }, [autoFocus])

  const s = q.trim().toLowerCase()
  const sections = useMemo(() => {
    const match = (i: CatalogItem) => !s || (i.label + ' ' + (i.keywords ?? '') + ' ' + i.category).toLowerCase().includes(s)
    const out: { title: string; items: { item: CatalogItem; modelId?: string; label?: string }[] }[] = []
    if (!s && !chip) out.push({ title: 'Most used', items: CATALOG.filter((i) => i.mostUsed).map((item) => ({ item })) })
    for (const cat of CATALOG_SECTIONS) {
      if (chip && chip !== cat) continue
      const items = CATALOG.filter((i) => i.category === cat && (s || chip || !i.mostUsed || cat === 'Text') && match(i)).map((item) => ({ item }))
      // When not searching, section lists skip items already shown under "Most used"
      const list = !s && !chip ? items.filter(({ item }) => !item.mostUsed) : items
      if (list.length) out.push({ title: cat, items: list })
    }
    return out
  }, [s, chip])

  const flat = sections.flatMap((x) => x.items)
  useEffect(() => setActive(0), [s, chip])

  return (
    <div className={cn('w-[320px] flex flex-col max-h-[464px]', className)}>
      <div className="px-1 pt-1">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search nodes..."
          className="w-full h-10 px-3 text-[15px] outline-none bg-transparent placeholder:text-subtle"
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(flat.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter' && flat[active]) {
              onPick(flat[active].item, flat[active].modelId)
            }
          }}
        />
      </div>
      <div className="h-px bg-gray-alpha-150" />
      <div className="flex gap-1.5 px-2.5 py-2.5">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChip(chip === c ? null : c)}
            className={cn(
              'h-7 px-2 rounded-lg text-sm font-medium border transition-colors',
              chip === c ? 'bg-foreground text-background border-foreground' : 'border-gray-alpha-200 hover:bg-gray-alpha-100',
            )}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="overflow-y-auto scrollbar-thin px-1.5 pb-1.5">
        {sections.map((sec) => (
          <div key={sec.title}>
            <div className="px-2 pt-2 pb-1 text-xs font-medium text-secondary">{sec.title}</div>
            {sec.items.map(({ item, modelId, label }) => {
              const idx = flat.findIndex((f) => f.item === item && f.modelId === modelId)
              const Icon = item.icon
              return (
                <button
                  key={item.key + (modelId ?? '')}
                  type="button"
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => onPick(item, modelId)}
                  className={cn('flex w-full items-center gap-3 h-10 rounded-[10px] px-1.5 text-left text-[15px]', idx === active && 'bg-gray-alpha-100')}
                >
                  <span className="w-7 h-7 rounded-lg bg-gray-alpha-100 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-secondary" strokeWidth={1.5} />
                  </span>
                  <span className="truncate">{label ?? item.label}</span>
                  {modelId && <span className="ml-auto text-xs text-subtle pr-1">{item.label}</span>}
                </button>
              )
            })}
          </div>
        ))}
        {!flat.length && <p className="py-8 text-center text-sm text-subtle">No results</p>}
      </div>
    </div>
  )
}
