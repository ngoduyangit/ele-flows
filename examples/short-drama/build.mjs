#!/usr/bin/env node
/**
 * Short drama template builder.
 *
 * Turns a short outline (characters, locations, shots) into a workflow spec for this app:
 *   character → reference sheet, location → empty set, shot → still image → 10 s Muse clip.
 * A shot that continues the previous one (same place, continuous action) starts from a frame of
 * the previous clip instead of a new still.
 *
 * Usage:
 *   node examples/short-drama/build.mjs <outline.json>                 # print the spec
 *   node examples/short-drama/build.mjs <outline.json> --out spec.json # write it to a file
 *   node examples/short-drama/build.mjs <outline.json> --post [url]    # create the flow (default http://localhost:5180)
 *
 * Outline format: see examples/short-drama/outline.example.json and AGENTS.md § "Short drama template".
 */
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--') && !/^https?:/.test(a))
if (!file) {
  console.error('usage: node build.mjs <outline.json> [--out spec.json] [--post [http://localhost:5180]]')
  process.exit(1)
}
const outline = JSON.parse(readFileSync(file, 'utf8'))
const fail = (msg) => {
  console.error(`outline error: ${msg}`)
  process.exit(1)
}

const AR = outline.aspectRatio ?? '9:16'
const STYLE = outline.style ?? 'Plain, realistic TV-drama look: natural light, true-to-life skin texture, muted colours, handheld 35mm.'
const DURATION = outline.clipSeconds ?? 10 // Muse renders 10, 20, 30 or 60 s
const chars = new Map((outline.characters ?? []).map((c) => [c.key, c]))
const locs = new Map((outline.locations ?? []).map((l) => [l.key, l]))
const shots = outline.shots ?? []
if (!shots.length) fail('"shots" is empty')

const nodes = []
const add = (n) => nodes.push(n)

// 1. shared look
add({ key: 'style', kind: 'text', label: 'Style', text: STYLE })

// 2. characters: optional face photo → reference sheet (same person in every shot)
for (const c of chars.values()) {
  if (!c.key || !c.name) fail('every character needs "key" and "name"')
  const sheet = `${c.key}_sheet`
  if (c.faceUrl) {
    add({ key: `${c.key}_face`, kind: 'image', label: `${c.name} – face`, url: c.faceUrl })
    add({
      key: sheet,
      kind: 'image-generation',
      label: `${c.name} – sheet`,
      aspectRatio: '16:9',
      refs: [`${c.key}_face`],
      prompt: `Character reference sheet of the exact same person as in @${c.key}_face (${c.name}): left, a head-and-shoulders close-up looking into the lens; right, full-body front, side and back views standing relaxed. ${c.description ?? ''} Identical face, hair and outfit in every view, plain light grey background, even studio light, photorealistic, no text, no labels.`,
    })
  } else {
    add({
      key: sheet,
      kind: 'image-generation',
      label: `${c.name} – sheet`,
      aspectRatio: '16:9',
      prompt: `Character reference sheet of one person, ${c.name}: ${c.description ?? ''} Left, a head-and-shoulders close-up looking into the lens; right, full-body front, side and back views standing relaxed. Identical face, hair and outfit in every view, plain light grey background, even studio light, photorealistic, no text, no labels.`,
    })
  }
}

// 3. locations: the empty set, so every shot in it shares props and light
for (const l of locs.values()) {
  if (!l.key || !l.name) fail('every location needs "key" and "name"')
  add({
    key: `${l.key}_set`,
    kind: 'image-generation',
    label: `${l.name} – set`,
    aspectRatio: AR,
    prompt: `Wide establishing shot of ${l.name}, no people: ${l.description ?? ''} @style`,
  })
}

// 4. shots
const clipKey = (s) => `${s.key}_clip`
shots.forEach((s, i) => {
  if (!s.key) fail(`shots[${i}] needs a "key"`)
  const cast = (s.cast ?? []).map((k) => chars.get(k) ?? fail(`shot "${s.key}": unknown character "${k}"`))
  const loc = s.location ? (locs.get(s.location) ?? fail(`shot "${s.key}": unknown location "${s.location}"`)) : null
  const who = cast.map((c) => c.name).join(' and ')
  // dialogue: spoken once, early, then a silent hold – later starts get cut or repeated by the model
  const line = s.line ? ` ${s.speaker ? chars.get(s.speaker)?.name ?? s.speaker : who} says once, starting at 0.3 s, in one breath: "${s.line}" – then stays silent.` : ''
  let start
  if (s.continuesFrom) {
    const prev = shots.find((x) => x.key === s.continuesFrom) ?? fail(`shot "${s.key}": continuesFrom "${s.continuesFrom}" not found`)
    // take the frame where the previous clip's used part ends, not the file's last frame
    start = `${s.key}_start`
    add({
      key: start,
      kind: 'last-frame',
      label: `${s.key} – start (from ${prev.key})`,
      inputs: { video: clipKey(prev) },
      ...(s.startAt != null ? { which: 'time', at: s.startAt } : {}),
    })
  } else {
    start = `${s.key}_still`
    const refs = [...cast.map((c) => `${c.key}_sheet`), ...(loc ? [`${loc.key}_set`] : [])]
    add({
      key: start,
      kind: 'image-generation',
      label: `${s.key} – still`,
      aspectRatio: AR,
      refs,
      prompt: [
        `Film still, ${s.shotSize ?? 'medium shot'}${loc ? ` in @${loc.key}_set` : ''}.`,
        s.frame ?? '',
        cast.map((c) => `${c.name} looks exactly like @${c.key}_sheet.`).join(' '),
        '@style',
      ].filter(Boolean).join(' '),
    })
  }
  add({
    key: clipKey(s),
    kind: 'video-generation',
    label: `${s.key} – clip`,
    aspectRatio: AR,
    duration: DURATION,
    refs: [start],
    prompt: [
      `Starting exactly from @${start}, one continuous shot, no cuts.`,
      `0–1.5 s: hold on the opening frame, small natural movement only.`,
      `${s.action ?? ''}${line}`,
      `Last 2 s: hold the final pose so the clip can be trimmed.`,
      s.camera ? `Camera: ${s.camera}.` : 'Camera: steady, slight handheld drift.',
      'No on-screen text, no subtitles, no music.',
    ].filter((t) => t.trim()).join('\n'),
  })
})

const spec = {
  ...(outline.id ? { id: outline.id } : {}),
  name: outline.title ?? 'Short drama',
  description: outline.logline ?? '',
  defaults: { aspectRatio: AR },
  nodes,
}

const outIdx = args.indexOf('--out')
const postIdx = args.indexOf('--post')
if (outIdx >= 0) {
  writeFileSync(args[outIdx + 1], JSON.stringify(spec, null, 2))
  console.error(`wrote ${args[outIdx + 1]} (${nodes.length} nodes)`)
}
if (postIdx >= 0) {
  const base = (args[postIdx + 1] && /^https?:/.test(args[postIdx + 1]) ? args[postIdx + 1] : 'http://localhost:5180').replace(/\/+$/, '')
  const headers = { 'Content-Type': 'application/json', ...(process.env.FLOWS_API_TOKEN ? { Authorization: `Bearer ${process.env.FLOWS_API_TOKEN}` } : {}) }
  const r = await fetch(`${base}/api/flows?overwrite=1`, { method: 'POST', headers, body: JSON.stringify(spec) })
  const j = await r.json()
  if (!r.ok) {
    console.error(JSON.stringify(j, null, 2))
    process.exit(1)
  }
  console.error(`created ${j.id} – open ${j.editorUrl}`)
}
if (outIdx < 0 && postIdx < 0) console.log(JSON.stringify(spec, null, 2))
