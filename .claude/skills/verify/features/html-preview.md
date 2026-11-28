# HTML previews in replies

A fenced `html` block in a reply, in any case (`html`, `HTML`, `Html`), shows as a rendered page in a framed preview once its fence closes. While the fence is still open it is a plain code block with the caret in it, so a half-written page never draws. The frame is 280 px tall and as wide as the reading measure, white in both themes, and the page scrolls inside it. The block keeps the code sheet and its corner: the fence's language as written, **Preview** and **Source** toggle buttons, and **Copy**, which copies the source in both views. The source stays in the page, hidden, so Find counts it. The frame is an `iframe` with an empty `sandbox` and the source as its `srcdoc`, so the page runs no script, submits no form, opens no popup and has no origin.

## Sub-features

- `html-preview` draws the save card of `fixtures/html.jsonl` in the frame with **Preview** pressed.
- `html-source` switches to the source with **Source**, copies it there, and switches back with **Preview**.
- `html-script` is the same run: the card's `<script>alert(2)</script>` and its button's `onclick="alert(1)"` run nothing. The run fails on any dialog.
- `html-unit` holds the rules in `packages/thread/test/prose.test.ts` and `apps/desktop/test/markdown.test.tsx`, not a run: only an `html` fence is marked for preview, a closed one renders a sandboxed frame whose `srcdoc` is the source and offers the toggle, and an open one is a plain code block.

## How to get to it (user POV)

- Run `HIGHWING_FIXTURE=$PWD/fixtures/html.jsonl pnpm --filter @highwing/desktop start` from the repo root, type in the "Message Hermes" box and press Send.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.
- `fixtures/html.jsonl` comes from `python3 -I fixtures/make_html_fixture.py`. `--check` fails when the file is not what the script writes.

Set `Q='/^Blocked script execution in .about:srcdoc./'` first, for the reason under Gotchas.

- **Preview and source.** Run `$H run --fixture fixtures/html.jsonl --theme light --run html-preview wait live type "Message Hermes" @request click button Send wait settled see "The button keeps the page" pressed button /^Preview$/ true shot html-preview click button Source pressed button /^Source$/ true see "Unsaved changes</h3>" shot html-source click button "Copy code" see Copied click button Preview pressed button /^Preview$/ true quiet-except "$Q"`. `html-preview.png` shows the card with its blue "Save changes" button inside a white frame. `html-preview.aria.txt` holds `iframe`, `button "Preview" [pressed]` and `button "Source"`. `html-source.png` shows the source in a code sheet. Run it again with `--theme dark` for the dark palette, where the frame stays white.

## Gotchas

- Chromium logs "Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed" for each `<script>` in a preview, once per time the frame loads. That is the sandbox working, so the recipes use `quiet-except` rather than `quiet`. Any other console error still fails them.
- The page inside the frame is not in the ARIA tree or Playwright's text locators of the window, so `see` cannot find its words. Check the shot.
- The toggle and Copy are at opacity 0 until hover or keyboard focus, like a code block's Copy. They are in the ARIA tree at rest.
