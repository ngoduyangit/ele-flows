# HTTP API

The dev server (`npm run dev`, port **5180**) serves the editor and a JSON API under `/api`. Other apps and scripts can use it to create flows from a short spec, run them headless and collect the results.

- All bodies are JSON unless stated otherwise.
- Requests that carry an `Origin` header from another host are refused (403). Call the API from a backend or script, not from another website.
- If `FLOWS_API_TOKEN` is set, every call from outside the editor needs `Authorization: Bearer <token>`.
- Media URLs inside flows are relative (`/api/media/<file>`). Run results and outputs return absolute URLs.

## Quick start

```bash
# 1. Create a flow from a spec
curl -s -X POST localhost:5180/api/flows -H 'Content-Type: application/json' \
  --data-binary @examples/starter.spec.json

# 2. Run every node that has no output yet and wait for the result (up to 10 min)
curl -s -X POST localhost:5180/api/flows/muse-starter/run -H 'Content-Type: application/json' \
  -d '{"wait": true, "timeoutSec": 600}'

# 3. Read the outputs again later
curl -s localhost:5180/api/flows/muse-starter/outputs
```

## Workflow spec

A spec is a short description of a flow. The server turns it into a full flow document: it generates node ids and default data, creates the connections and lays the nodes out.

```json
{
  "id": "my-flow",
  "name": "My flow",
  "defaults": { "aspectRatio": "9:16" },
  "nodes": [
    { "key": "brief", "kind": "text", "text": "A cat astronaut floats past a window." },
    { "key": "still", "kind": "image-generation", "prompt": "Film still. @brief" },
    { "key": "clip", "kind": "video-generation", "duration": 10, "refs": ["still"], "prompt": "Starting from @still, the cat waves." }
  ]
}
```

| Kind | What it does | Fields |
| --- | --- | --- |
| `text` | Static text (brief, style, dialogue…) | `text` |
| `image`, `video` | An existing file | `url` (http(s), `data:` or `/api/media/...`), `mimeType` |
| `image-generation` | Muse text/reference images → image | `prompt`, `aspectRatio` (`16:9`, `9:16`, `1:1`, `4:3`, `3:4`), `refs` |
| `video-generation` | Muse text/reference images → video | `prompt`, `aspectRatio` (`16:9`, `9:16`), `duration` (10, 20, 30, 60), `refs`, `startFrame`, `endFrame` |
| `last-frame` | Extract a frame from a video with local ffmpeg | `inputs: {"video": "<key>"}`, `which` (`last` (default), `first`, `time`), `at` (seconds) |
| `comment` | Sticky note, never runs | `text` |

Every node also accepts `key` (required, unique), `kind` (required), `label` and `position`. The live list, with each kind's ports, is at `GET /api/spec/kinds`. The JSON Schema is [workflow-spec.schema.json](workflow-spec.schema.json).

**Connections**
- `refs`, `startFrame` and `endFrame` connect image nodes to a generation node.
- `@key` in a `prompt` does two things. For a text node, it inserts that node's text. For an image node, it names the image ("reference image 1 (label)") and connects the image as a reference if it isn't connected yet.
- `inputs: {"<port>": "<key>" | ["<key>", …]}` connects a node to any input port.
- The top-level `edges: [{"from", "to", "port"?}]` adds explicit connections.

**How Muse handles images.** Muse has no real start-frame mode. Reference images, start frames and end frames are all sent as reference images, at most 3 per job. With more than 3, images of the same subject are tiled into one sheet, which needs ffmpeg. With a single image, Muse treats it as the opening frame.

## Flows

| Method & path | Description |
| --- | --- |
| `GET /api/spec/kinds` | Node kinds, their ports and accepted fields |
| `GET /api/flows` | List flows `[{id, name, nodeCount, createdAt, updatedAt}]` |
| `POST /api/flows` | Create a flow from a spec or a full flow document. `?overwrite=1` replaces an existing id. Returns `201 {id, editorUrl, nodeCount, edgeCount, warnings}`, `409` if the id exists, `422 {errors}` for an invalid spec |
| `POST /api/flows/validate` | Same checks as create, but saves nothing. Returns `{ok, warnings, flow}` |
| `GET /api/flows/:id` | The full flow document |
| `PUT /api/flows/:id` | Replace the flow with a spec or a full document |
| `DELETE /api/flows/:id` | Delete the flow. Media files are kept |
| `GET /api/flows/:id/outputs` | Current outputs keyed by spec key (or node id): `{key: {nodeId, label, type, status, url?, text?}}` |

Remote asset URLs are downloaded into the local media store when a flow is created, because provider links expire.

> An editor tab that is open on a flow keeps autosaving its own copy. After you change a flow through the API, reload that tab or close it. Results written by runs and inputs set by `run` are always kept.

## Headless runs

`POST /api/flows/:id/run`

```json
{
  "mode": "missing",
  "from": "shot2",
  "nodes": ["shot1", "shot2"],
  "inputs": { "brief": { "text": "New brief" }, "hero": { "prompt": "New prompt @brief" }, "photo": { "url": "https://…" } },
  "continueOnError": false,
  "callbackUrl": "https://your-app/hook",
  "wait": true,
  "timeoutSec": 600
}
```

All fields are optional:

- `mode`:
  - `"missing"` (the default) runs only nodes that have no output yet.
  - `"all"` re-runs every node.
- `from` runs this node (key, id or label) and everything downstream of it, plus any upstream input that has no output yet.
- `nodes` runs only these nodes, in dependency order.
- `inputs` overrides inputs before running:
  - `text` sets the text of a text node;
  - `prompt` sets a generation prompt (`@key` works);
  - `url` sets the file of an image or video node.

  A node whose input changes loses its old results.
- Independent branches run in parallel, up to 4 at once. The server never runs more than 4 Muse jobs at a time (`MUSE_CONCURRENCY`).
- `wait: true` holds the request until the run finishes or times out (`timeoutSec`, at most 1800). Without it, the call returns `202` right away.
- `callbackUrl` receives a `POST` with the run summary when the run ends.
- Only one run per flow can be active at a time. A second one gets `409`.

Response (run summary):

```json
{
  "jobId": "…", "flowId": "muse-starter", "status": "running | done | error | cancelled",
  "progress": { "total": 3, "done": 2, "running": 1 },
  "nodes": [{ "nodeId": "…", "key": "shot1", "label": "Shot 1", "status": "done", "url": "http://localhost:5180/api/media/….mp4" }],
  "outputs": { "shot1": { "url": "…" } },
  "statusUrl": "http://localhost:5180/api/runs/<jobId>"
}
```

| Method & path | Description |
| --- | --- |
| `GET /api/runs?flowId=` | Recent runs, including runs started from the editor (`kind: "editor"`) |
| `GET /api/runs/:jobId` | One run. `?wait=1&timeout=60` blocks until it finishes |
| `POST /api/runs/:jobId/cancel` | Cancel the run |

Runs live in memory. If the server restarts, generations that were running are marked "Interrupted" and need to be run again.

## Low-level calls

| Method & path | Description |
| --- | --- |
| `POST /api/run` | Run one request: `{capability: "image" | "video" | "frame", prompt, aspectRatio, durationSecs, images[], imageLabels[], startFrame, endFrame, video, which, at}`. Returns `{url, provider}` |
| `POST /api/upload?name=&type=` | Raw file body. Returns `{url, mimeType}` |
| `GET /api/media/:file` | Stored file, with Range support. `?w=256|512|768` returns a cached JPEG thumbnail (a poster frame for videos; needs ffmpeg) |
| `GET /api/settings` | Muse settings with the key masked |
| `PUT /api/settings` | `{providers: {muse: {apiKey?, baseUrl?, enabled?}}}`. `apiKey: ""` removes the saved key |
| `POST /api/settings/test/muse` | Checks the key and returns the Muse balance |

## Muse API used by the server

For reference, `server/providers.ts` calls Muse like this (`Authorization: Bearer <MUSE_API_KEY>`):

| Call | Body / result |
| --- | --- |
| `POST {base}/v1/images` | `{prompt, aspect_ratio, images?}` → `{id}` |
| `POST {base}/v1/videos` | `{prompt, aspect_ratio, duration_seconds, images?}` → `{id}` |
| `GET {base}/v1/images/:id`, `GET {base}/v1/videos/:id` | `{status: "queued" | "running" | "done" | "failed", url?, error?}`, polled every 5 s for up to 6 min |
| `GET {base}/v1/balance` | `{remaining_videos, tier_name}` |

`images` is a list of `{mime_type, data_base64, filename}`, at most 3. Finished files are downloaded to `.flows/media`, so links never expire.
