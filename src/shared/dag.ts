/**
 * Run a dependency graph with bounded parallelism (shared by the editor and the headless runner).
 * A node starts once every dependency that is part of `order` has settled; independent branches
 * run side by side, up to `limit` at a time. `work` returns false (or throws) on failure; with
 * `stopOnError` no new node starts after a failure, while already running ones finish.
 */
export const RUN_CONCURRENCY = 4

export async function runDag(
  order: string[],
  deps: (id: string) => string[],
  work: (id: string) => Promise<boolean>,
  o: { limit?: number; stopOnError?: boolean } = {},
): Promise<{ failed: boolean; unstarted: string[] }> {
  const limit = Math.max(1, o.limit ?? RUN_CONCURRENCY)
  const stopOnError = o.stopOnError ?? true
  const inOrder = new Set(order)
  const settled = new Set<string>()
  const waiting = [...order]
  const running = new Set<Promise<void>>()
  let failed = false
  for (;;) {
    if (!(failed && stopOnError)) {
      for (let i = 0; i < waiting.length && running.size < limit; ) {
        const id = waiting[i]
        if (!deps(id).every((d) => !inOrder.has(d) || d === id || settled.has(d))) {
          i++
          continue
        }
        waiting.splice(i, 1)
        const p: Promise<void> = work(id)
          .catch(() => false)
          .then((ok) => {
            if (!ok) failed = true
            settled.add(id)
            running.delete(p)
          })
        running.add(p)
      }
    }
    // nothing running → either all done, stopped, or the rest is blocked (cycle)
    if (!running.size) break
    await Promise.race(running)
  }
  return { failed, unstarted: waiting }
}
