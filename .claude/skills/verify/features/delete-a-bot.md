# Delete a bot

Each bot's menu in the Bots column has Delete… last, in a group of its own, after Pin to top or Unpin and Hide from list on a normal or a pinned row, or after Show in list on a hidden row. The default bot's card has none. [The bot menu](./bot-menu.md) says how to open it. Hermes deletes a profile only on its own machine, with `hermes profile delete` (hermes_cli/profiles.py), and its gateway has no call for it, so Delete… is shown unavailable on every bot. Its title and its screen-reader description say "This Hermes can't delete bots from Highwing. To delete Editor, run hermes profile delete editor on the Hermes machine.", with the bot's name and id. Hermes never deletes its default profile, so on the default bot's row under Hidden they say "The default bot can't be deleted." Choosing it opens no dialog and sends nothing. `DELETES_BOTS` in `packages/hermes/src/domain/bots.ts` turns the item on, and is false for every Hermes so far.

## Sub-features

- `delete-gated` shows Delete… unavailable on a normal, a pinned and a hidden row and on the hidden default bot, with the other items usable, closes the menu with Escape back onto the row, and sends no call.

## How to get to it (user POV)

- Right-click a bot in the Bots column, or press ⋯ at its right end. Delete… is dimmed, and resting the pointer on it shows why.
- Or give a bot row focus with Tab, press Shift+F10, and move onto Delete… with the arrows. A screen reader reads it as unavailable, with the words.

## Driving it with highwing-verify

Preconditions:

- `--profiles fixtures/profiles/marks.json` holds Editor in Writing, Researcher pinned, and the default bot Hermes hidden, so its row is under Hidden at launch.
- `called` counts the calls of the whole run when the run ends. `gateway-calls.jsonl` holds no `profiles.delete`, no `cli.exec` and no `profiles.configure`.

Recipes:

- **Gated.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/marks.json --run delete-gated wait window wait live wait bots right-click button Editor count menuitem Delete… 1 disabled menuitem Delete… enabled menuitem "Hide from list" shot delete-menu press Escape focused button Editor absent "Delete Editor?" count button Editor 1 click button "More for Researcher" disabled menuitem Delete… press Escape right-click button Hermes disabled menuitem Delete… shot delete-default-menu press Escape focused button Hermes absent "Delete Hermes?" native-menus 0 called profiles.configure '{"name":"editor"}' 0 quiet`. `delete-menu.png` shows Delete… dimmed under a separator at the end of Editor's menu, and `delete-menu.aria.txt` lists it as `menuitem "Delete…" [disabled]`. `delete-default-menu.png` shows the same on the hidden default bot.
- **Recording.** Add `--video` to the Gated recipe to save `video.webm` of it.

## Gotchas

- Playwright's `click` waits for an item to be enabled, so `click menuitem Delete…` times out at 15 s. Use `disabled menuitem Delete…`.
- The words are the item's `title` and an `aria-describedby` span with class `sr`, so `see` never finds them, and a shot does not show the native tooltip. `apps/desktop/test/bots.test.tsx` checks both in the rendered menu.
- A Hermes that gains `profiles.delete` needs a command in `packages/hermes`, wired at the dialog's confirm in Bots.tsx, and `DELETES_BOTS` set true. Delete… then opens "Delete Editor?" again, and this recipe becomes the bot leaving the list.
