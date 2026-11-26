# Delete a bot

Each bot's menu in the Bots column has Delete… last, in a group of its own, on a normal row, a pinned row and a hidden row. The default bot's card has none. [The bot menu](./bot-menu.md) says how to open it. Hermes deletes a profile only on its own machine, with `hermes profile delete` (hermes_cli/profiles.py), and its gateway has no call for it, so Delete… deletes nothing and sends nothing. It closes the menu, gives focus back to the row, and says in the column's alert line "This Hermes can't delete bots from Highwing. To delete Editor, run hermes profile delete editor on the Hermes machine.", with the bot's name and id. Hermes never deletes its default profile, so on the default bot's row under Hidden it says "The default bot can't be deleted." instead.

## Sub-features

- `delete-refused` offers Delete… on a normal, a pinned and a hidden row, refuses it on a normal row and on the hidden default bot in words with the row kept and focused, and leaves Delete… off the default bot's card.

## How to get to it (user POV)

- Right-click a bot in the Bots column, or press ⋯ at its right end, and choose Delete….
- Or give a bot row focus with Tab, press Shift+F10, and choose Delete… with the arrows.

## Driving it with highwing-verify

Preconditions:

- `--profiles fixtures/profiles/marks.json` holds Editor in Writing, Researcher pinned, and the default bot Hermes hidden, so its row is under Hidden at launch.
- `called` counts the calls of the whole run when the run ends, so the one `profiles.configure` the run makes is Show in list for Hermes, and none names Editor.

Recipes:

- **Refused.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/marks.json --run delete-refused wait window wait live wait bots right-click button Editor count menuitem Delete… 1 shot delete-menu click menuitem Delete… see "This Hermes can't delete bots from Highwing. To delete Editor, run hermes profile delete editor on the Hermes machine." focused button Editor count button Editor 1 shot delete-refused click button "More for Researcher" count menuitem Delete… 1 press Escape right-click button Hermes count menuitem Delete… 1 click menuitem Delete… see "The default bot can't be deleted." focused button Hermes shot delete-default-refused right-click button Hermes click menuitem "Show in list" see "Hermes is back in the list." focused button "Hermes, default bot" press Shift+F10 count menuitem "Hide from list" 1 count menuitem Delete… 0 shot delete-card-menu native-menus 0 called profiles.configure '{"name":"editor"}' 0 called profiles.configure '{}' 1 quiet`. `delete-menu.png` shows Delete… under a separator at the end of Editor's menu. `delete-refused.png` shows Editor still in Writing and the words in the alert line. `delete-card-menu.png` shows the card's menu ending at Hide from list.
- **Recording.** Add `--video` to the recipe above to save `video.webm` of it.

## Gotchas

- Delete… ends in an ellipsis because it answers with words, not at once. It never opens a confirmation, since nothing is deleted.
- The refusal is Highwing's own words, not a reply from Hermes. A Hermes that gains a delete call over the gateway needs a command in `packages/hermes` before Delete… can use it.
