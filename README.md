# ele-flows

A node-based canvas for generating **images and videos with the Muse API**. Each node is one step: a text brief, an uploaded file, a Muse image, a Muse video, or a frame taken from a clip. You connect the nodes, press **Run**, and the local server calls Muse and saves every result on your machine.

- Visual editor: drag-and-drop nodes, typed connections, `@mentions` inside prompts, undo/redo and autosave.
- One provider, Muse, for both images and videos (10, 20, 30 or 60 s).
- Shot chaining: take a frame from one clip and continue the next shot from it.
- Headless HTTP API: create a flow from a short JSON spec, run it and read its outputs ([docs/API.md](docs/API.md)).
- Short drama template: turn a story outline into a full shot-by-shot flow ([examples/short-drama](examples/short-drama)).

## Requirements

- Node.js 22 or newer
- A Muse API key
- Optional: [ffmpeg](https://ffmpeg.org/) in `PATH`. It is needed for canvas thumbnails, the **Extract frame** node and jobs with more than 3 reference images.

## Install

```bash
git clone https://github.com/ngoduyangit/ele-flows.git
cd ele-flows
npm install
cp .env.example .env      # then set MUSE_API_KEY=...
npm run dev
```

Open http://localhost:5180. You can also paste the key in the editor: open the menu at the top left and choose **Settings** (or press ⌘,). The key is stored in `.flows/settings.json` and never reaches the browser.

## Using the editor

1. Add nodes with the **+** button, press **N**, or right-click the canvas.
   - **Image generation** and **Video generation** call Muse.
   - **Text** holds a brief, a style or a line of dialogue.
   - **Upload media** adds your own image or video.
   - **Extract frame** takes the first frame, the last frame, or the frame at a given second from a clip.
2. Connect an output (right side) to an input (left side) of the same type: text, image or video.
3. Write the prompt. Type `@` to mention another node: a text node inserts its text, an image node becomes a named reference image.
4. Press **Run** on a node, **Run from here** to also run everything downstream, or ⌘⇧↵ to run every node that has no output yet.
5. A node keeps all its generations. Use the pager on the preview to switch between them, and **Download** to save the file.

Handy actions:

- On an image node, **Presets** creates a wired-in image node in one click: character sheet, scene sheet, product sheet, 3×3 angles, relight, expand to 16:9 or 9:16, and more.
- On a video node, **End frame** adds an Extract frame node. **Continue** creates the next shot, which starts from this clip's last frame.
- Press ⌘K for quick actions: run all, tidy up the layout, zoom to fit…

## Muse in short

- Images: 16:9, 9:16, 1:1, 4:3, 3:4. Videos: 16:9 or 9:16, 10/20/30/60 s.
- Every connected image is sent as a reference, at most 3 per job. With more than 3, images of the same subject are tiled into one sheet. With only one image, Muse uses it as the opening frame.
- Up to 4 Muse jobs run at once. Extra jobs wait in a queue (`MUSE_CONCURRENCY`).

## Data

Everything lives in `.flows/`, which git ignores:

- `flows/`: one JSON file per flow;
- `media/`: uploads and results;
- `settings.json`: your Muse key.

## Scripts

```bash
npm run dev     # editor + API on http://localhost:5180
npm run build   # type-check (tsc -b) and build
npm run lint    # oxlint
```

## For AI coding agents

[AGENTS.md](AGENTS.md) explains the architecture, how to install and drive the app, and how to build short drama flows. Claude Code reads it through `CLAUDE.md`.

## License

[MIT](LICENSE)
