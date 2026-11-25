# Spell check

The composer underlines a misspelled word. A right-click on it, or the Menu key or Shift+F10 with the caret in it, opens a context menu with up to five suggestions, "Add to dictionary", and then Cut, Copy and Paste. Picking a suggestion replaces the word. "Add to dictionary" stops the word being flagged. In a field with no misspelled word the menu holds Cut, Copy and Paste, each disabled when the field cannot do it. Over selected text outside a field it holds Copy alone. Elsewhere no menu opens. Spell check is always on. The Find field, the connection host field and the other name and search fields turn it off.

## Sub-features

- `spell-suggestion` replaces the misspelled word with the suggestion picked.
- `spell-dictionary` adds the word to the dictionary, after which the menu no longer offers it.
- `spell-menu` holds the rules for which entries the menu shows. The unit tests in `apps/desktop/test/context-menu.test.ts` cover them: the five-suggestion cap, a word with no suggestions, disabled entries, Copy alone for selected text, and no menu at all.

## How to get to it (user POV)

- Type a misspelled word such as "teh" in the composer, then right-click it.

## Driving it with highwing-verify

Preconditions:

- `fixtures/errand.jsonl`. Every run sets `HIGHWING_MENU_LOG` to `menus.jsonl` in the evidence directory, so main records each context menu there and shows nothing. `--menu-pick <label>` makes main run that entry when a recorded menu holds it.
- Network access on the run's first use of a user-data directory, to download the dictionary.

- **Suggestion.** Run `$H run --fixture fixtures/errand.jsonl --run spell-suggestion --menu-pick the wait live click textbox "Message Hermes" press t press e press h menu ContextMenu the value "Message Hermes" the`. `steps.log` logs the menu that held "the", with the suggestions `the`, `eh`, `tech`, `tee` and `tea`, then "Add to dictionary", then Cut, Copy and Paste. It ends in `PASS`.
- **Dictionary.** Run `$H run --fixture fixtures/errand.jsonl --run spell-dictionary --menu-pick "Add to dictionary" wait live click textbox "Message Hermes" press t press e press h menu ContextMenu "Add to dictionary" menu-without ContextMenu "Add to dictionary" value "Message Hermes" teh`. `steps.log` logs a menu with "Add to dictionary", then the next menu holding only Cut, Copy and Paste, and the box still holding "teh". It ends in `PASS`. Without `--menu-pick`, the `menu-without` step fails at the timeout, because the word stays flagged.

## Gotchas

- Type with `press`, one key at a time. A word put in with `type` (Playwright's `fill`) is never checked.
- The spellchecker marks a word a second or so after it is typed. `menu` presses its key until a menu holds the label, so the first few lines of `menus.jsonl` lack the suggestions. That is why `menu-without` proves something only after a `menu` that held the label: before the word is marked, every menu lacks it.
- Use a fresh `--run` name, or `$H cleanup --run <name>` first. A `--fixture` run keeps its user-data directory, so a second run under the same name starts with the last run's draft in the box and with "teh" already in `Custom Dictionary.txt`.
- On Linux Chromium downloads the `en-US` dictionary into the user-data directory's `Dictionaries/` on first use. With no network the download fails silently, nothing is flagged, and `menu` fails at the timeout with menus that hold only Cut, Copy and Paste.
- A field that turns spell check off cannot be proven with `menu-without`, which passes on the first press there whether or not the field checks spelling. Read `spellCheck={false}` in the source instead.
- Paste is disabled in these runs, since the Xvfb display's clipboard holds nothing.
