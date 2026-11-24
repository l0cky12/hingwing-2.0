# Slash menu

The user types `/` at the start of the message box and a list of Hermes commands and skills opens above it, each row with its name and one line of description, commands first and then skills. Typing narrows the list to names that start with the typed text. Up and Down move with wrap-around, Enter or Tab puts the name and a space in the box, and Escape closes the list and keeps the text. Sending a line that starts with a listed name runs that command or skill. A Hermes without the catalog shows no list, and `/` behaves as plain text.

## Sub-features

- `slash-open` opens the "Commands and skills" listbox for a `/` at the start of the box.
- `slash-narrow` keeps only the names that start with what follows the `/`.
- `slash-complete` puts the active name and a space in the box with Tab or Enter.
- `slash-escape` closes the list and keeps the text.
- `slash-focus` hides the list while the box does not have focus.
- `slash-mid-sentence` opens nothing for a `/` after other text.
- `slash-no-catalog` opens nothing when the gateway refuses the catalog call.
- `slash-run` shows a command's output under the composer after Send.

## How to get to it (user POV)

- Type `/` as the first character in the "Message Hermes" box.

## Driving it with highwing-verify

Preconditions:

- `fixtures/slash.jsonl`, the errand with a real catalog from `fixtures/make_slash_fixture.py`. Highwing lists 36 of its 100 rows: the 33 commands the gateway runs, `/new`, which Highwing runs itself, and 2 skills.
- `fixtures/errand.jsonl` has no catalog, so its gateway answers the call with -32601, as an older Hermes does.

- **Open.** Run `$H run --fixture fixtures/slash.jsonl --run slash-open wait live type "Message Hermes" / wait slash-menu tally option 36 shot slash-open`. `slash-open.aria.txt` shows `listbox "Commands and skills"` with `group "Commands"` and `group "Skills"`.
- **Narrow and complete.** Run `$H run --fixture fixtures/slash.jsonl --run slash-narrow wait live type "Message Hermes" / wait slash-menu press c press o tally option 3 shot slash-narrowed press Tab value "Message Hermes" "/context " tally listbox 0`.
- **Escape.** Run `$H run --fixture fixtures/slash.jsonl --run slash-escape wait live type "Message Hermes" / wait slash-menu press c press o press Escape tally listbox 0 value "Message Hermes" /co press Backspace press Backspace press Backspace press / press c press o tally option 3`. Escape closes the list only until the text changes, so typing `/co` again opens it.
- **Focus.** Run `$H run --fixture fixtures/slash.jsonl --run slash-focus wait live type "Message Hermes" / wait slash-menu press Shift+Tab tally listbox 0 click textbox "Message Hermes" tally option 36`.
- **Mid-sentence.** Run `$H run --fixture fixtures/slash.jsonl --run slash-mid wait live type "Message Hermes" "Please run " press / tally listbox 0 value "Message Hermes" "Please run /"`.
- **No catalog.** Run `$H run --fixture fixtures/errand.jsonl --run slash-none wait live type "Message Hermes" / tally listbox 0 value "Message Hermes" / shot slash-none`. `slash-none.aria.txt` shows the textbox and Send, and no refusal words.
- **Wrap.** Run `$H run --fixture fixtures/slash.jsonl --run slash-wrap wait live type "Message Hermes" / wait slash-menu press ArrowUp shot slash-wrapped press Enter value "Message Hermes" "/release-notes " tally listbox 0`.

## Gotchas

- `tally` and `value` wait two animation frames before they read, so a zero count cannot pass before React renders the list.
- `type` replaces the box's text. Use `press` for each further character, as a user types.
- `fixtures/slash.jsonl` has no `command.dispatch` step, so sending a listed command fails its story. To see `slash-run`, put a `command.dispatch` step with an `exec` reply before its first step.
