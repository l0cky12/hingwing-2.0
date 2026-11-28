# Images in the thread

A reply's Markdown image (`![a chart](https://…)`) and a tool step's image (`image_path` on `tool.complete`) draw in the thread at most the thread's width. Main loads every image: a web image through `net.fetch`, and a tool image from disk only when Hermes runs on this computer and a finished step named that path. Main reads the type from the bytes. It accepts PNG, JPEG, GIF, WebP and AVIF up to 10 MiB and refuses SVG. A refused or failed image shows its alt text and "Couldn't load this image." Pressing an image opens a dialog with the full-size image and a Close button. Escape closes it, and focus returns to the image.

## Sub-features

- `images-thread` draws the reply image and the tool image from one settled turn.
- `images-viewer` opens the larger view on press, and Escape closes it with focus back on the image.
- `images-refused` is covered by `apps/desktop/test/images.test.ts`, not a run. A `file:` or `javascript:` URL, an SVG, a file over the cap and a remote tool image are all refused.

## How to get to it (user POV)

- Run `HIGHWING_FIXTURE=$PWD/fixtures/images.jsonl pnpm --filter @highwing/desktop start` from the repo root, type in the "Message Hermes" box and press Send.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.

- **Thread and viewer.** Run `$H run --fixture fixtures/images.jsonl --run images wait live type "Message Hermes" @request click button Send wait settled shot images click button "a chart" see Close shot viewer press Escape gone dialog "a chart" focused button "a chart" shot closed quiet`. `images.aria.txt` holds `img "dashboard.png"` under the step and `img "a chart"` under the reply. `viewer.aria.txt` holds `dialog "a chart"` with `img "a chart"` inside it.

## Gotchas

- In a fixture run, main answers image loads from the fixture header's `media` map and touches neither the network nor the disk. A URL or path that is not in `media` fails as a missing image.
- History rows from Hermes carry no `image_path`, so a tool image shows only on a turn this window saw live.
