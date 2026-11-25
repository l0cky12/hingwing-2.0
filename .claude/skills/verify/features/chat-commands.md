# Chat commands

The user types `/btw <question>` to ask beside the chat, `/bg <prompt>` to run a prompt apart from it, and `/compress [focus]` to summarise the older turns. The slash menu offers all three. A side question or a background prompt sends its words to Hermes and leaves the thread as it was. Its answer shows in a card above the composer, as [Side questions](./side-questions.md) covers. A compression shows Hermes's report under the composer, and the thread is then read again from what Hermes stores. The YOLO pill sets the switch with `tune yolo`, as it did with the old `setYolo`. `@` and letters list the chat's files through #112's `completePath`, which the replay's header answers. The other chat commands (effort, fast, the chat's folder and export) have no control in the window yet, and another client makes them in the replay below.

## Sub-features

- `commands-btw` sends a typed `/btw` line as `prompt.btw` with the words alone, and shows the answer in a "Side question" card.
- `commands-bg` sends a typed `/bg` line as `prompt.background`, and shows the answer in a "Background prompt" card.
- `commands-yolo` sets YOLO through `tune` with the same call and confirmation as before.
- `commands-compress` sends a typed `/compress` line as a `compress` mutate with its focus, shows the report, and reads the chat again.
- `commands-complete` lists `notes.md` under Files for `@no`, from the `complete.path` reply the fixture's header holds.
- `commands-elsewhere` shows nothing new for the effort, fast, folder and export calls another client makes, and keeps the thread whole.

## How to get to it (user POV)

- Type `/btw`, `/bg` or `/compress` in the "Message Hermes" box, then words, and press Send.

## Driving it with highwing-verify

Preconditions:

- `fixtures/commands.jsonl`, played with `--acted-elsewhere`. Without it the story waits after the compression for an effort change the window cannot make.
- `fixtures/commands.jsonl` holds Hermes's `complete.path` reply for `@no` in its header's `paths`, so the gateway answers it whenever the window asks, as in complete-a-path.
- `--acted-elsewhere` leaves to another client every `session.export`, fast `config.set`, and `reasoning` or `workspace` mutate. Their session.info frames still reach the window.
- Every run sets `HIGHWING_SAVE_DIR` to `saves/` in the evidence directory, so an export never opens a dialog.

- **Whole story.** Run `$H run --fixture fixtures/commands.jsonl --acted-elsewhere --timeout 20000 --run commands wait live pressed button YOLO false type "Message Hermes" "@no" tally option 1 count group Files 1 count option notes.md 1 press Escape type "Message Hermes" "What does notes.md say about the release?" click button Send said "notes.md lists three tasks" type "Message Hermes" "Then outline docs/plan.md." click button Send said "docs/plan.md has two parts" gone button Stop shot turns type "Message Hermes" "/btw Which file holds the plan?" click button Send called prompt.btw '{"text":"Which file holds the plan?"}' 1 see "The plan is in docs/plan.md." type "Message Hermes" "/bg Draft a changelog entry for the notes." click button Send called prompt.background '{"text":"Draft a changelog entry for the notes."}' 1 count region "Side question" 1 count region "Background prompt" 1 see "Changelog: " shot sides click button YOLO click button "Turn on" pressed button "YOLO on" true called config.set '{"key":"yolo","value":"on"}' 1 type "Message Hermes" "/compress the release plan" click button Send see "Compressed: 4 → 3 messages" shot compressed called session.mutate '{"operation":"compress","payload":{"focus":"the release plan"}}' 1 reached session.resume '{"display_projection":true}' 2 wait live said "notes.md lists three tasks" said "docs/plan.md has two parts" pressed button "YOLO on" true count region "Side question" 1 shot rebuilt called prompt.submit '{}' 2 called complete.path '{"word":"@no"}' 1 called session.export '{}' 0 called config.set '{"key":"fast"}' 0 called session.mutate '{}' 1 quiet`. `sides.png` shows both answers in cards above the composer. `compressed.png` shows Hermes's three report lines under the composer. `rebuilt.aria.txt` holds both turns, read again from the stored rows, and the cards still open.

## Gotchas

- Each window call must reach the gateway while the story waits for it. A step the window cannot make stalls the story for its recorded pause of 1.5 s, so the fixture records the calls the window makes before the ones it leaves to another client.
- Do not press Escape before Send. The slash menu is open only while the box holds `/` and a name with no space, so a whole typed line never opens it, and Escape in the box closes the newest side card.
- The compression's `session.updated` starts a rebuild, so `session.resume` with `display_projection` is sent twice in all.
