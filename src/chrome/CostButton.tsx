import { Wallet } from 'lucide-react'
import { useMemo } from 'react'
import { Button, PopoverContent, PopoverRoot, PopoverTrigger, Tip } from '../components/ui'
import { vnd } from '../shared/novPricing'
import { useFlow } from '../store/flowStore'

interface Row {
  id: string
  label: string
  kind: 'video' | 'image'
  runs: number
  total: number
}

/**
 * What this flow has really cost on Nov: every run that reported a charge (all takes, retakes included).
 * Refunded / failed jobs never get a cost, Muse has no per-run price – both are left out.
 */
export function CostButton() {
  const nodes = useFlow((s) => s.nodes)
  const { rows, video, image } = useMemo(() => {
    const rows: Row[] = []
    const video = { runs: 0, total: 0 }
    const image = { runs: 0, total: 0 }
    for (const n of nodes) {
      const d: any = n.data
      const paid = (d.generations ?? []).filter((g: any) => g.status === 'done' && typeof g.cost === 'number')
      if (!paid.length) continue
      const kind: Row['kind'] = d.parameters?.modality === 'video' ? 'video' : 'image'
      const total = paid.reduce((a: number, g: any) => a + g.cost, 0)
      rows.push({ id: n.id, label: String(d.label ?? n.id), kind, runs: paid.length, total })
      const bucket = kind === 'video' ? video : image
      bucket.runs += paid.length
      bucket.total += total
    }
    rows.sort((a, b) => b.total - a.total)
    return { rows, video, image }
  }, [nodes])
  const total = video.total + image.total

  return (
    <PopoverRoot>
      <Tip label="Cost of this flow">
        <PopoverTrigger asChild>
          <Button size="md" className="px-2.5 gap-1.5" aria-label="Cost of this flow">
            <Wallet className="w-4 h-4" strokeWidth={1.5} />
            <span className="tabular-nums">{total ? vnd(total) : 'Cost'}</span>
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-[340px] p-4">
        <p className="text-sm font-semibold">Cost of this flow</p>
        <p className="text-xs text-secondary mt-0.5">Real charges reported by Nov – every take, retakes included.</p>
        <div className="mt-3 space-y-1.5 text-sm">
          <Line label={`Seedance video · ${video.runs} run${video.runs === 1 ? '' : 's'}`} value={video.total} />
          <Line label={`Seedream image · ${image.runs} run${image.runs === 1 ? '' : 's'}`} value={image.total} />
          <div className="h-px bg-gray-alpha-150 my-2" />
          <Line label="Total" value={total} strong />
        </div>
        {rows.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-secondary mb-1.5">By node</p>
            <div className="max-h-[220px] overflow-y-auto scrollbar-thin space-y-1">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-xs">
                  <span className="truncate flex-1 min-w-0" title={r.label}>
                    {r.label}
                  </span>
                  <span className="text-subtle shrink-0">
                    {r.runs}×
                  </span>
                  <span className="tabular-nums shrink-0 w-[72px] text-right">{vnd(r.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="text-[11px] leading-4 text-subtle mt-4">Refunded jobs are not counted. Muse runs have no per-run price. Account balance: Settings → Nov → Test connection.</p>
      </PopoverContent>
    </PopoverRoot>
  )
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-secondary'}>{label}</span>
      <span className="tabular-nums">{vnd(value)}</span>
    </div>
  )
}
