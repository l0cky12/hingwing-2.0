# Markdown replies

A reply from Hermes is laid out the way Hermes wrote it. Lists, headings, links, block quotes, tables and rules render as structure, not as `#`, `|` and `*` symbols. Prose stays in the one sans family. A table scrolls sideways inside the 66ch measure. A fenced code block shows its language and a **Copy** button on hover or keyboard focus. Copy, named "Copy code", is the same control as [Copy a block](./copy-a-block.md). It puts the block's text on the clipboard and reads "Copied" for two seconds. A link opens in the user's browser through the main process, and the window never navigates.

A code block in a language Highwing knows is colored for keywords, strings, comments, numbers and names once its fence closes. The colors come from highlight.js grammars that ship in the app bundle, so they need no network. A block stays plain while its fence is open, when its language is missing or unknown, and when it is longer than 100,000 characters. The colors arrive without moving the layout. Copy still copies the plain text, and Find still marks words inside a colored block. Under forced colors the text draws in one system color.

## Sub-features

- `markdown-blocks` renders a numbered list, a heading, a link, a table and two code blocks from one reply.
- `markdown-copy` copies a code block with one press, and the button reads "Copied".
- `markdown-keys` shows the language and Copy when the keyboard focuses Copy.
- `markdown-find` finds text in every part of a reply, a table cell and a colored code block included.
- `markdown-streaming` shows a fence that is still open as code from its first line. The prefix test in `apps/desktop/test/markdown.test.tsx` covers this, not a run.
- `markdown-highlight` colors a closed `sh` or `ts` block, keeps an open fence plain, and colors in without a jump.

## How to get to it (user POV)

- Run `HIGHWING_FIXTURE=fixtures/markdown.jsonl pnpm --filter @highwing/desktop start` from the repo root, type in the "Message Hermes" box and press Send.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.

The reply holds two code blocks: an `sh` block, then a `ts` block. `click-at button "Copy code" 1` is the `sh` block's Copy and `click-at button "Copy code" 2` is the `ts` block's.

- **Blocks and Copy.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown wait live type "Message Hermes" @request click button Send wait settled shot markdown click-at button "Copy code" 1 see "Copied" copied "cp notes.md notes.md.bak"`. `markdown.aria.txt` holds a `list` with two `listitem` nodes, `heading "Details" [level=2]`, `link "style guide"`, a `table` with three `columnheader` nodes, `code: cp notes.md notes.md.bak` and a second `code` that starts `// Keep each backup for a week.`. Then run `grep -nE '#|\||```' /tmp/highwing-verify/markdown/markdown.aria.txt`. It must print nothing.
- **Copied.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-copied wait live type "Message Hermes" @request click button Send wait settled click-at button "Copy code" 1 see "Copied" shot copied`. The code sheet in `copied.png` shows "sh" and "Copied" in its top-right corner.
- **Find.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-find wait live type "Message Hermes" @request click button Send wait settled press Control+f type "Find in chat" notes.md press Enter see "1 of 6" marks 6 type "Find in chat" yes press Enter see "1 of 1" marks 1 shot find-cell`. Find reaches the request, a list item, a table cell and the code block, and `find-cell.png` marks "yes" in the table.
- **Keyboard.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-keys wait live type "Message Hermes" @request click button Send wait settled focused textbox "Message Hermes" press Shift+Tab press Shift+Tab press Shift+Tab press Shift+Tab press Shift+Tab focused button "Copy code" shot keys`. Focus is in the message box once the turn ends, as [Send a message](./send-a-message.md) says. The five presses pass Attach files, React, Regenerate and the reply's Copy. In `keys.png`, the `ts` block's Copy has the focus ring and the corner shows "ts".
- **Colors.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-hues wait live type "Message Hermes" @request click button Send wait settled hues 6 shot highlight quiet`. The `ts` block draws its text in six colors: plain ink, comment, keyword, number, name and string. `highlight.png` shows the `cp` of the `sh` block colored too.
- **Copy a colored block.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-copy-ts wait live type "Message Hermes" @request click button Send wait settled click-at button "Copy code" 2 see "Copied" copied $'// Keep each backup for a week.\nconst days: number = 7\nfunction backupName(file: string): string {\n  return file + ".bak"\n}'`. The `$'...'` quoting is bash's, so `\n` is a newline. The clipboard holds the source with no markup.
- **Find in a colored block.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-find-ts wait live type "Message Hermes" @request click button Send wait settled hues 6 press Control+f type "Find in chat" "days: number" press Enter see "1 of 1" marks 1 shot find-code`. The match spans three colored tokens and is one mark. `find-code.png` marks "days: number" in the `ts` block.
- **Streaming.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-steady wait live type "Message Hermes" @request click button Send steady ts wait settled quiet`. `steady` must follow Send, before the block streams. `steps.log` logs how many times it sampled the block, and the block's and the thread's heights just before and just after the colors arrived. They match.
- **Forced colors.** Run `$H run --fixture fixtures/markdown.jsonl --forced-colors --run markdown-forced wait live type "Message Hermes" @request click button Send wait settled hues 1 shot forced`. The `ts` block draws in one system color.
- **Offline.** Run `unshare -rn sh -c "ip link set lo up && $H run --fixture fixtures/markdown.jsonl --run markdown-offline wait live type 'Message Hermes' @request click button Send wait settled hues 6 quiet"`. The namespace has only the loopback link, so nothing outside the machine is reachable, and the `ts` block still draws in six colors. Playwright reaches Electron over loopback, so the run fails to launch unless `lo` is up.

## Gotchas

- A press on a web link opens a menu with Preview and Open in browser. Open in browser goes to `opens.jsonl` in a run, never to the user's browser. See [Preview pane](./preview.md).
- The language and Copy are at opacity 0 until hover or focus, so they are in the ARIA tree at rest. `shot` moves the pointer off the page, so a shot after a hover shows them hidden again. Shoot after "Copied" or with keyboard focus instead.
- `click button "Copy code"` fails in strict mode, because the reply has two. Use `click-at`.
- `hues` reads the last code block in the thread. `steady` reads the last one labelled with its language. A frame sampler would miss the closed, still plain block, because the grammar often loads inside one frame, so `steady` samples after every change to the page.
- The errand's reply ends in a `markdown` block, so its settled shot shows the heading and list marks colored. The design C references show that block plain, so `$H compare` differs there.
- The colors only change `color`. A token rule that sets a weight, style, size or background would reflow the block, and `steady` fails.
