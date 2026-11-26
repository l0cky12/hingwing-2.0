# Delete a bot

Each bot in the Bots column except the default bot has Delete… as the last item of its menu, after Pin to top or Unpin and Hide from list, or after Show in list for a hidden bot. The default bot is Hermes's launch profile, so its card has no Delete…, and neither does its row under Hidden. Delete… opens a dialog, "Delete Editor?", that says Hermes removes the bot, its chats and its settings and can't bring them back. Cancel has focus, so Enter does not delete. Cancel and Escape close the dialog and give focus back to the row. Delete closes the dialog and the column's alert line says "This Hermes can't delete bots from Highwing.", because Hermes has no gateway method to delete a profile (`hermes profile delete` runs only on the Hermes machine), and the bot stays. Nothing is sent to Hermes.

## Sub-features

- `delete-refused` opens Delete… from a right-click, confirms it, and gets the refusal with the bot still listed and focused, with no call to Hermes.
- `delete-cancel` closes the dialog with Escape and with Cancel, each giving focus back to the row with no alert, and shows that the hidden default bot's menu has no Delete….

## How to get to it (user POV)

- Right-click a bot in the Bots column, or point at it and press ⋯ at its right end, and pick Delete….
- Press Delete in the dialog to confirm, or Cancel or Escape to keep the bot.

## Driving it with highwing-verify

Preconditions:

- `--profiles fixtures/profiles/marks.json` lists twenty bots. The default bot Hermes is hidden and is the open bot at launch, so Hidden opens with it inside.
- `called profiles.configure '{}' 0` proves the confirmed delete wrote nothing. `gateway-calls.jsonl` holds no `profiles.delete` either, since no such method exists.

Recipes:

- **Refused.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/marks.json --video --run delete-refused wait window wait live wait bots right-click button Editor count menu "More for Editor" 1 count menuitem "Delete…" 1 shot menu-delete click menuitem "Delete…" see "Delete Editor?" focused button Cancel shot delete-confirm click button Delete gone dialog "Delete Editor?" see "This Hermes can't delete bots from Highwing." count button Editor 1 focused button Editor shot delete-refused called profiles.configure '{}' 0 native-menus 0 quiet`. `menu-delete.png` shows Delete… last in Editor's menu. `delete-confirm.png` shows the dialog over the window with Cancel focused. `delete-refused.png` shows Editor still listed and the alert line at the bottom of the column. `video.webm` records the whole path.
- **Cancel.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/marks.json --run delete-cancel wait window wait live wait bots right-click button Copywriter click menuitem "Delete…" see "Delete Copywriter?" press Escape gone dialog "Delete Copywriter?" focused button Copywriter absent "This Hermes can't delete bots from Highwing." click button "More for Copywriter" click menuitem "Delete…" see "Delete Copywriter?" click button Cancel gone dialog "Delete Copywriter?" focused button Copywriter count button Copywriter 1 shot delete-cancelled right-click button Hermes count menu "More for Hermes" 1 count menuitem "Delete…" 0 count menuitem "Show in list" 1 shot menu-hidden-default press Escape native-menus 0 quiet`. `menu-hidden-default.png` shows the hidden default bot's menu ending in Show in list.

## Gotchas

- The dialog's accessible name is its heading, so `gone dialog "Delete Editor?"` names the bot. `gone dialog Editor` would not match.
- The dialog's button is `Delete` and the menu item is `Delete…`, so `click button Delete` never hits the menu.
- When Hermes gains a gateway method to delete a profile, the refusal in this recipe is the step to replace with the bot leaving the list.
