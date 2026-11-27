# Spell check

The composer underlines a misspelled word. A right-click on it, or the Menu key or Shift+F10 with the caret in it, opens a context menu with up to five suggestions, "Add to dictionary", and then Cut, Copy and Paste. Picking a suggestion replaces the word. "Add to dictionary" stops the word being flagged. In a field with no misspelled word the menu holds Cut, Copy and Paste, each disabled when the field cannot do it. Over selected text outside a field it holds Copy alone. Elsewhere no menu opens. Settings' Composer card has a Check spelling switch, on at first. Off turns the spellchecker off for every window, so no word is underlined and the menu holds no suggestions and no "Add to dictionary". Main keeps the choice in `spell-check.json`. The Find field, the connection host field and the other name and search fields turn it off.

## Sub-features

- `spell-suggestion` replaces the misspelled word with the suggestion picked.
- `spell-dictionary` adds the word to the dictionary, after which the menu no longer offers it.
- `spell-off` turns Check spelling off in Settings, after which a word flagged before has no suggestions, and a word typed after a restart is not underlined.
- `spell-menu` holds the rules for which entries the menu shows. The unit tests in `apps/desktop/test/context-menu.test.ts` cover them: the five-suggestion cap, a word with no suggestions, disabled entries, Copy alone for selected text, and no menu at all.

## How to get to it (user POV)

- Type a misspelled word such as "teh" in the composer, then right-click it.

## Driving it with highwing-verify

Preconditions:

- `fixtures/errand.jsonl`. Every run sets `HIGHWING_MENU_LOG` to `menus.jsonl` in the evidence directory, so main records each context menu there and shows nothing. `--menu-pick <label>` makes main run that entry when a recorded menu holds it.
- Network access on the run's first use of a user-data directory, to download the dictionary.

- **Suggestion.** Run `$H run --fixture fixtures/errand.jsonl --run spell-suggestion --menu-pick the wait live click textbox "Message Hermes" press t press e press h menu ContextMenu the value "Message Hermes" the`. `steps.log` logs the menu that held "the", with the suggestions `the`, `eh`, `tech`, `tee` and `tea`, then "Add to dictionary", then Cut, Copy and Paste. It ends in `PASS`.
- **Dictionary.** Run `$H run --fixture fixtures/errand.jsonl --run spell-dictionary --menu-pick "Add to dictionary" wait live click textbox "Message Hermes" press t press e press h menu ContextMenu "Add to dictionary" menu-without ContextMenu "Add to dictionary" value "Message Hermes" teh`. `steps.log` logs a menu with "Add to dictionary", then the next menu holding only Cut, Copy and Paste, and the box still holding "teh". It ends in `PASS`. Without `--menu-pick`, the `menu-without` step fails at the timeout, because the word stays flagged.

- **Off.** Make the roster fixture once: `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run settings-roster wait live wait bots`. Then set `F=/tmp/highwing-verify/settings-roster/fixture-edited.jsonl`. Settings, and so both switches, exist only in a `--fake-host` run. Run `$H run --fake-host ok --fixture $F --saved remote --run spell-off wait live wait bots click textbox "Message Hermes" press t press e press h menu ContextMenu the click button Settings wait settings checked switch "Check spelling" click switch "Check spelling" unchecked switch "Check spelling" click button Close wait live click textbox "Message Hermes" menu-without ContextMenu the relaunch wait live wait bots click button Settings wait settings unchecked switch "Check spelling" click button Close wait live click textbox "Message Hermes" press End press Space press w press o press r press l press d press z pause 3000 menu-without ContextMenu the shot off-after-restart quiet`. `steps.log` logs the menu with "the", then menus holding only Cut, Copy and Paste. `off-after-restart.png` shows "teh worldz" with no underline. The first `menu-without` proves the switch, since a `menu` showed the suggestion just before it. The second leans on the pause and the shot, as the gotcha below explains.

## Gotchas

- Type with `press`, one key at a time. A word put in with `type` (Playwright's `fill`) is never checked.
- The spellchecker marks a word a second or so after it is typed. `menu` presses its key until a menu holds the label, so the first few lines of `menus.jsonl` lack the suggestions. That is why `menu-without` proves something only after a `menu` that held the label: before the word is marked, every menu lacks it.
- Use a fresh `--run` name, or `$H cleanup --run <name>` first. A `--fixture` run keeps its user-data directory, so a second run under the same name starts with the last run's draft in the box and with "teh" already in `Custom Dictionary.txt`.
- On Linux Chromium downloads the `en-US` dictionary into the user-data directory's `Dictionaries/` on first use. With no network the download fails silently, nothing is flagged, and `menu` fails at the timeout with menus that hold only Cut, Copy and Paste.
- A field that turns spell check off cannot be proven with `menu-without`, which passes on the first press there whether or not the field checks spelling. Read `spellCheck={false}` in the source instead.
- Paste is disabled in these runs, since the Xvfb display's clipboard holds nothing.
