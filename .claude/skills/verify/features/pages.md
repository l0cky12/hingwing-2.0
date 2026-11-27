# Pages

A page is a document the bot built and showed, such as a report or a dashboard. Hermes has no Pages of its own, so Highwing reads a finished `desktop_preview` open of a file as one. A web address it opens stays a step. The thread shows a card in place of that step, titled by Hermes's label or else the file's name, with the file's name under it and **Open**. Open fills the window with the page and keeps the chat as a panel on its left, with no bots or chats column. The pane's close button, "Close preview", returns to the chat. A page opens only when a finished step of the chat wrote its file, as **Preview** beside a path does, and only from a Hermes on this computer.

## Sub-features

- `page-card` shows the card with the label, the file's name and **Open**, in place of the `desktop_preview` step.
- `page-full` opens the page full window with the chat beside it.
- `page-close` returns to the chat from the full page.
- `page-narrow` covers the chat under 900 px of width, with **Back to chat**, as the preview pane does.
- `page-relaunch` still opens after Highwing restarts, when the chat comes back from Hermes's stored rows. A stored step keeps no diff, so main takes the file in the `write_file` result's `files_modified` as the proof that the chat wrote it.
- `page-refused` says "Highwing couldn't open this page." under the card when no step of the chat wrote the file.

## How to get to it (user POV)

- Ask Hermes to build a page and show it. The card shows in the reply, and Hermes also opens the page beside the chat.
- Press **Open** on the card.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.
- `/tmp/hermes-proto-work/pages/report.html` exists. `fixtures/make_fixture.py page` writes it, or copy `fixtures/page/report.html` there.
- `PRE` is `wait live type "Message Hermes" @request click button Send wait settled said "Tuesday was the busiest day" click button "Close preview" gone region Preview`. Hermes opens the page beside the chat during the turn, so `PRE` closes it.

- **The card.** Run `$H run --fixture fixtures/page.jsonl --run page-card PRE count button "Open Weekly sign-ups" 1 shot card`. `card.aria.txt` holds `article "Weekly sign-ups"` with `heading "Weekly sign-ups"`, `report.html` and `button "Open Weekly sign-ups"`, after the step "Created report.html".
- **Full window, then Close.** Run `$H run --fixture fixtures/page.jsonl --run page-full PRE click button "Open Weekly sign-ups" wait preview previewing "/report\.html$/" page-says "Weekly sign-ups" nothing-opened shot full click button "Close preview" gone region Preview wait live shot closed`. `full.png` shows the chat as a panel on the left and the page filling the rest, with no Bots column. `closed.png` shows the window as it was before Open.
- **Narrow.** Run `$H run --fixture fixtures/page.jsonl --size 860x860 --run page-narrow wait live type "Message Hermes" @request click button Send wait preview click button "Back to chat" gone region Preview wait settled click button "Open Weekly sign-ups" wait preview previewing "/report\.html$/" shot narrow click button "Back to chat" gone region Preview wait live`. Under 900 px the pane covers the chat, so the recipe waits for `preview` before `settled`.
- **After a restart.** Run `$H run --fake-host ok --saved local --fixture fixtures/page.jsonl --run page-relaunch PRE relaunch wait live said "Tuesday was the busiest day" click button "Open Weekly sign-ups" wait preview previewing "/report\.html$/" page-says "Weekly sign-ups"`. The fake machine's gateway outlives the `relaunch`, so the chat comes back from its stored rows, and `--saved local` makes it this computer.

## Gotchas

- The page is drawn by main over the window, so `see` and the ARIA snapshot never find its text. Use `page-says` and `shot`.
- Every story of `fixtures/make_fixture.py` deletes `/tmp/hermes-proto-work` first. Run `page` again after recording any other story.
- A fixture run is a local connection. With a remote Hermes the card has no **Open**, and main refuses the page as it refuses a remote path's Open (`apps/desktop/test/page-card.test.tsx`, `apps/desktop/test/ipc.test.ts`). The page Hermes opens itself shows "This file is on <machine>." in the pane, which `apps/desktop/test/preview-page.test.ts` covers. `--fake-host ok --saved remote --fixture fixtures/page.jsonl` shows both.
