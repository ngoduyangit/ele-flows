/** Flow documents stored as JSON files in .flows/flows/<id>.json. */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FlowDocumentJSON } from '../src/shared/flowSpec.ts'
import { downloadToStore } from './media.ts'
import { DATA_DIR } from './settings.ts'

const DIR = join(DATA_DIR, 'flows')
const ID = /^[A-Za-z0-9_-]{3,64}$/

const file = (id: string) => {
  if (!ID.test(id)) throw Object.assign(new Error('invalid flow id'), { status: 400 })
  return join(DIR, `${id}.json`)
}

export function listFlows() {
  if (!existsSync(DIR)) return []
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const d = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as FlowDocumentJSON
        return { id: d.id, name: d.name, description: d.description, nodeCount: d.nodes?.length ?? 0, createdAt: d.createdAt, updatedAt: d.updatedAt }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b!.updatedAt - a!.updatedAt)
}

export function loadFlow(id: string): FlowDocumentJSON | null {
  const f = file(id)
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
}

export function flowExists(id: string) {
  return existsSync(file(id))
}

export function saveFlow(doc: FlowDocumentJSON) {
  if (!doc?.id || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw Object.assign(new Error('flow must have id, nodes and edges'), { status: 400 })
  mkdirSync(DIR, { recursive: true })
  const f = file(doc.id)
  const tmp = `${f}.tmp`
  writeFileSync(tmp, JSON.stringify(doc))
  renameSync(tmp, f) // atomic replace
  return doc
}

export function deleteFlow(id: string) {
  const f = file(id)
  if (!existsSync(f)) return false
  rmSync(f)
  return true
}

/** Copy remote asset URLs of asset nodes into the local media store so they never expire. */
export async function localizeAssets(doc: FlowDocumentJSON, warnings: string[]) {
  for (const n of doc.nodes) {
    const ref = n.data?.assetReference
    const url: string | undefined = ref?.previewUrl
    if (!url || !/^https?:\/\//.test(url)) continue
    try {
      const local = await downloadToStore(url, {}, n.type === 'video' ? 'video/mp4' : 'image/png')
      n.data.assetReference = { ...ref, content_asset_id: local, previewUrl: local }
    } catch (e: any) {
      warnings.push(`node "${n.data.label}": could not download ${url} (${e?.message ?? e}) – kept the remote URL`)
    }
  }
}
