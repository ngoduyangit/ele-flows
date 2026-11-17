/**
 * Local API mounted into the Vite dev/preview server at /api.
 * Keeps provider keys server-side, avoids CORS, polls long jobs and stores results locally.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { MEDIA_PREFIX, saveMedia, serveMedia, serveThumb } from './media.ts'
import { LABEL, PROVIDERS, ProviderError, run, type RunRequest } from './providers.ts'
import { loadSettings, publicSettings, updateSettings, type ProviderId } from './settings.ts'
import { deleteFlow, flowExists, listFlows, loadFlow, localizeAssets, saveFlow } from './flows.ts'
import { activeJobFor, cancelJob, getJob, listJobs, startRun, summary, sweepInterrupted, waitFor, flowOutputs, type RunOptions } from './runner.ts'
import { buildFlowFromSpec, specKinds, type FlowDocumentJSON, type WorkflowSpec } from '../src/shared/flowSpec.ts'
import { cancelEditorRun, listEditorRuns, startEditorRun, type Track } from './editorRuns.ts'

type Next = (err?: unknown) => void

function send(res: ServerResponse, status: number, body: unknown) {
  if (res.writableEnded) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage, limit = 300 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) throw new ProviderError('Body too large', 413)
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks)
}
const readJson = async <T>(req: IncomingMessage): Promise<T> => {
  const b = await readBody(req, 50 * 1024 * 1024)
  return (b.length ? JSON.parse(b.toString('utf8')) : {}) as T
}

/** Only accept calls from this app's own pages (blocks other sites hitting localhost). */
function sameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/**
 * Optional token for callers outside the editor (other projects / servers).
 * Set FLOWS_API_TOKEN to require `Authorization: Bearer <token>`; the editor's own
 * same-origin requests never need it.
 */
function authorized(req: IncomingMessage) {
  const token = process.env.FLOWS_API_TOKEN
  if (!token) return true
  if (req.headers['sec-fetch-site'] === 'same-origin') return true
  return req.headers.authorization === `Bearer ${token}`
}

const editorUrl = (req: IncomingMessage, id: string) => `http://${req.headers.host ?? 'localhost:5180'}/#/flows/${id}`

function isSpec(body: any): body is WorkflowSpec {
  return Array.isArray(body?.nodes) && body.nodes.some((n: any) => n && typeof n.kind === 'string' && typeof n.key === 'string')
}

async function handle(req: IncomingMessage, res: ServerResponse, next: Next) {
  const url = new URL(req.url ?? '/', 'http://local')
  const path = url.pathname
  if (!path.startsWith('/api/')) return next()
  if (path.startsWith(MEDIA_PREFIX) && req.method === 'GET') {
    const w = Number(url.searchParams.get('w'))
    return w > 0 ? serveThumb(req, res, path.slice(MEDIA_PREFIX.length), w) : serveMedia(req, res, path.slice(MEDIA_PREFIX.length))
  }
  if (!sameOrigin(req)) return send(res, 403, { error: 'cross-site request refused' })
  if (!authorized(req)) return send(res, 401, { error: 'missing or invalid Authorization bearer token (FLOWS_API_TOKEN)' })

  const ctrl = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) ctrl.abort()
  })

  try {
    // ---- flows (public API for other projects) ---------------------
    if (path === '/api/spec/kinds' && req.method === 'GET') return send(res, 200, specKinds())
    if (path === '/api/flows' && req.method === 'GET') return send(res, 200, listFlows())
    if ((path === '/api/flows' || path === '/api/flows/validate') && req.method === 'POST') {
      const body = await readJson<any>(req)
      const validateOnly = path.endsWith('/validate') || url.searchParams.get('dryRun') === '1'
      let doc: FlowDocumentJSON
      let warnings: string[] = []
      if (isSpec(body)) {
        const r = buildFlowFromSpec(body)
        if (!r.ok) return send(res, 422, { ok: false, errors: r.errors, warnings: r.warnings })
        doc = r.flow!
        warnings = r.warnings
      } else {
        if (!body?.name || !Array.isArray(body?.nodes) || !Array.isArray(body?.edges))
          return send(res, 422, { ok: false, errors: ['Send a workflow spec (nodes with key/kind) or a full flow document (name, nodes, edges)'] })
        const now = Date.now()
        doc = { ...body, id: body.id ?? undefined, createdAt: body.createdAt ?? now, updatedAt: now }
        if (!doc.id) doc.id = (await import('nanoid')).nanoid(20)
      }
      if (validateOnly) return send(res, 200, { ok: true, warnings, flow: doc })
      if (flowExists(doc.id) && url.searchParams.get('overwrite') !== '1') return send(res, 409, { ok: false, errors: [`flow "${doc.id}" already exists – use ?overwrite=1 or PUT /api/flows/${doc.id}`] })
      await localizeAssets(doc, warnings)
      // an open editor tab on an overwritten flow must reload instead of saving its old copy over this one
      saveFlow({ ...doc, externalEditAt: Date.now() })
      return send(res, 201, { ok: true, id: doc.id, name: doc.name, editorUrl: editorUrl(req, doc.id), nodeCount: doc.nodes.length, edgeCount: doc.edges.length, warnings })
    }
    // ---- headless runs --------------------------------------------
    const runMatch = /^\/api\/flows\/([A-Za-z0-9_-]+)\/run$/.exec(path)
    if (runMatch && req.method === 'POST') {
      const body = await readJson<RunOptions & { wait?: boolean; timeoutSec?: number }>(req)
      const base = `http://${req.headers.host ?? 'localhost:5180'}`
      const job = await startRun(runMatch[1], body, base)
      const wait = body.wait || url.searchParams.get('wait') === '1'
      if (wait) {
        await waitFor(job, Math.min(Math.max(Number(body.timeoutSec ?? url.searchParams.get('timeout') ?? 600), 1), 1800) * 1000)
        return send(res, job.status === 'running' ? 202 : 200, { ...summary(job), statusUrl: `${base}/api/runs/${job.id}` })
      }
      return send(res, 202, { ...summary(job), statusUrl: `${base}/api/runs/${job.id}` })
    }
    const outputsMatch = /^\/api\/flows\/([A-Za-z0-9_-]+)\/outputs$/.exec(path)
    if (outputsMatch && req.method === 'GET') {
      if (!flowExists(outputsMatch[1])) return send(res, 404, { error: 'flow not found' })
      return send(res, 200, flowOutputs(outputsMatch[1], `http://${req.headers.host ?? 'localhost:5180'}`))
    }
    if (path === '/api/runs' && req.method === 'GET') {
      const flowId = url.searchParams.get('flowId') ?? undefined
      if (url.searchParams.get('active') === '1') {
        const j = flowId ? activeJobFor(flowId) : undefined
        return send(res, 200, j ? [summary(j)] : [])
      }
      return send(res, 200, [...listJobs(flowId).slice(0, 50).map(summary), ...listEditorRuns(flowId)])
    }
    const jobMatch = /^\/api\/runs\/([0-9a-f-]+)(\/cancel)?$/.exec(path)
    if (jobMatch) {
      const job = getJob(jobMatch[1])
      if (!job) return send(res, 404, { error: 'run not found (runs are kept in memory until the server restarts)' })
      if (jobMatch[2] && req.method === 'POST') {
        cancelJob(job.id)
        return send(res, 200, { ok: true })
      }
      if (url.searchParams.get('wait') === '1') await waitFor(job, Math.min(Number(url.searchParams.get('timeout') ?? 60), 600) * 1000)
      return send(res, 200, summary(job))
    }

    const flowMatch = /^\/api\/flows\/([A-Za-z0-9_-]+)$/.exec(path)
    if (flowMatch) {
      const id = flowMatch[1]
      if (req.method === 'GET') {
        const f = loadFlow(id)
        return f ? send(res, 200, f) : send(res, 404, { error: 'flow not found' })
      }
      if (req.method === 'PUT') {
        const body = await readJson<any>(req)
        let doc: FlowDocumentJSON
        const warnings: string[] = []
        if (isSpec(body)) {
          const r = buildFlowFromSpec({ ...body, id })
          if (!r.ok) return send(res, 422, { ok: false, errors: r.errors, warnings: r.warnings })
          doc = { ...r.flow!, externalEditAt: Date.now() }
          warnings.push(...r.warnings)
          await localizeAssets(doc, warnings)
        } else {
          const prev = loadFlow(id)
          // Only the editor's own autosave (same-origin) can be stale: keep results/inputs written by a headless
          // run that it hasn't picked up yet. Explicit PUTs from other projects replace the flow as sent.
          const fromEditor = req.headers['sec-fetch-site'] === 'same-origin'
          // the flow was replaced from outside after this tab loaded it: refuse, the editor reloads instead of
          // writing its old graph over the external change
          if (fromEditor && (prev?.externalEditAt ?? 0) > (body.externalEditAt ?? 0))
            return send(res, 409, { error: 'stale: flow was changed outside the editor', stale: true })
          doc = {
            ...body,
            id,
            description: body.description ?? prev?.description,
            externalEditAt: fromEditor ? prev?.externalEditAt : Date.now(),
            updatedAt: Date.now(),
            createdAt: body.createdAt ?? prev?.createdAt ?? Date.now(),
          }
          for (const n of fromEditor ? (doc.nodes ?? []) : []) {
            const old = prev?.nodes.find((x) => x.id === n.id)
            // inputs changed by the API after the editor loaded win over the editor's stale copy
            if (old?.data?.apiUpdatedAt && (n.data?.apiUpdatedAt ?? 0) < old.data.apiUpdatedAt) {
              n.data = { ...n.data, apiUpdatedAt: old.data.apiUpdatedAt }
              if ('text' in old.data) n.data.text = old.data.text
              if ('assetReference' in old.data) n.data.assetReference = old.data.assetReference
              if (old.data.parameters && n.data.parameters) n.data.parameters = { ...n.data.parameters, prompt: old.data.parameters.prompt }
            }
            // a server-side run finished after the editor last saw it: the editor's copy still says running
            const oldGens: any[] = old?.data?.generations ?? []
            if (n.data?.generations?.length)
              n.data.generations = n.data.generations.map((g: any) => {
                const o = oldGens.find((x) => x.id === g.id && x.source === 'api')
                return o && (g.status === 'running' || g.status === 'queued') && o.status !== 'running' ? o : g
              })
            const pending = oldGens.filter((g: any) => g.source === 'api' && !(n.data?.generations ?? []).some((x: any) => x.id === g.id))
            if (pending.length) {
              n.data.generations = [...(n.data.generations ?? []), ...pending]
              n.data.activeGenerationId = pending.at(-1).id
            }
          }
        }
        saveFlow(doc)
        return send(res, 200, { ok: true, id, editorUrl: editorUrl(req, id), warnings })
      }
      if (req.method === 'DELETE') return deleteFlow(id) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'flow not found' })
    }

    // ---- settings -------------------------------------------------
    if (path === '/api/settings' && req.method === 'GET') return send(res, 200, publicSettings(loadSettings()))
    if (path === '/api/settings' && req.method === 'PUT') return send(res, 200, publicSettings(updateSettings(await readJson(req))))
    const test = /^\/api\/settings\/test\/(\w+)$/.exec(path)
    if (test && req.method === 'POST') {
      const id = test[1] as ProviderId
      const p = (PROVIDERS as any)[id]
      if (!p) return send(res, 404, { error: 'unknown provider' })
      try {
        return send(res, 200, await p.test())
      } catch (e: any) {
        return send(res, 200, { ok: false, message: e?.message ?? String(e) })
      }
    }

    // ---- uploads --------------------------------------------------
    if (path === '/api/upload' && req.method === 'POST') {
      const buf = await readBody(req)
      const mime = url.searchParams.get('type') || req.headers['content-type'] || 'application/octet-stream'
      return send(res, 200, { url: saveMedia(buf, mime, url.searchParams.get('name') ?? undefined), mimeType: mime })
    }

    // ---- run a node -----------------------------------------------
    if (path === '/api/run/cancel' && req.method === 'POST') {
      const { genId } = await readJson<{ genId?: string }>(req)
      return send(res, 200, { ok: !!genId && cancelEditorRun(genId) })
    }
    if (path === '/api/run' && req.method === 'POST') {
      const { track, ...body } = await readJson<RunRequest & { track?: Track }>(req)
      const started = Date.now()
      // editor runs carry `track`: they keep going if the tab reloads and write their result into the flow
      const tracked = track?.flowId && track.nodeId && track.genId && flowExists(track.flowId)
      const out = tracked ? await startEditorRun(body, track) : await run(body, ctrl.signal)
      console.log(`[flows] ${body.capability} via ${LABEL[out.provider as ProviderId] ?? out.provider} in ${((Date.now() - started) / 1000).toFixed(1)}s`)
      return send(res, 200, out)
    }

    return send(res, 404, { error: 'not found' })
  } catch (e: any) {
    const status = e instanceof ProviderError ? e.status : typeof e?.status === "number" ? e.status : 500
    if (status !== 499) console.warn(`[flows] ${path}: ${e?.message ?? e}`)
    return send(res, status, { error: e?.message ?? String(e) })
  }
}

/** Sweep orphans at startup, then every minute for runs whose owning server process has died. */
let sweeping: ReturnType<typeof setInterval> | undefined
function startSweeping() {
  const busy = () => new Set(listEditorRuns().filter((r) => r.status === 'running').map((r) => r.nodes[0].nodeId))
  sweepInterrupted({ startup: true, busy: busy() })
  if (sweeping) clearInterval(sweeping)
  sweeping = setInterval(() => sweepInterrupted({ busy: busy() }), 60_000)
  sweeping.unref?.()
}

export function flowsApi(): Plugin {
  const mw = (req: IncomingMessage, res: ServerResponse, next: Next) => {
    handle(req, res, next).catch((e) => send(res, 500, { error: String(e) }))
  }
  return {
    name: 'flows-api',
    configureServer(server) {
      startSweeping()
      server.middlewares.use(mw)
    },
    configurePreviewServer(server) {
      startSweeping()
      server.middlewares.use(mw)
    },
  }
}
