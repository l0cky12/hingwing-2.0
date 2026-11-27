# Top bar

The bar across the top of the chat names the chat, and the bot's pill opens its details. At its right end is New chat, or a group's member faces. The bar stays one row at any width of the chat column, so its bottom edge lines up with the header of the pane beside it. When the chat's name does not fit, as in a 420 px window, beside a page open full window or beside the computer view, it is cut short with an ellipsis and New chat keeps its size.

## Sub-features

- `top-bar-narrow` keeps the bar one row in a 420 px window.
- `top-bar-long` keeps the bar one row in a 420 px chat column after the chat is renamed to a name too long for it.
- `top-bar-group` keeps a group's bar one row, with its member faces, in a 420 px chat column.
- `top-bar-page` keeps the bar one row in the 400 px chat beside a page open full window.
- `top-bar-computer` keeps the bar one row in the chat beside the computer view.
- `top-bar-pill-focus` draws the whole focus ring of the bot's pill in the bar, which clips its own overflow.

## How to get to it (user POV)

- Narrow the window, give a chat a long name, open a page full window from its card, or open the bot's screen.

## Driving it with highwing-verify

Preconditions:

- `same-row button "Details for Research" button "New chat"` fails while the bar has wrapped, since New chat drops to a second row under a long name.
- `flush ".top>.bar" <css>` fails when the bar is taller or shorter than the header beside it, even by one pixel. The page and the computer view draw their header as `.preview-head`, the Chats column as `.chats-head` and the Bots column as `.bots-head`.
- `ring button "Details for Emu"` fails when the bar's heading clips the pill's focus ring, which is drawn 4 px outside the pill.
- The page recipe needs `/tmp/hermes-proto-work/site/index.html`, as [Preview pane](./preview.md) says.

- **Narrow window.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --size 420x800 --run top-bar-narrow wait live same-row button "Details for Emu" button "New chat" shot narrow`. `narrow.aria.txt` holds `banner` with `button "Details for Emu"` and `button "New chat"`.
- **Long name.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/chats.json --mode chats --chat-only --size 420x800 --run top-bar-long wait live wait bots click button "/^Bot: /" click menuitemradio Research inview button "Bot: Research" click button "Sort the invoices" said "Sorted fourteen invoices by due date" click button "More for Sort the invoices" press ArrowDown press ArrowDown focused menuitem "Rename…" press Enter type "Chat name" "Sort every overdue invoice by due date and send the reminders before Friday" press Enter count heading "Hermes Research · Sort every overdue invoice by due date and send the reminders before Friday" 1 same-row button "Details for Research" button "New chat" inview button "New chat" flush ".top>.bar" .chats-head shot long`. `long.png` shows the name cut short with an ellipsis before New chat, and the heading keeps the whole name.
- **Group.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/launch-group.json --no-bot-chat --mode bots --chat-only --size 420x800 --run top-bar-group wait window wait bots click button "Launch plan, group chat with Ada, Sam and Juno" count heading "Hermes Launch plan" 1 flush ".top>.bar" .bots-head shot group`. `group.png` shows the group's name and its member faces on one row.
- **Beside a page.** Run `$H run --fixture fixtures/preview.jsonl --serve fixtures/preview --run top-bar-page wait live type "Message Hermes" @request click button Send wait settled click button "Close preview" gone region Preview click button "Open Demo page" wait preview page-says "Preview works" flush ".top>.bar" .preview-head shot page`. `page.png` shows the bar and the page's header ending on one line.
- **Beside the computer view.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --display fixtures/display/running.json --run top-bar-computer wait live wait bots click button "Open screen" see "Hermes has control" same-row button "Details for Emu" button "New chat" flush ".top>.bar" .preview-head shot computer`. `computer.png` shows the bar with the bot's pill and the Screen header ending on one line.
- **Focused pill.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run top-bar-pill-focus wait live wait bots click button "Details for Emu" tally dialog 1 press Escape gone dialog Emu focused button "Details for Emu" ring button "Details for Emu" shot pill-focus`. `pill-focus.png` shows the ring all the way round the pill.
