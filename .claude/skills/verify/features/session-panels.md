# Session panels

A chat holds what Hermes keeps beside it: the processes the agent left running in the background, and the goal, loop and heartbeat. The app reads both when the window starts watching the chat, reads the process list again at each turn's end, and follows every goal update Hermes publishes. A settled reply names its stored row and the reactions on it. The window draws none of this yet, and has no control to kill a process, press a goal button, list or restore a checkpoint, or react. In the replay below another client makes those calls, and the thread loses the turn that a checkpoint restore took back.

## Sub-features

- `panels-reads` sends one `process.list` and one `session.control.read` when the window starts watching the chat, and one more `process.list` at each turn's end.
- `panels-elsewhere` makes no panel call of its own while another client kills the server, sets and pauses a goal, lists, diffs and restores checkpoints, and reacts.
- `panels-restore` drops the turn the restore's rewind took back, and keeps the first turn whole.

## How to get to it (user POV)

- Send a message to a chat. Nothing in the window shows the panel yet.

## Driving it with highwing-verify

Preconditions:

- `fixtures/panels.jsonl`, played with `--acted-elsewhere`. Without it the story waits after the second turn for a `message.react` the window cannot send.
- `--acted-elsewhere` leaves to another client every `process.kill`, `session.control`, `rollback.list`, `rollback.diff`, `rollback.restore` and `message.react`. The fixture's `reads` steps still change what `process.list` and `session.control.read` answer, and the `session.control.update` and `session.updated` frames still reach the window.

- **Whole story.** Run `$H run --fixture fixtures/panels.jsonl --acted-elsewhere --timeout 20000 --run panels wait live type "Message Hermes" @request click button Send said "release.md lists the two changes" type "Message Hermes" "Add the release date to release.md." click button Send said "release is next Friday" gone button Stop shot turns gone button "Edited release.md +1" count button "Copy request" 1 shot restored called process.list '{}' 3 called session.control.read '{}' 1 called process.kill '{}' 0 called session.control '{}' 0 called rollback.list '{}' 0 called rollback.diff '{}' 0 called rollback.restore '{}' 0 called message.react '{}' 0 called prompt.submit '{}' 2 quiet`. `turns.aria.txt` holds both turns. `restored.aria.txt` holds only the first.

## Gotchas

- A rewind another client makes cuts the thread in place, so `session.resume` is sent once. The window's own whole-folder restore would read the chat again.
- The restore comes about 12 s into the story at recorded timing. `gone` waits for it, so keep the step timeout above that.
