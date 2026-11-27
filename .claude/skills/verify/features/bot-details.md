# Bot details

A bot's chat shows the bot in the top bar's heading as a pill with its face and name, between "Hermes" and the chat's title. The pill is a button named `Details for <bot>`, so the heading's name stays `Hermes <bot> · <chat>`. A click, Enter or Space on it opens the details panel. Ctrl+Alt+B opens it too, or Cmd+Shift+I on macOS, while the bar is shown and no other dialog is open. A group chat, and a chat whose bot the roster does not list, show the heading as plain text with no pill.

The panel is the Edit… dialog of [Edit a bot](./edit-a-bot.md) drawn as a sheet at the window's right edge: the same `profiles.describe` read, the same fields, the same checks and the same refusals in words. Escape or Cancel closes it and gives focus back to whatever had it. When Hermes refuses `profiles.describe`, the panel names the bot and shows Hermes's words with a Close button. The panel has a tab row that is drawn only once it holds more than one tab, so today it draws none.

## Sub-features

- `bot-details-open` shows the pill, opens the panel by click, Enter, Space and the shortcut, renames the bot, and the sidebar row and the pill show the new name over the same chat.
- `bot-details-picture` uploads a picture from the panel, and the sidebar row draws it.
- `bot-details-clash` shows a rename made elsewhere in the panel and reloads its fields.
- `bot-details-asset-refused` shows Hermes's words when it cannot keep the picture.

## How to get to it (user POV)

- Open a bot's chat, then click the bot's name in the top bar.
- Or press Ctrl+Alt+B (Cmd+Shift+I on macOS) in a bot's chat.

## Driving it with highwing-verify

Preconditions are those of [Edit a bot](./edit-a-bot.md): `--profiles fixtures/profiles/rae.json`, and `--pick-file` for Upload picture.

- **Open and rename.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --run bot-details-open wait live wait bots click button Rae current button Rae said "The weekly report is ready" count heading "Hermes Rae · Bot Chat" 1 shot pill click button "Details for Rae" see "Upload picture" count dialog Rae 1 value Name Rae value Description "Writes the weekly report" value Persona "You write short, plain reports for the team." count tablist "/.*/" 0 shot panel press Escape gone dialog Rae focused button "Details for Rae" press Enter see "Upload picture" count dialog Rae 1 press Escape gone dialog Rae press Space see "Upload picture" count dialog Rae 1 type Name Raelyn click button Save gone dialog Rae current button Raelyn count button Rae 0 count button "Details for Raelyn" 1 count heading "Hermes Raelyn · Bot Chat" 1 said "The weekly report is ready" shot renamed press Control+Alt+b see "Upload picture" count dialog Raelyn 1 press Escape gone dialog Raelyn press Control+b count dialog Raelyn 0 called profiles.configure '{"name":"rae","ui_meta":{"hermes-bots":{"title":"Raelyn"}}}' 1 called profiles.describe '{"name":"rae"}' 4 quiet`. `pill.aria.txt` holds `heading "Hermes Rae · Bot Chat"` with `button "Details for Rae": Rae` in it. `panel.png` shows the sheet at the right edge. `renamed.png` shows Raelyn in the sidebar row and the pill.
- **Picture.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --pick-file fixtures/pictures/rae.png --run bot-details-picture wait live wait bots click button Rae avatar Rae letter press Control+Alt+b see "Upload picture" click button "Upload picture" reached profiles.set_asset '{"name":"rae","asset":"avatar"}' 1 avatar Rae picture count button "Remove picture" 1 shot panel-picture press Escape gone dialog Rae quiet`.
- **Clash.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --configure-clash Robin --run bot-details-clash wait live wait bots click button Rae said "The weekly report is ready" click button "Details for Rae" see "Upload picture" type Name Ray click button Save see "This bot changed elsewhere." count dialog Robin 1 value Name Robin count alert "" 1 shot panel-clash quiet`.
- **Picture refused.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --pick-file fixtures/pictures/rae.png --asset-fails "[Errno 28] No space left on device" --run bot-details-asset-refused wait live wait bots click button Rae said "The weekly report is ready" click button "Details for Rae" see "Upload picture" click button "Upload picture" see "No space left on device" count alert "" 1 shot panel-asset-refused quiet`.

## Gotchas

- `--bound` launches into a chat with no bot, so it shows no pill, and a refused `profiles.describe` cannot be reached from the window. `apps/desktop/test/bot-panel.test.tsx` covers the refused panel.
- The pill is named `Details for <bot>`, so `button <bot>` still finds the sidebar row alone.
