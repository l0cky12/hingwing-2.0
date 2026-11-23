# Markdown replies

A reply from Hermes is laid out the way Hermes wrote it. Lists, headings, links, block quotes, tables and rules render as structure, not as `#`, `|` and `*` symbols. Prose stays in the reading serif. A table scrolls sideways inside the 66ch measure. A fenced code block shows its language and a **Copy** button on hover or keyboard focus. Copy, named "Copy code", is the same control as [Copy a block](./copy-a-block.md). It puts the block's text on the clipboard and reads "Copied" for two seconds. A link opens in the user's browser through the main process, and the window never navigates.

## Sub-features

- `markdown-blocks` renders a numbered list, a heading, a link, a table and a code block from one reply.
- `markdown-copy` copies a code block with one press, and the button reads "Copied".
- `markdown-keys` shows the language and Copy when the keyboard focuses Copy.
- `markdown-find` finds text in every part of a reply, a table cell included.
- `markdown-streaming` shows a fence that is still open as code from its first line. The prefix test in `apps/desktop/test/markdown.test.tsx` covers this, not a run.

## How to get to it (user POV)

- Run `HIGHWING_FIXTURE=fixtures/markdown.jsonl pnpm --filter @highwing/desktop start` from the repo root, type in the "Message Hermes" box and press Send.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.

- **Blocks and Copy.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown wait live type "Message Hermes" @request click button Send wait settled shot markdown click button "Copy code" see "Copied" copied "cp notes.md notes.md.bak"`. `markdown.aria.txt` holds a `list` with two `listitem` nodes, `heading "Details" [level=2]`, `link "style guide"`, a `table` with three `columnheader` nodes and `code: cp notes.md notes.md.bak`. Then run `grep -nE '#|\||```' /tmp/highwing-verify/markdown/markdown.aria.txt`. It must print nothing.
- **Copied.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-copied wait live type "Message Hermes" @request click button Send wait settled click button "Copy code" see "Copied" shot copied`. The code sheet in `copied.png` shows "sh" and "Copied" in its top-right corner.
- **Find.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-find wait live type "Message Hermes" @request click button Send wait settled press Control+f type "Find in chat" notes.md press Enter see "1 of 6" marks 6 type "Find in chat" yes press Enter see "1 of 1" marks 1 shot find-cell`. Find reaches the request, a list item, a table cell and the code block, and `find-cell.png` marks "yes" in the table.
- **Keyboard.** Run `$H run --fixture fixtures/markdown.jsonl --run markdown-keys wait live type "Message Hermes" @request click button Send wait settled press Shift+Tab press Shift+Tab shot keys`. In `keys.png`, Copy has the focus ring and the corner shows "sh".

## Gotchas

- Never `click` a link in a run. The window's open handler passes a web link to the user's real browser.
- The language and Copy are at opacity 0 until hover or focus, so they are in the ARIA tree at rest. `shot` moves the pointer off the page, so a shot after a hover shows them hidden again. Shoot after "Copied" or with keyboard focus instead.
- A code block at rest looks the same as before this feature. The errand's settled shot is pixel-identical, so `$H compare` against the design C references still holds.
