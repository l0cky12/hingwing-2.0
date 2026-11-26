# Delete a bot

Each bot's menu in the Bots column has Delete… last, in a group of its own, after Pin to top or Unpin and Hide from list on a normal or a pinned row, or after Show in list on a hidden row. The default bot's card has none. [The bot menu](./bot-menu.md) says how to open it. Delete… opens a dialog, "Delete Editor?", that says Hermes removes the bot, its chats and its settings and can't bring them back. Cancel has focus, so Enter does not delete. Cancel and Escape close the dialog and give focus back to the row. Hermes deletes a profile only on its own machine, with `hermes profile delete` (hermes_cli/profiles.py), and its gateway has no call for it, so Delete in the dialog deletes nothing and sends nothing. It closes the dialog, gives focus back to the row, and says in the column's alert line "This Hermes can't delete bots from Highwing. To delete Editor, run hermes profile delete editor on the Hermes machine.", with the bot's name and id. Hermes never deletes its default profile, so on the default bot's row under Hidden, Delete… opens no dialog and says "The default bot can't be deleted." instead.

## Sub-features

- `delete-refused` offers Delete… on a normal, a pinned and a hidden row, confirms it on a normal row and gets the refusal with the row kept and focused, refuses it on the hidden default bot with no dialog, and leaves Delete… off the default bot's card.
- `delete-cancel` closes the dialog with Escape and with Cancel, each giving focus back to the row with no alert.

## How to get to it (user POV)

- Right-click a bot in the Bots column, or press ⋯ at its right end, and choose Delete….
- Or give a bot row focus with Tab, press Shift+F10, and choose Delete… with the arrows.
- Press Delete in the dialog to confirm, or Cancel or Escape to keep the bot.

## Driving it with highwing-verify

Preconditions:

- `--profiles fixtures/profiles/marks.json` holds Editor in Writing, Researcher pinned, and the default bot Hermes hidden, so its row is under Hidden at launch.
- `called` counts the calls of the whole run when the run ends, so the one `profiles.configure` the run makes is Show in list for Hermes, and none names Editor. `gateway-calls.jsonl` holds no `profiles.delete` either, since no such method exists.

Recipes:

- **Refused.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/marks.json --run delete-refused wait window wait live wait bots right-click button Editor count menuitem Delete… 1 shot delete-menu click menuitem Delete… see "Delete Editor?" focused button Cancel shot delete-confirm click button Delete gone dialog "Delete Editor?" see "This Hermes can't delete bots from Highwing. To delete Editor, run hermes profile delete editor on the Hermes machine." focused button Editor count button Editor 1 shot delete-refused click button "More for Researcher" count menuitem Delete… 1 press Escape right-click button Hermes count menuitem Delete… 1 click menuitem Delete… absent "Delete Hermes?" see "The default bot can't be deleted." focused button Hermes shot delete-default-refused right-click button Hermes click menuitem "Show in list" see "Hermes is back in the list." focused button "Hermes, default bot" press Shift+F10 count menuitem "Hide from list" 1 count menuitem Delete… 0 shot delete-card-menu native-menus 0 called profiles.configure '{"name":"editor"}' 0 called profiles.configure '{}' 1 quiet`. `delete-menu.png` shows Delete… under a separator at the end of Editor's menu. `delete-confirm.png` shows the dialog over the window with Cancel focused. `delete-refused.png` shows Editor still in Writing and the words in the alert line. `delete-card-menu.png` shows the card's menu ending at Hide from list.
- **Cancel.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/marks.json --run delete-cancel wait window wait live wait bots right-click button Copywriter click menuitem Delete… see "Delete Copywriter?" press Escape gone dialog "Delete Copywriter?" focused button Copywriter absent "This Hermes can't delete bots from Highwing." click button "More for Copywriter" click menuitem Delete… see "Delete Copywriter?" click button Cancel gone dialog "Delete Copywriter?" focused button Copywriter count button Copywriter 1 shot delete-cancelled native-menus 0 quiet`.
- **Recording.** Add `--video` to the Refused recipe to save `video.webm` of it.

## Gotchas

- The dialog's accessible name is its heading, so `gone dialog "Delete Editor?"` names the bot. `gone dialog Editor` would not match.
- The dialog's button is `Delete` and the menu item is `Delete…`, so `click button Delete` never hits the menu.
- The refusal is Highwing's own words, not a reply from Hermes. A Hermes that gains a delete call over the gateway needs a command in `packages/hermes`, wired at the dialog's confirm in Bots.tsx, and the refusal in the Refused recipe becomes the bot leaving the list.
