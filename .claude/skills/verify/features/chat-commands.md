# Chat commands

The user types `/btw <question>` to ask beside the chat, `/bg <prompt>` to run a prompt apart from it, and `/compress [focus]` to summarise the older turns. The slash menu offers all three. A side question or a background prompt sends its words to Hermes and leaves the thread as it was. The window draws no answer yet. A compression shows Hermes's report under the composer, and the thread is then read again from what Hermes stores. The YOLO pill sets the switch with `tune yolo`, as it did with the old `setYolo`. The other chat commands (`@` completion, effort, fast, the chat's folder and export) have no control in the window yet, and another client makes them in the replay below.

## Sub-features

- `commands-btw` sends a typed `/btw` line as `prompt.btw` with the words alone.
- `commands-bg` sends a typed `/bg` line as `prompt.background`.
- `commands-yolo` sets YOLO through `tune` with the same call and confirmation as before.
- `commands-compress` sends a typed `/compress` line as a `compress` mutate with its focus, shows the report, and reads the chat again.
- `commands-elsewhere` shows nothing new for the effort, fast, folder, completion and export calls another client makes, and keeps the thread whole.

## How to get to it (user POV)

- Type `/btw`, `/bg` or `/compress` in the "Message Hermes" box, then words, and press Send.

## Driving it with highwing-verify

Preconditions:

- `fixtures/commands.jsonl`, played with `--acted-elsewhere`. Without it the story waits after the compression for an `@` completion the window cannot ask for.
- `--acted-elsewhere` leaves to another client every `complete.path`, `session.export`, fast `config.set`, and `reasoning` or `workspace` mutate. Their session.info frames still reach the window.
- Every run sets `HIGHWING_SAVE_DIR` to `saves/` in the evidence directory, so an export never opens a dialog.

- **Whole story.** Run `$H run --fixture fixtures/commands.jsonl --acted-elsewhere --timeout 20000 --run commands wait live pressed button YOLO false type "Message Hermes" "What does notes.md say about the release?" click button Send said "notes.md lists three tasks" type "Message Hermes" "Then outline docs/plan.md." click button Send said "docs/plan.md has two parts" gone button Stop shot turns type "Message Hermes" "/btw Which file holds the plan?" press Escape click button Send called prompt.btw '{"text":"Which file holds the plan?"}' 1 type "Message Hermes" "/bg Draft a changelog entry for the notes." press Escape click button Send called prompt.background '{"text":"Draft a changelog entry for the notes."}' 1 click button YOLO click button "Turn on" pressed button "YOLO on" true called config.set '{"key":"yolo","value":"on"}' 1 type "Message Hermes" "/compress the release plan" press Escape click button Send see "Compressed: 4 → 3 messages" shot compressed called session.mutate '{"operation":"compress","payload":{"focus":"the release plan"}}' 1 reached session.resume '{"display_projection":true}' 2 wait live said "notes.md lists three tasks" said "docs/plan.md has two parts" pressed button "YOLO on" true shot rebuilt called prompt.submit '{}' 2 called complete.path '{}' 0 called session.export '{}' 0 called config.set '{"key":"fast"}' 0 called session.mutate '{}' 1 quiet`. `compressed.png` shows Hermes's three report lines under the composer. `rebuilt.aria.txt` holds both turns, read again from the stored rows.

## Gotchas

- Each window call must reach the gateway while the story waits for it. A step the window cannot make stalls the story for its recorded pause of 1.5 s, so the fixture records the calls the window makes before the ones it leaves to another client.
- Press Escape before Send. The slash menu stays open while the line starts with a listed name.
- The compression's `session.updated` starts a rebuild, so `session.resume` with `display_projection` is sent twice in all.
