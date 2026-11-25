# Session panels

A chat holds what Hermes keeps beside it: the processes the agent left running in the background, and the goal, loop and heartbeat. The app reads both when the window starts watching the chat, reads the process list again at each turn's end and after this window stops a process, and follows every goal update Hermes publishes. The window draws them as a status stack above the composer: one closed row each, that opens to the details and the buttons Hermes serves. A settled reply has a React button and shows the reactions on it as chips. In the replay below the window reacts, stops the process and pauses the goal. Another client adds a criterion to the goal and lists, diffs and restores checkpoints, and the thread loses the turn that the restore took back.

## Sub-features

- `panels-reads` sends one `process.list` and one `session.control.read` when the window starts watching the chat, one more `process.list` at each turn's end, and one after the window's Stop.
- `panels-react` opens the six quick reactions from a reply's React button, moves among them with the arrow keys, closes on Escape with focus back on React, sends `message.react` for the one pressed, and shows it as a chip that can take it off.
- `panels-processes` shows "1 running in the background". Opened, it shows the command, Running, a Stop button and the end of the output. Stop sends `process.kill`, and the row then reads "Stopped".
- `panels-goal` shows the goal's row once Hermes publishes it, with the criterion another client added. Clear asks first, and Cancel sends nothing. Pause sends `session.control` with `goal.pause`, and the card then offers Resume.
- `panels-elsewhere` makes no checkpoint call of its own while another client lists, diffs and restores checkpoints.
- `panels-restore` drops the turn the restore's rewind took back, and keeps the first turn whole.

## How to get to it (user POV)

- Point at a reply and press React, then an emoji. Press your chip to take it off.
- Press "1 running in the background" above the message box, then Stop.
- Press the Goal row above the message box, then Pause or Clear.

## Driving it with highwing-verify

Preconditions:

- `fixtures/panels.jsonl`, played with `--acted-elsewhere --window-makes message.react,process.kill,session.control:goal.pause`. The story then waits for the window's reaction, Stop and Pause, and leaves the `subgoal.add` and every `rollback.*` call to another client.
- The fixture's `reads` steps still change what `process.list` and `session.control.read` answer, and the `session.control.update` and `session.updated` frames still reach the window.

- **Whole story.** Run `$H run --fixture fixtures/panels.jsonl --acted-elsewhere --window-makes message.react,process.kill,session.control:goal.pause --timeout 20000 --run panels wait live type "Message Hermes" @request click button Send said "release.md lists the two changes" type "Message Hermes" "Add the release date to release.md." click button Send said "release is next Friday" gone button Stop shot turns click-at button React 1 focused button Heart press ArrowRight focused button "Thumbs up" press Escape gone dialog Reactions focused button React click-at button React 1 shot reacting click button "Thumbs up" called message.react '{"emoji":"👍"}' 1 count button "Remove your 👍" 1 click-at button React 1 pressed button "Thumbs up" true press Escape click button "1 running in the background" shot processes click button "Stop process" called process.kill '{}' 1 see Stopped click button /^Goal/ see "each change names its pull request" click button "Clear goal" see "Clear the goal?" shot confirm click button Cancel focused button "Clear goal" shot stack click button "Pause goal" called session.control '{"action":"goal.pause"}' 1 enabled button "Resume goal" gone button "Edited release.md +1" count button "Copy request" 1 shot restored called process.list '{}' 4 called session.control.read '{}' 1 called process.kill '{}' 1 called session.control '{}' 1 called rollback.list '{}' 0 called rollback.diff '{}' 0 called rollback.restore '{}' 0 called message.react '{}' 1 called prompt.submit '{}' 2 quiet`. `turns.aria.txt` holds both turns. `reacting.png` shows the six reactions over the first reply. `processes.png` shows the running process with its Stop button. `stack.png` shows the stopped process and the open goal with its criterion, Pause and Clear. `restored.aria.txt` holds only the first turn, with its 👍 chip.

## Gotchas

- `enabled button "Resume goal"` proves the paused goal offers Resume. The story has no `goal.resume` step, so pressing it would fail the run.
- Press Stop and Pause only once the row shows what the story played before them. A call the story is not yet waiting for fails the run with "the story did not expect".
- A rewind another client makes cuts the thread in place, so `session.resume` is sent once. The window's own whole-folder restore would read the chat again.
- The restore comes about 12 s into the story at recorded timing. `gone` waits for it, so keep the step timeout above that.
- No emoji font is installed on this machine, so some reaction glyphs draw as empty boxes in the shots. The ARIA text names each one.
