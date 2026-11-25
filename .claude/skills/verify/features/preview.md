# Preview pane

A page opens in a pane beside the chat, so the user reads the reply and sees the result side by side. Hermes opens it with its `desktop_preview` tool, or the user presses a web link in a reply and picks **Preview**, or picks **Preview** in an HTML file's **More for** menu. The pane's bar shows the page's title (Hermes's label, else the page's own title, else its address), **Reload**, **Open in browser** for a web page, and a close button named "Close preview". Main draws the page in a view of its own, in an in-memory session with no preload, so the page cannot reach Highwing. A page that fails to load shows the reason and **Open in browser**. Under 900 px of width the pane covers the chat, and **Back to chat** closes it.

## Sub-features

- `preview-hermes` opens the page a `preview.open` frame of the shown chat names, under its label.
- `preview-link` opens a reply's web link in the pane from the link's menu, and the browser is not opened.
- `preview-browse` sends the page to the browser opener from **Open in browser**. Only http and https reach it, which `apps/desktop/test/ipc.test.ts` covers.
- `preview-isolated` gives the page no `window.highwing`, no new window, no way to move the app's window and no file outside its own folder.
- `preview-close` closes the pane on a `preview.close` frame.
- `preview-failed` shows why a page did not load, with **Open in browser**.
- `preview-narrow` covers the chat under 900 px of width, with **Back to chat**.
- `preview-file` shows an HTML file a step wrote, from its **More for** menu.

## How to get to it (user POV)

- Ask Hermes to build a page and show it. The pane opens beside the chat.
- Press a web link in a reply and pick **Preview**.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.
- Every recipe passes `--fixture fixtures/preview.jsonl --serve fixtures/preview`, so the fixture's `http://localhost:5173/` is the test page served for the run. `PRE` is `wait live type "Message Hermes" @request click button Send`.

- **Hermes opens it.** Run `$H run --fixture fixtures/preview.jsonl --serve fixtures/preview --run preview PRE wait preview see demo previewing http://localhost:5173/ shot pane`. `pane.aria.txt` holds `region "Preview"` with `heading "demo"`, `button "Reload"`, `button "Open in browser"` and `button "Close preview"`. `pane.png` shows the heading "Preview works" in the pane.
- **A link, then Preview.** Run `$H run ... --run preview-link PRE wait settled click button "Close preview" gone region Preview click link "the demo" click button Preview wait preview previewing http://localhost:5173/ nothing-opened shot link-preview`. The pane's heading is the page's own title, "Demo page".
- **Open in browser.** Run `$H run ... --run preview-browse PRE wait preview previewing http://localhost:5173/ click button "Open in browser" opened browse http://localhost:5173/`.
- **Isolated.** Run `$H run ... --run preview-isolated PRE wait preview previewing http://localhost:5173/ page-says "No Highwing API" page-says "No way out of the pane" page-says "No file outside the page" home`. The page reports what it could reach, and the app's window is where it launched.
- **Hermes closes it.** Run `$H run --fixture fixtures/preview-close.jsonl --serve fixtures/preview --run preview-close PRE wait preview previewing http://localhost:5173/ gone region Preview`. The close frame comes about 2 s after the open.
- **A page that fails.** Run `$H run ... --run preview-failed PRE wait settled click link "the old docs" click button Preview see "Highwing couldn't find" previewing http://unreachable.invalid/ count button "Open in browser" 1 shot failed`. `failed.aria.txt` holds an `alert` with "Highwing couldn't find unreachable.invalid." and `button "Open in browser"`.
- **Narrow.** Run `$H run ... --size 860x860 --run preview-narrow PRE wait preview previewing http://localhost:5173/ shot covered count button "Close preview" 0 click button "Back to chat" gone region Preview wait live`. `covered.aria.txt` holds no composer, and `covered.png` shows the bots and the page.
- **An HTML file.** Run `$H run ... --run preview-file PRE wait settled click button "Close preview" gone region Preview click button "/^Created index.html/" click button "More for index.html" click button Preview wait preview page-says "No file outside the page" nothing-opened shot file-preview`. The pane shows `/tmp/hermes-proto-work/site/index.html` with no **Open in browser**. Main loads a file page from its `highwing-page:` scheme, which serves the page's own folder and nothing outside it, so the page's read of `file:///etc/hostname` fails.

## Gotchas

- The page is not in the renderer, so `see` and the ARIA snapshot never find its text. Use `page-says`, and `shot`, which draws the page onto the PNG.
- A fixture run is a local connection. The words for a remote Hermes's localhost and files come from `apps/desktop/test/preview-page.test.ts`, not a run.
- **An HTML file** reads the file from this machine's disk. The fixture's recording leaves it at `/tmp/hermes-proto-work/site/index.html`. Without it the pane says "This file isn't there any more."
- A dialog of the window that overlaps the pane, such as the image viewer, draws under the page. Close the pane before you shoot one.
