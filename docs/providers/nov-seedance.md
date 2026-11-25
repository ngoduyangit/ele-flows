# Nov (nov.ai.vn) – Seedance video · Seedream image

Provider `nov` in ele-flows. Upstream docs: <https://nov.ai.vn/api-docs>. Key: `NOV_API_KEY` in `.env` (re-read on every job, no restart needed) or **Settings → Nov**.

## Models (pick on the node – the first pill in the node toolbar)

| Node | Model id | Notes |
| --- | --- | --- |
| Video | `nov/seedance-2.5` | 4–30 s, 480p / 720p / 1080p, up to 30 images |
| Video | `nov/seedance-2.5-flash` | cheaper/faster 2.5, up to 10 images |
| Video | `nov/seedance-2.5-ultra` | 720p / 1080p only, highest quality |
| Video | `nov/seedance-2.0`, `nov/seedance-2.0-mini` | 4–15 s, up to 9 images |
| Image | `nov/seedream-5.5` | 2K, up to 10 reference images, ~169 đ / image |
| Image | `nov/seedream-5.0` | 2K, up to 4 reference images, ~197 đ / image |

`muse` stays the default on new nodes. In a workflow spec: `"model": "nov/seedance-2.5"`, `"resolution": "720p"`, `"generateAudio": false`, or `defaults: { videoModel, imageModel }`.

## How images are sent (Seedance, server SV18)

- only a **Start frame** → `image_mode: first_frame` (the clip starts exactly on it); Start + End → `first_last`;
- any **Reference images** → `reference` mode: every image (references → start → end) becomes `@Image1…N`, `@node` chips in the prompt are rewritten to `@ImageN` and a legend `@ImageN: <label>` is put on top. Start/End frames are then strong references, not hard first/last frames.
- Product work: **reference = real product photos (one 2×2 sheet) + start frame = the approved still** → `@Image1` keeps the product exact, `@Image2` sets the composition.

Seedream: `@node` image chips become "reference image K (label)"; the body is built from the chosen server's own param list (servers differ), falling back to the cheapest healthy server of the model.

## Price (VND, 25/11/2026) – shown live on the node header

Seedance 2.5: 480p 4 s 3.500 · 8 s 5.000 · 10 s 6.250 — 720p 4 s 5.000 · 10 s 10.625 — 1080p 10 s 15.625. Full tables: `src/shared/novPricing.ts`.

- New Seedance nodes start at **480p** (test price); raise to 720p/1080p for the approved take.
- Price is not proportional to length – 8–10 s is cheaper per second than 4–5 s.
- The real charge of each run is stored in `generation.cost` and shown on the node header (`paid …`). The **wallet button** in the top bar adds up every paid run of the flow (all takes), split into Seedance / Seedream and listed per node.

## Behaviour worth knowing

- Up to 10 Nov jobs at once server-wide (`NOV_CONCURRENCY`), extra jobs queue.
- A 5xx while **polling** does not cancel the job on Nov (it keeps running and is charged) – the server keeps polling instead of failing. If a result still goes missing, find it by order code in `GET https://nov.ai.vn/api/v1/generations`.
- The moderation filter sometimes refuses a harmless prompt – the job is refunded; just run again.
- Prompts that say "slow / hold / never change" make Seedance return a near-static zoom. Describe a concrete camera path (orbit, slider, pull-back), moving light and parallax elements, and "motion continues through the whole clip".
