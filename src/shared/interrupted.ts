/**
 * Generations left as running/queued with nothing working on them (server restarted, tab closed
 * mid-run) would spin forever – mark them as interrupted errors so the node can be run again.
 */
export const INTERRUPTED = 'Interrupted – nothing is working on this any more (server restarted or the tab was closed). Run it again.'

/** Server process that runs a generation – lets one server tell another server's live runs from orphans. */
export type GenOwner = { pid: number }
type Gen = { id: string; status?: string; error?: string; owner?: GenOwner }
type DocLike = { nodes: { id: string; data?: any }[] }

/**
 * Mutates `doc`; `busy` = node ids a live job is still running; `keep(g)` = true for a generation that is
 * still owned by a live process (another dev server sharing .flows). Returns how many generations were fixed.
 */
export function markInterrupted(doc: DocLike, busy: Set<string> = new Set(), keep: (g: Gen) => boolean = () => false) {
  let fixed = 0
  for (const n of doc.nodes) {
    const gens: Gen[] | undefined = n.data?.generations
    if (!gens?.length || busy.has(n.id)) continue
    n.data.generations = gens.map((g) => {
      if ((g.status !== 'running' && g.status !== 'queued') || keep(g)) return g
      fixed++
      return { ...g, status: 'error', error: INTERRUPTED }
    })
  }
  return fixed
}
