# Preview pane

A page opens in a pane beside the chat, so the user reads the reply and sees the result side by side. Hermes opens it with its `desktop_preview` tool, or the user presses a web link in a reply and picks **Preview**, or presses **Preview** beside an HTML, PDF or CSV file's path. The pane's bar shows the page's title (Hermes's label, else the page's own title, else its address, or a file's name), **Reload**, **Open in browser** for a web page or **Open** for a file on this computer, and a close button named "Close preview". Main draws the page in a view of its own, in an in-memory session with no preload, so the page cannot reach Highwing. A page that fails to load shows the reason and **Open in browser**. Under 900 px of width the pane covers the chat, and **Back to chat** closes it.

## Sub-features

- `preview-hermes` opens the page a `preview.open` frame of the shown chat names, under its label.
- `preview-link` opens a reply's web link in the pane from the link's menu, and the browser is not opened.
- `preview-browse` sends the page to the browser opener from **Open in browser**. Only http and https reach it, which `apps/desktop/test/ipc.test.ts` covers.
- `preview-isolated` gives the page no `window.highwing`, no new window, no way to move the app's window and no file outside its own folder.
- `preview-close` closes the pane on a `preview.close` frame.
- `preview-failed` shows why a page did not load, with **Open in browser**.
- `preview-narrow` covers the chat under 900 px of width, with **Back to chat**.
- `preview-file` shows an HTML file a step wrote, from **Preview** beside its path.
- `preview-csv` shows a CSV a step wrote as a table with a sticky header row and a row count. Quoted fields keep their commas and newlines in one cell.
- `preview-csv-cut` shows the first 5,000 rows of a longer CSV, says how many it holds, and scrolls with the keyboard.
- `preview-pdf` shows a PDF in Chromium's own viewer, with its page count, zoom and paging.
- `preview-file-refused` shows why a file can't show, over the size limit or not a PDF, with **Open** beside the reason.
- `page-card` shows each HTML file a turn's finished steps wrote as a card under the reply, titled by the `<title>` its diff shows, else by its name, with **Open**.
- `page-open` fills the window with the page from the card's **Open**, with the chat in a 400 px panel at its side and no sidebar. **Close page** gives the window back to the chat.
- `page-remote` reads the page over ssh when Hermes runs on an ssh machine, so the pane has no **Open** for a file on this computer.

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
- **An HTML file.** Run `$H run ... --run preview-file PRE wait settled click button "Close preview" gone region Preview click button "/^Created index.html/" click button "Preview index.html" wait preview page-says "No file outside the page" nothing-opened shot file-preview`. The pane shows `/tmp/hermes-proto-work/site/index.html` with no **Open in browser**. Main loads a file page from its `highwing-page:` scheme, which serves the page's own folder and nothing outside it, so the page's read of `file:///etc/hostname` fails.
- **A CSV.** The file recipes play `fixtures/preview-files.jsonl` with no `--serve`. `FPRE` is `wait live type "Message Hermes" @request click button Send wait settled click button "/^Created report.csv,/"`. Run `$H run --fixture fixtures/preview-files.jsonl --run preview-csv FPRE click button "/^Created report.csv \+/" click button "Preview report.csv" wait preview see Alice nothing-opened shot csv`. `csv.aria.txt` holds `heading "report.csv"`, `button "Open"`, and a `table` with `columnheader "name"`, `"total"` and `"month"`, rows for Alice, Bob and Chen, and `status: 3 rows`.
- **Quoted fields.** Run `$H run ... --run preview-quoted FPRE click button "/^Created quoted.csv \+/" click button "Preview quoted.csv" wait preview see "Smith, Alice" shot quoted`. `quoted.aria.txt` holds `cell "Smith, Alice"`, `cell "Said \"thanks\""` and `cell "Paid in two parts: first in October"`, where the snapshot prints the cell's newline as a space. `apps/desktop/test/preview-file.test.ts` parses the same bytes, `fixtures/preview-files/quoted.csv`.
- **A long CSV.** `EPRE` is `wait live type "Message Hermes" @request click button Send wait settled click button "/^Edited big.csv and/"`. Run `$H run ... --run preview-big EPRE click button "/^Edited big.csv \+/" click button "Preview big.csv" wait preview see "Showing the first 5,000 of 20,000 rows" click region Rows press End shot big-end inview cell customer-005000 press Home shot big-home inview cell customer-000001 inview columnheader customer quiet`. The `shot` after each key lets the smooth scroll land before `inview` looks.
- **A PDF.** Run `$H run ... --run preview-pdf FPRE click button "/^Created report.pdf \+/" click button "Preview report.pdf" wait preview previewing "/report\.pdf$/" nothing-opened shot pdf`. `pdf.png` shows "Quarterly report" on the first page and `1 / 2` in the viewer's bar.
- **Too big.** Run `$H run ... --run preview-huge EPRE click button "/^Edited huge.csv \+/" click button "Preview huge.csv" wait preview see "huge.csv is 12.7 MB. Highwing previews a CSV up to 10 MB." click button Open opened open /tmp/hermes-proto-work/reports/huge.csv`.
- **Not a PDF.** Run `$H run ... --run preview-fake FPRE click button "/^Created scan.pdf \+/" click button "Preview scan.pdf" wait preview see "This isn't a PDF." shot fake`. `fake.aria.txt` holds the alert and `button "Open"`, and `fake.png` shows no viewer.

- **A page card.** Run `$H run ... --run page-card PRE wait settled click button "Close preview" gone region Preview see "Demo page" shot card click button "Open Demo page" wait preview page-says "Preview works" shot page click button "Close page" gone region Preview`. `card.aria.txt` holds `region "Demo page"` with `heading "Demo page"` and `button "Open Demo page"`. `page.png` shows the page on the left and the chat on the right, with no sidebar.
- **A page on an ssh machine.** Run `$H run --fake-host ok --saved remote --fixture fixtures/preview.jsonl --run page-remote PRE wait settled click button "Close preview" gone region Preview click button "Open Demo page" wait preview page-says "Preview works" shot remote`. The fake machine's ssh reads the file from this computer's disk, so the same gotcha applies. `remote.aria.txt` holds the pane with `button "Reload"` and `button "Close page"` and no `button "Open"`.

## Gotchas

- A page open full window shares its layout with the other views. Ctrl+Shift+T draws the task board in the chat's side panel, the bot's screen (the computer view) takes the pane back beside the chat with the sidebar, and Settings hides the pane. Leaving the screen or Settings brings the full-window page back.
- The page is not in the renderer, so `see` and the ARIA snapshot never find its text. Use `page-says`, and `shot`, which draws the page onto the PNG.
- A fixture run is a local connection. The words for a remote Hermes's localhost and files come from `apps/desktop/test/preview-page.test.ts`, not a run.
- **An HTML file** reads the file from this machine's disk. The fixture's recording leaves it at `/tmp/hermes-proto-work/site/index.html`. Without it the pane says "This file isn't there any more." Copy `fixtures/preview/index.html` there to bring it back.
- **The file recipes** read `/tmp/hermes-proto-work/reports`, which `fixtures/make_fixture.py preview-files` writes. Every story of that script deletes `/tmp/hermes-proto-work` first, so run it again, with Hermes's interpreter, after recording any other story.
- The rows of a CSV are in the window, not the page view, so `see`, `inview` and the ARIA snapshot find them. The PDF viewer is in the view and only `shot` sees it.
- The chat pages its thread with PageUp, PageDown and End from anywhere in the window. The rows keep those keys while they have focus.
- A dialog of the window that overlaps the pane, such as the image viewer, draws under the page. Close the pane before you shoot one.
