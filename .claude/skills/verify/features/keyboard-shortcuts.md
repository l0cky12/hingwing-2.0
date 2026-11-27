# Keyboard shortcuts

Every common action has a shortcut, and Ctrl+/ (Cmd+/ on a Mac) opens a "Keyboard shortcuts" sheet that lists them in three groups: Go to, Chat and Window. One table in `apps/desktop/src/renderer/shortcuts.ts` drives both the handlers and the sheet. Ctrl+1 to Ctrl+9 open the Nth bot in sidebar order: the default bot's card, Pinned, then each section, without hidden bots. Alt+Up and Alt+Down open the bot before or after the open one and stop at either end. Ctrl+Tab and Ctrl+Shift+Tab do the same and wrap, and they stay on Ctrl on a Mac. Ctrl+[ and Ctrl+] go back and forward through the bots and chats this window opened. Ctrl+I focuses the message box. Ctrl+L quotes the text selected in the thread into the message box, or just focuses it when nothing there is selected. Ctrl+Shift+N opens New group chat in bot mode, while the plus menu's row can be used. Ctrl+, opens Settings. Ctrl+Shift+M opens Connect apps, as [Connect apps](./connect-apps.md) covers. Ctrl+=, Ctrl+- and Ctrl+0 zoom in, zoom out and reset by half a zoom level. Ctrl+K, Ctrl+N, Ctrl+F, Ctrl+B, Ctrl+, and Ctrl+Shift+M keep their own handlers. No shortcut acts while a dialog is open. Escape closes the sheet, and so do Ctrl+/ and a click outside it, and focus goes back to where it was. Settings' Keyboard shortcuts card holds a Show all button that opens the same sheet. Ctrl+B compacts the bots sidebar in bot mode, as [Compact sidebar](./compact-sidebar.md) covers.

## Sub-features

- `keys-bots` opens bots with Ctrl+digit, Alt+Up and Alt+Down, Ctrl+Tab and Ctrl+Shift+Tab, and does nothing for a digit with no bot.
- `keys-history` goes back and forward with Ctrl+[ and Ctrl+].
- `keys-composer` focuses the message box with Ctrl+I, and quotes a selection with Ctrl+L, which Ctrl+Z takes back.
- `keys-sheet` opens the sheet with Ctrl+/, holds every other shortcut while it is open, and closes on Escape with focus back.
- `keys-group` opens New group chat with Ctrl+Shift+N, and Ctrl+N does nothing while that dialog is open.
- `keys-settings` opens Settings with Ctrl+, and opens the sheet from its Show all button.
- `keys-zoom` zooms in and out by half a level and back to actual size.

## How to get to it (user POV)

- Press the keys anywhere in the chat window. Ctrl+/ lists them all.
- In Settings, press Show all under Keyboard shortcuts.

## Driving it with highwing-verify

Preconditions:

- `fixtures/profiles/roster.json` lists, in sidebar order, Emu (the default bot's card), dr eggbot, Research, Timothy · CEO, Hermes and highwing. dr eggbot's Bot Chat holds the reply "the SOUL.md is the same thi".

- **Bots, history, message box and sheet.** Run `$H run --run keys --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json wait window wait live wait bots press Control+2 current button "dr eggbot" press Alt+ArrowDown current button Research press "Control+[" current button "dr eggbot" press "Control+[" current button "Emu, default bot" press "Control+]" current button "dr eggbot" press Control+Tab current button Research press Control+Shift+Tab current button "dr eggbot" press Alt+ArrowUp current button "Emu, default bot" press Control+Shift+Tab current button highwing press Control+9 pause 300 current button highwing press Control+i focused textbox "Message Hermes" press Control+/ see "Keyboard shortcuts" shot sheet press Control+2 pause 400 current button highwing press Escape gone dialog "Keyboard shortcuts" focused textbox "Message Hermes" quiet`. `sheet.png` shows the three groups.
- **Quote a selection.** Run `$H run --run keys-quote --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json wait window wait live wait bots press Control+2 current button "dr eggbot" said "the SOUL.md is the same thi" select-words "the SOUL.md is the same thi" press Control+l focused textbox "Message Hermes" value "Message Hermes" $'> the SOUL.md is the same thi\n\n' press Control+z value "Message Hermes" "" quiet`. The `$'…'` quoting is bash's, for the two newlines.
- **Group chat.** Run `$H run --run keys-group --fixture fixtures/errand.jsonl --profiles fixtures/profiles/launch.json --no-bot-chat --mode bots wait window wait bots press Control+Shift+N count dialog "New group chat" 1 press Control+n pause 300 count dialog "New group chat" 1 press Escape gone dialog "New group chat" quiet`.
- **Settings.** Run `$H run --run keys-settings --fake-host ok --saved remote wait window wait live press Control+, wait settings reveal heading "Keyboard shortcuts" shot settings click button "Show all" see "Next bot, wrapping" press Escape gone dialog "Keyboard shortcuts" focused button "Show all" quiet`.
- **Zoom.** Run `$H run --run keys-zoom --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json wait window wait live press Control+- press Control+= press Control+= press Control+0 pause 300 shot reset quiet`. It passes only if Ctrl+0 brings the page back to 1180x860. A `shot` right after one Ctrl+= fails with `is 1077x785`, and after one Ctrl+- with `is 1292x942`, which is the zoom itself.

## Gotchas

- `shot` checks the page's size in CSS pixels, so it fails at any zoom but actual size. Reset with Ctrl+0 before a shot.
- A fixture run has no Settings, so Ctrl+, needs `--fake-host`, whose Hermes cannot list bots.
- Chat mode has no New group chat, so Ctrl+Shift+N does nothing there.
