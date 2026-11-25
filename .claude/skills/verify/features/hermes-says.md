# What Hermes says

Hermes says things beside the conversation, and the thread shows them where they happened. A status line, such as a compaction, a line the agent printed or a goal check's verdict, is a quiet graphite row in Hermes's own words. A compaction is one row that changes from "Compacting" to "complete". A notice Hermes keyed, such as a credit warning, shows in the tone of its level: caution for a warning, brick for an error, graphite otherwise. A notice with more to say has a "Details" control. A notice leaves the thread when Hermes clears it or its time runs out. A mixture-of-agents round is one closed row, "Asking 2 models", then "1 answered" or "Combining their answers". It opens to each model's name and answer. Lines Hermes says while no turn runs sit after the last turn, with no request above them and no end mark.

## Sub-features

- `says-lines` shows the compaction line, the agent's print and the goal verdict said while idle.
- `says-notice` shows the credit warning in the caution tone, and removes it once Hermes clears it.
- `says-notice-ttl` opens a notice's Details, and removes the notice when its time to live runs out while nothing else changes.
- `says-moa` opens the MoA round to the two reference models' answers.
- `says-find` finds words inside the closed MoA round and opens it.

## How to get to it (user POV)

- Run `HIGHWING_FIXTURE=fixtures/says.jsonl pnpm --filter @highwing/desktop start`, then send a message. Hermes asks two models, compacts its context, warns that credits are low, asks to delete a folder, clears the warning, and checks the goal after the turn ends.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.

- **Lines, notice, MoA.** Run `$H run --fixture fixtures/says.jsonl --chat-only --timeout 30000 --run says wait live type "Message Hermes" @request click button Send wait approval said "Context compaction complete" said "Subagent finished: 3 files checked." said "Credits are running low." shot waiting click button "Run once" wait settled said "Goal achieved: the chart was read" absent "Credits are running low." shot settled click button /Asking/ see "Three bars: 4, 7 and 5." shot moa-open quiet`.
  - `waiting.png` shows "Credits are running low." in caution brown between the agent's print and the second reasoning block.
  - `settled.aria.txt` holds `button "Asking 2 models Combining their answers"` with no `[expanded]`, the paragraphs `✓ Context compaction complete — continuing turn...` and `Subagent finished: 3 files checked.`, and after the Done ring a second `article` that holds only the paragraph `✓ Goal achieved: ...`. It holds no "Credits".
  - `moa-open.aria.txt` shows the MoA button `[expanded]` over `heading "fast-small"` and `heading "careful-large"`, each followed by its answer as a paragraph.
- **Details and time to live.** Write a copy of `fixtures/says.jsonl` whose `notification.show` payload has `"kind": "ttl"`, `"ttl_ms": 4000` and a `"detail"`, and play it outside the repo: `$H run --fixture /tmp/<dir>/says-ttl.jsonl --chat-only --run says-ttl wait live type "Message Hermes" @request click button Send wait approval said "Credits are running low." click button Details see "<detail words>" shot notice-details gone button Details absent "Credits are running low." quiet`. The story is stopped on the approval card while the notice runs out, so only the view's `changesAt` wake-up can remove it.
- **Find inside the closed round.** Run `$H run --fixture fixtures/says.jsonl --timeout 30000 --run says-find wait live type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled said "Goal achieved" press Control+f type "Find in chat" "second week" press Enter see "1 of 1" marks 1 marked "second week" shot found press Escape marks 0 shot closed quiet`. `found.aria.txt` shows the MoA button `[expanded]`. `closed.aria.txt` has no `[expanded]`.

## Gotchas

- The story waits for "Run once". Without it the turn never settles and Hermes never clears the warning.
- The warning shows for about 1.8 s of recorded time before the approval card arrives, then stays while the card waits. Check it after `wait approval`.
- The goal verdict arrives about 0.6 s after the turn settles, so `said` it before any `absent` or `shot` meant to show it.
- The MoA round has aggregated by the time anything can be pressed, so its button reads "Asking 2 models Combining their answers". Click it with `/Asking/`.
- The fixture's `chart.png` tool image does not load, and leaves a dot under "Used vision_analyze".
- Notices, status lines and MoA rounds are live only. A rebuild or a restart drops them.
