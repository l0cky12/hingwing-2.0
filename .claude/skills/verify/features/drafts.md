# Drafts

Text typed in the message box and not sent stays with its chat. A click on another bot or chat and back finds it, and so does a quit, a crash or a reload. Main keeps each draft as one file in the `drafts` folder of Electron's `userData` directory, written about half a second after the last keystroke, and deletes it when its message is sent or the box is emptied. A chat with a draft says "Draft" under its title in the Chats column. A draft never reaches the gateway before Send.

## Sub-features

- `drafts-switch` keeps the text when you open another bot and come back.
- `drafts-restart` restores the text in its chat after a quit and a new launch.
- `drafts-sent` deletes the draft when its message is sent, so a restart finds the box empty and no file left.
- `drafts-first-message` deletes the draft of a bot's unstarted chat, or of the new-chat view, when its first message makes the chat.
- `drafts-row` says "Draft" on the row of a chat that holds a draft and is not the open one.
- `drafts-sweep` deletes a restored draft whose chat is missing from a whole list of its bot's chats.
- `drafts-private` sends no draft text to the gateway until Send.

## How to get to it (user POV)

- Type in the message box, then click another bot or chat, or quit Highwing.
- Open the chat again. The text is in the box.

## Driving it with highwing-verify

Preconditions:

- A `--fixture` run keeps its user-data directory, `/tmp/highwing-verify-scratch/<run>/user-data`, for the next run with the same `--run` name. Reuse one name to restart the app. `$H cleanup --run <name>` empties it, and so does any `--fake-host` run.
- `drafts <n>` reads that directory's `drafts` folder. It logs each file's key and text, so `steps.log` shows which chat a draft belongs to: `chat:<session>`, `bot:<profile>` for a bot's unstarted chat, or `new`.
- `--profiles fixtures/profiles/chats.json` gives Research no Bot Chat, so clicking Research shows its unstarted chat (`bot:research`), and three chats with sessions. The gateway forgets a chat a first message made when the run ends.
- A run's `gateway-calls.jsonl` is emptied when the next run with the same name starts. Give a run whose calls you grep a name of its own.

Recipes, with `O="--fixture fixtures/errand.jsonl --profiles fixtures/profiles/chats.json"`:

- **Switch.** Run `$H run $O --run drafts-switch wait live wait bots click button Research current button Research type "Message Hermes" "half a thought" click button "Emu, default bot" current button "Emu, default bot" value "Message Hermes" "" click button Research current button Research value "Message Hermes" "half a thought" quiet`.
- **Restart, then send.** Run these in order with one name. `$H run $O --run drafts wait live wait bots click button Research current button Research type "Message Hermes" "half a thought" drafts 1 quiet`, then `$H run $O --run drafts wait live wait bots click button Research current button Research value "Message Hermes" "half a thought" click button Send said "research: half a thought" value "Message Hermes" "" drafts 0 quiet`, then `$H run $O --run drafts wait live wait bots click button Research current button Research value "Message Hermes" "" drafts 0 quiet`.
- **Row.** Run `$H run $O --run drafts-row wait live wait bots click button Research click button "Sort the invoices" type "Message Hermes" "half a thought" click button "Clean up Downloads" current button "Clean up Downloads" drafts 1 shot draft-row quiet`. `draft-row.aria.txt` reads `button "Sort the invoices": Sort the invoices 3d Draft`. A second run with the same name shows the same row after clicking Research, before the chat is opened.
- **Sweep.** Before the first launch of a fresh name, write a file into `/tmp/highwing-verify-scratch/<run>/user-data/drafts` named by the first 32 hex digits of the SHA-256 of its key, plus `.json` (`printf %s chat:local-0999 | sha256sum | cut -c1-32`), holding `{"version":1,"key":"chat:local-0999","bot":"research","text":"gone"}`. Then run `$H run $O --run <run> wait live wait bots drafts 1 click button Research current button Research drafts 0 quiet`. A file for a listed chat such as `chat:local-0103`, or for another bot, stays.
- **Never sent before Send.** Run `$H run $O --run drafts-quiet wait live wait bots click button Research click button "Sort the invoices" type "Message Hermes" "zebra-quartz half a thought" drafts 1 quiet`, then `grep -c zebra-quartz /tmp/highwing-verify/drafts-quiet/gateway-calls.jsonl` prints 0. The same steps under another name with `click button Send said "research: zebra-quartz half a thought"` added print 1, the `prompt.submit`.

## Gotchas

- `see Draft` can wait on the wrong element. `see` matches any case, and a hidden preview such as "I drafted the reminder." comes first. Read the row in a shot's ARIA text instead.
- `drafts <n>` counts every `*.json` file, including one this build cannot read. Such a file loads as no draft and is never deleted.
- The open chat's row never says "Draft". Its text is in the box.
- A list never sweeps when Hermes returned a full page of 100 stored chats, because an older chat may be left out. That holds even when leaving out job chats brings the Chats column under 100 rows.
