# Markdown replies

A reply from Hermes is laid out the way Hermes wrote it. Lists, headings, links, block quotes, tables and rules render as structure, not as `#`, `|` and `*` symbols. Prose stays in the one sans family. A table scrolls sideways inside the 66ch measure. A fenced code block has a header row over its code, with its language on the left and a **Copy** icon on the right. Both always show. Copy, named "Copy code", puts the block's text on the clipboard and shows a check and "Copied" for two seconds, as the reply's own Copy does. A link opens in the user's browser through the main process, and the window never navigates.

A code block in a language Highwing knows is colored for keywords, strings, comments, numbers and names once its fence closes. The colors come from highlight.js grammars that ship in the app bundle, so they need no network. A block stays plain while its fence is open, when its language is missing or unknown, and when it is longer than 100,000 characters. The colors arrive without moving the layout. Copy still copies the plain text, and Find still marks words inside a colored block. Under forced colors the text draws in one system color.

## Sub-features

- `markdown-blocks` renders a numbered list, a heading, a link, a table and two code blocks from one reply.
- `markdown-copy` copies a code block with one press, and the button reads "Copied".
- `markdown-keys` reaches a code block's Copy with the keyboard.
- `markdown-find` finds text in every part of a reply, a table cell and a colored code block included.
- `markdown-streaming` shows a fence that is still open as code from its first line. The prefix test in `apps/desktop/test/markdown.test.tsx` covers this, not a run.
- `markdown-highlight` colors a closed `sh` or `ts` block, keeps an open fence plain, and colors in without a jump.
- `markdown-setext` reads a line over `---` or `===` as a heading, ends a list at a rule between its bullets, and keeps a link whose label is bold as one link to its own address.

## How to get to it (user POV)

- Run `HIGHWING_FIXTURE=$PWD/fixtures/markdown.jsonl pnpm --filter @highwing/desktop start` from the repo root, type in the "Message Hermes" box and press Send.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.

The reply holds two code blocks: an `sh` block, then a `ts` block. `click-at button "Copy code" 1` is the `sh` block's Copy and `click-at button "Copy code" 2` is the `ts` block's.

- **Blocks and Copy.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown wait live type "Message Hermes" @request click button Send wait settled shot markdown click-at button "Copy code" 1 see "Copied" copied "cp notes.md notes.md.bak"`. `markdown.aria.txt` holds a `list` with two `listitem` nodes, `heading "Details" [level=2]`, `link "style guide"`, a `table` with three `columnheader` nodes, `code: cp notes.md notes.md.bak` and a second `code` that starts `// Keep each backup for a week.`. Then run `grep -nE '#|\||```' /tmp/highwing-verify/markdown/markdown.aria.txt`. It must print nothing.
- **Copied.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-copied wait live type "Message Hermes" @request click button Send wait settled click-at button "Copy code" 1 see "Copied" shot copied`. The `sh` sheet's header row in `copied.png` shows "sh" on the left and a check with "Copied" on the right.
- **Find.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-find wait live type "Message Hermes" @request click button Send wait settled press Control+f type "Find in chat" notes.md press Enter see "1 of 6" marks 6 type "Find in chat" yes press Enter see "1 of 1" marks 1 shot find-cell`. Find reaches the request, a list item, a table cell and the code block, and `find-cell.png` marks "yes" in the table.
- **Keyboard.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-keys wait live type "Message Hermes" @request click button Send wait settled focused textbox "Message Hermes" press Shift+Tab press Shift+Tab press Shift+Tab press Shift+Tab press Shift+Tab focused button "Copy code" shot keys`. Focus is in the message box once the turn ends, as [Send a message](./send-a-message.md) says. The five presses pass React, Regenerate, Reply and the reply's Copy. Attach files sits after the message box, in its toolbar. In `keys.png`, the `ts` block's Copy has the focus ring and its header row shows "ts".
- **Colors.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-hues wait live type "Message Hermes" @request click button Send wait settled hues 6 shot highlight quiet`. The `ts` block draws its text in six colors: plain ink, comment, keyword, number, name and string. `highlight.png` shows the `cp` of the `sh` block colored too.
- **Copy a colored block.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-copy-ts wait live type "Message Hermes" @request click button Send wait settled click-at button "Copy code" 2 see "Copied" copied $'// Keep each backup for a week.\nconst days: number = 7\nfunction backupName(file: string): string {\n  return file + ".bak"\n}'`. The `$'...'` quoting is bash's, so `\n` is a newline. The clipboard holds the source with no markup.
- **Find in a colored block.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-find-ts wait live type "Message Hermes" @request click button Send wait settled hues 6 press Control+f type "Find in chat" "days: number" press Enter see "1 of 1" marks 1 shot find-code`. The match spans three colored tokens and is one mark. `find-code.png` marks "days: number" in the `ts` block.
- **Streaming.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-steady wait live type "Message Hermes" @request click button Send steady ts wait settled quiet`. `steady` must follow Send, before the block streams. `steps.log` logs how many times it sampled the block, and the block's and the thread's heights just before and just after the colors arrived. They match.
- **Forced colors.** Run `$H run --fixture fixtures/markdown.jsonl --forced-colors --run markdown-forced wait live type "Message Hermes" @request click button Send wait settled hues 1 shot forced`. The `ts` block draws in one system color.
- **Offline.** Run `unshare -rn sh -c "ip link set lo up && $H run --fixture fixtures/markdown.jsonl --run markdown-offline wait live type 'Message Hermes' @request click button Send wait settled hues 6 quiet"`. The namespace has only the loopback link, so nothing outside the machine is reachable, and the `ts` block still draws in six colors. Playwright reaches Electron over loopback, so the run fails to launch unless `lo` is up.
- **Dashed headings, rules and link labels.** The echo bot of `roster.json` answers a message as `<profile>: <text>`, so a typed reply is drawn as Markdown. Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run md-setext wait live wait bots click button "dr eggbot" type "Message Hermes" $'Next steps\n----------\n- one\n- - -\n- two\n\n[**https://example.org**](https://example.com)' click button Send said "dr-eggbot: Next steps" count heading "dr-eggbot: Next steps" 1 shot setext click link "https://example.org" click button "Open in browser" opened browse https://example.com quiet`. `setext.aria.txt` holds the level-2 heading, a list of "one", a `separator`, a list of "two", and one `link "https://example.org"` to `https://example.com` holding a `strong`.

## Gotchas

- A press on a web link opens a menu with Preview and Open in browser. Open in browser goes to `opens.jsonl` in a run, never to the user's browser. See [Preview pane](./preview.md).
- The header row sits above the code, so Copy never covers a line of code, and a shot at rest shows the language and Copy.
- `click button "Copy code"` fails in strict mode, because the reply has two. Use `click-at`.
- `hues` reads the last code block in the thread. `steady` reads the last one labelled with its language. A frame sampler would miss the closed, still plain block, because the grammar often loads inside one frame, so `steady` samples after every change to the page.
- The errand's reply ends in a `markdown` block, so its settled shot shows the heading and list marks colored. The design C references show that block plain, so `$H compare` differs there.
- The colors only change `color`. A token rule that sets a weight, style, size or background would reflow the block, and `steady` fails.
