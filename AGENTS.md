# AGENTS.md – guide for AI coding agents

This file is for Claude Code (through `CLAUDE.md`), Codex, Cursor and other agents. It covers:

1. installing and running the app;
2. using it, from the editor or the HTTP API;
3. building a **short drama** flow from an outline;
4. how the code is organised and how to extend it.

Human users can start with [README.md](README.md). The full API reference is [docs/API.md](docs/API.md).

---

## 1. Install and run

```bash
git clone https://github.com/ngoduyangit/ele-flows.git
cd ele-flows
npm install
cp .env.example .env          # set MUSE_API_KEY=<key>; ask the user for the key, never invent one
npm run dev                   # editor + API on http://localhost:5180 (one process)
```

Check that the server is up:

```bash
curl -s localhost:5180/api/spec/kinds | head -c 300
curl -s -X POST localhost:5180/api/settings/test/muse        # {"ok":true,"message":"Balance: …"} when the key works
```

- Use Node.js 22 or newer.
- ffmpeg is optional, but without it thumbnails fall back to full images and **Extract frame** and sheets of more than 3 references fail.
- `npm run build` type-checks everything. There are no automated tests: verify changes with `npm run build`, `curl` and the editor.
- The key can also be saved through the API: `PUT /api/settings` with `{"providers":{"muse":{"apiKey":"…"}}}`. Never commit `.env` or `.flows/`.
- Run long commands (`npm run dev`, runs with `wait`) in the background.

## 2. Use

### Editor

Open `http://localhost:5180/#/flows/<id>`. The node kinds are:

- **Text**: a brief, a style or a line of dialogue.
- **Image** / **Video**: an uploaded file.
- **Image generation** / **Video generation**: a Muse job.
- **Extract frame**: a frame of a clip, taken with ffmpeg.
- **Comment**: a sticky note.

Ports are typed (text, image, video). A prompt can mention another node with `@`.

### API (preferred for agents)

1. Write a **workflow spec**: `{name, nodes: [{key, kind, prompt, refs, …}]}`. Mentioning `@key` inside a prompt connects that node.
2. Check it with `POST /api/flows/validate`, then create it with `POST /api/flows`. Add `?overwrite=1` to replace an existing flow with the same id.
3. Run it with `POST /api/flows/<id>/run` and `{"wait": true, "timeoutSec": 900}`. To redo part of a flow, send `from` or `nodes` with `mode: "all"`.
4. Read the results with `GET /api/flows/<id>/outputs`, which returns `{key: {url | text}}`.
5. Show each new clip to the user and let them approve it before you build the next step on it.

Muse rules that shape every prompt:

- Images: 16:9, 9:16, 1:1, 4:3 or 3:4. Videos: 16:9 or 9:16, **10/20/30/60 s** only.
- Muse has no start-frame mode. Every image, including `startFrame`/`endFrame`, is sent as a **reference**, at most **3** per job. Extra images are tiled into a sheet. A job with a single image is treated as the opening frame.
- Keep prompts under ~5000 characters.
- Up to 4 Muse jobs run at once (server-wide queue).

> An open editor tab autosaves its own copy of the flow. After you change a flow with `PUT`/`POST ?overwrite=1`, tell the user to reload the tab.

## 3. Short drama template

A short drama is a vertical (9:16) micro-film of 60–90 s, built from many **single-shot 10 s clips**. The template follows the order that keeps faces and places consistent:

```
character ─► reference sheet ─┐
location  ─► empty set ───────┼─► shot still (image) ─► 10 s clip (video)
                              │
previous clip ─► Extract frame ┴─► next clip (when the shot continues the previous one)
```

### 3.1 Build a flow from an outline

[examples/short-drama/build.mjs](examples/short-drama/build.mjs) turns an outline into a spec. It has no dependencies.

```bash
node examples/short-drama/build.mjs examples/short-drama/outline.example.json --out /tmp/drama.spec.json   # inspect
node examples/short-drama/build.mjs examples/short-drama/outline.example.json --post                     # create the flow
```

Outline format (see [outline.example.json](examples/short-drama/outline.example.json)):

```jsonc
{
  "id": "my-drama-ep1",                 // optional stable flow id
  "title": "My Drama – Episode 1",
  "logline": "One sentence.",
  "aspectRatio": "9:16",                // default 9:16
  "clipSeconds": 10,                    // Muse length per shot (10/20/30/60)
  "style": "Plain, realistic TV-drama look …",
  "characters": [
    { "key": "mai", "name": "Mai", "description": "visible traits: age, hair, outfit…", "faceUrl": "https://… (optional photo)" }
  ],
  "locations": [
    { "key": "busstop", "name": "a city bus stop at dusk", "description": "props, light…" }
  ],
  "shots": [
    { "key": "s01", "location": "busstop", "cast": ["mai"], "shotSize": "medium shot",
      "frame": "what the first frame shows", "action": "what happens in the shot",
      "speaker": "mai", "line": "Short spoken line.", "camera": "slow push in" },
    { "key": "s02", "continuesFrom": "s01", "startAt": 8, "cast": ["mai"], "action": "…" }
  ]
}
```

The builder creates these nodes:

| Outline item | Nodes |
| --- | --- |
| `style` | `style` (text, mentioned by every set and still) |
| character | `<key>_face` (image, only with `faceUrl`) → `<key>_sheet` (image-generation, 16:9 character sheet) |
| location | `<key>_set` (image-generation, empty set, no people) |
| new shot | `<shot>_still` (image-generation; refs = cast sheets + set) → `<shot>_clip` (video-generation; refs = the still only) |
| continuing shot (`continuesFrom`) | `<shot>_start` (last-frame of the previous clip, or the frame at `startAt` seconds) → `<shot>_clip` |

### 3.2 Writing rules (these keep clips usable)

1. **Assets first.** Run and approve the character sheets and sets before you run any still. Use one sheet per character and reuse it in every shot.
2. **One shot per clip.** Write 10 s single-shot clips, never 20 s clips that hold several shots. Each clip prompt has three beats: a 0–1.5 s hold on the opening frame, then the action, then a hold for the last 2 s so the clip can be trimmed.
3. **Video refs = the still only.** A video job takes only its own still (or the previous clip's frame). Extra sheets or sets on a video make it drift.
4. **Continuous shots are chained.** When a shot continues the previous one (same place, uninterrupted action), use `continuesFrom` instead of a new still. Set `startAt` to the second where the part you will **use** of the previous clip ends, not the file's last frame.
5. **Dialogue.** Keep each line short and in English, one line per clip. The builder writes it as "says once, starting at 0.3 s, in one breath … then stays silent", because later starts get cut off or repeated. Plan to dub or subtitle later if the final language is different.
6. **Describe only what is visible.** Shot `frame` and `action` describe what the camera sees: position, pose, expression and visible clothing. Never paste whole character biographies into them.
7. **Faces.** If a still has no face in it, keep the action inside the frame. Never pan to reveal a face that the still does not show.
8. **Look.** The default style is a plain, realistic TV-drama look. Overly "cinematic" wording (anamorphic, glossy, epic) makes Muse output look fake. Never ask for on-screen text.
9. **Approve step by step.** Run in order: `mode: "missing"` for sheets and sets → stills → clips. Send each new clip to the user for approval. Re-run only the clip that needs fixing (`nodes: ["s03_clip"], mode: "all"`).

### 3.3 Typical session

```bash
# 1. create
node examples/short-drama/build.mjs outline.json --post
# 2. assets only
curl -s -X POST localhost:5180/api/flows/my-drama-ep1/run -H 'Content-Type: application/json' \
  -d '{"nodes":["mai_sheet","khoa_sheet","busstop_set"],"wait":true,"timeoutSec":900}'
# 3. after approval: everything that is still missing (stills, then clips)
curl -s -X POST localhost:5180/api/flows/my-drama-ep1/run -H 'Content-Type: application/json' \
  -d '{"wait":true,"timeoutSec":1800}'
# 4. fix one shot with a new prompt
curl -s -X POST localhost:5180/api/flows/my-drama-ep1/run -H 'Content-Type: application/json' \
  -d '{"inputs":{"s03_clip":{"prompt":"Starting exactly from @s03_start, …"}},"nodes":["s03_clip"],"mode":"all","wait":true}'
# 5. collect the clip URLs in story order for editing
curl -s localhost:5180/api/flows/my-drama-ep1/outputs
```

Files are in `.flows/media/`. Editing the final film (trimming, ordering, music) happens outside this app.

---

## 4. Architecture

```
Browser (React 19 + @xyflow/react + zustand)
  src/App.tsx            hash router (#/flows/:id), editor autosave, polling of /api/runs
  src/store/flowStore.ts graph state, undo/redo, runNode / runAll / runFrom
  src/lib/serverApi.ts   FlowApi backed by /api (src/lib/api.ts holds a localStorage mock)
  src/shared/*           shared with the server – no React/DOM imports
        │ fetch /api/*
server/ (Vite plugin, Node – same process, port 5180)
  plugin.ts     routes: /api/flows, /api/run, /api/runs, /api/settings, /api/upload, /api/media
  providers.ts  Muse adapter + run(req) router (image | video | frame)
  runner.ts     headless runs (in memory), writes results into the flow file
  editorRuns.ts editor runs that survive a page reload
  ffmpeg.ts     extract a frame, tile reference images into a sheet
  flows.ts      .flows/flows/<id>.json
  media.ts      .flows/media (+ thumbnails) → /api/media/<file>
  settings.ts   Muse key/base URL (.flows/settings.json, chmod 600) + MUSE_API_KEY
```

Running one node:

1. `flowStore.runNode` calls `buildRunRequest(contextFor(node, nodes, edges))` in **`src/shared/runRequest.ts`**.
2. That produces `POST /api/run {capability, prompt, images, …}`.
3. On the server, `providers.run()` → `muse.image` / `muse.video` submits the job, polls until it is done, downloads the file to `.flows/media` and returns `{url}`.
4. The editor adds a `Generation` to `node.data.generations`.

The headless runner uses the **same** `buildRunRequest`, so the editor and the API always produce identical requests. Never duplicate that logic.

### Data model (`src/lib/types.ts`, `src/shared/flowSpec.ts`)

- `FlowDocument {id, name, nodes, edges, createdAt, updatedAt}`
- Node types:
  - `text`;
  - `content-generation` (`parameters.modality` is `image` or `video`);
  - `image` and `video` (assets);
  - `process` (`data.kind` is `last-frame`);
  - `comment`.
- Edge: `{source, sourceHandle: 'output', target, targetHandle: <port id>}`. Ports come from `portsFor()` in `src/shared/flowSpec.ts`.
- Prompts are Tiptap JSON. A node mention is `{type: 'prompt-tag', attrs: {id: 'node:<id>', label}}`.

### Extending

- **A new node kind:**
  1. Add it to `portsFor`, `specKinds` and `nodeDataFor` in `flowSpec.ts`.
  2. Add a `CATALOG` entry and an icon in `src/lib/registry.tsx`.
  3. Build a component in `src/nodes/` and register it in `nodeTypes` (`src/canvas/FlowCanvas.tsx`).
  4. Add a case in `buildRunRequest`.
  5. Add a capability in `server/providers.ts`.
  6. If the node never runs, add it to `PASSIVE` in both `server/runner.ts` and `src/store/flowStore.ts`.
  7. Document it in `docs/API.md` and `docs/workflow-spec.schema.json`.
- **A new route:** add a branch in `handle()` in `server/plugin.ts`, before the 404, and document it.
- **Invariants:**
  - `src/shared/` never imports React, the DOM, `@xyflow` or `src/lib/*`.
  - The Muse key never reaches the browser.
  - `/api` refuses cross-origin requests.
  - `.flows/` is runtime data: never commit it or delete it.
- **Code style:** TypeScript, React function components, Tailwind v4 classes, short English comments that explain *why*. All UI text and docs are in English.

## Nov provider (Seedance / Seedream)

- Model ids `nov/<model>` on `parameters.video.modelId` / `parameters.image.modelId`; anything else runs on Muse (`run()` in `server/providers.ts`). Resolution on `parameters.resolution`, audio on `parameters.video.generateAudio`.
- Seedance (`nov.video`) always uses server SV18; Seedream (`nov.image`) builds the body from each server's param list. Pricing + node pickers: `src/shared/novPricing.ts`.
- Reference images → `@ImageN` reference mode; only start(/end) frame → `first_frame` / `first_last`. Details: `docs/providers/nov-seedance.md`.
- `POST /api/flows/:id/run` with `inputs` wipes that node's generation history – pass `inputs` only for nodes being re-run.
- An open editor tab autosaves its copy over model/prompt edits written straight into the flow file; to run with settings that differ from the node, call `POST /api/run` with `track` (see `examples/tvc/nov_direct.py`).

## Scenes board

- `src/shared/board.ts`: `board = { scenes: [{id, name, key?, note?, shots: [{id, node, note?}]}], hidden? }` stored on the flow (`FlowDocument.board`); absent = detected from labels. `resolveBoard(board, nodes, edges)` drops shots of deleted nodes and adds new ones by label; a shot's still is derived from edges (startFrame > coded/frame ref > last ref), never stored.
- `src/scenes/`: `ScenesView` (scene tree, shot strip, drag & drop), `ShotEditor` (still | video, prompt, refs, model, Run), `boardOps.ts` (board edits; create still/video; *Make independent*), `shotInfo.ts`.
- The board shares the store with the canvas (`setBoard` is one undo step). `FlowCanvas` unmounts on the board so its window shortcuts never act on hidden nodes; route `#/flows/:id/scenes`, toggle in the top bar or `⇧S`.
- Spec: `scenes: [{name, key?, note?, shots: ["v01", {node, note}]}]` → `boardFromSpec`.

