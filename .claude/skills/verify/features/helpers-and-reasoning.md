# Helpers and reasoning

When Hermes hands work to a helper, keeps a to-do list, or reasons before it answers, the thread shows it. A helper is a diamond node with its goal and, while it works, one line saying what it does now. While the chat is live, a helper the agent started has a Stop button beside its row until Hermes ends it. A plan is a node with a checklist that is open while the turn runs, and a chat read again from Hermes keeps the plan Hermes holds. A reasoning block is a quiet one-line node, "Thought for 5.2 s", that opens to the agent's own words.

## Sub-features

- `helper-live` puts the live end on the helper node while it is the newest thing Hermes does, and the node shows "Thinking" or "Started" and a command beneath its title.
- `helper-open` opens a helper to show its tool steps, any helper of its own, and its summary once it ended.
- `plan-open` shows the plan open while its turn runs and closed once the turn settled, with "N of M done" on its head and each entry's state as hidden text.
- `reasoning-closed` shows each reasoning block as a button named "Thought for ..." that is not expanded, with its text out of the accessibility tree.
- `reasoning-open` shows the block's plain text after a press.
- `helper-stop` sends `subagent.interrupt` for that helper alone, reads "Stopping" and is disabled until Hermes ends the helper, which then reads "Stopped" with no button.
- `helper-stop-refused` shows Hermes's "no longer running that helper" in the refusal line under the composer and gives the button back.
- `plan-reopened` shows the plan Hermes keeps in the newest turn that called the todo tool, right after that call, when the chat is read again.

## How to get to it (user POV)

- Run `HIGHWING_FIXTURE=$PWD/fixtures/delegate.jsonl pnpm --filter @highwing/desktop start`, then send a message. The story hands a disk check to one helper, keeps a three-item plan and reasons twice before it answers.
- Run `HIGHWING_FIXTURE=$PWD/fixtures/stop-helper.jsonl pnpm --filter @highwing/desktop start`, send a message, and press Stop beside the helper once it has started `du -sh`.
- Run `HIGHWING_FIXTURE=$PWD/fixtures/delegate-reopened.jsonl pnpm --filter @highwing/desktop start`. The chat opens as Hermes stored it after the delegate story.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.
- `fixtures/stop-helper.jsonl`, `fixtures/stop-helper-gone.jsonl` and `fixtures/delegate-reopened.jsonl`, written from `fixtures/delegate.jsonl` by `python3 fixtures/make_stop_helper_fixture.py`. The two stop stories wait for `subagent.interrupt` right after the helper's first tool frame. `stop-helper` answers `found: true`, ends the helper `interrupted` 1.5 s later and settles the first turn. `stop-helper-gone` answers `found: false` and plays on as recorded. `delegate-reopened` has the delegate story's stored rows and Hermes's last `todo_state`, revision 3, and no steps.

- **Helper running, reasoning, helper steps.** Run `$H run --fixture fixtures/delegate.jsonl --chat-only --timeout 30000 --run helpers wait live type "Message Hermes" @request click button Send wait helper-running shot helper-running click button "/^Thought for/" see "The user wants" shot reasoning-open click button "/^Helper In the folder/" see "du -sh /tmp/highwing-backup-work/backups + 1 command" shot helper-open wait settled shot settled quiet`.
  - `helper-running.aria.txt` holds `button "Thought for under a second"` with no `[expanded]`, `button "Plan 0 of 3 done" [expanded]` over a `list "Plan"` of three entries, and a `button` that starts `Helper In the folder` and ends `working`. The state itself proves the live end sits on that helper.
  - `reasoning-open.aria.txt` shows the reasoning button `[expanded]` and the block's text as a `paragraph` that starts "The user wants".
  - `helper-open.aria.txt` shows the helper button `[expanded]` and a `list "Helper steps"` whose item reads `Started`, `du -sh /tmp/highwing-backup-work/backups + 1 command`, `latest step`.
  - `settled.aria.txt` shows the first turn settled: the helper `1 step 3.3 s done` with its steps and `heading "Helper's summary"`, and the plan closed.
- **Find inside a closed block.** Run `$H run --fixture fixtures/delegate.jsonl --timeout 30000 --run find-reasoning wait live type "Message Hermes" @request click button Send wait settled press Control+f type "Find in chat" "tool_describe(" press Enter see "1 of 1" shot found press Escape shot closed`. `found.aria.txt` shows the first reasoning button `[expanded]` with its text. `closed.aria.txt` has no `[expanded]`.

- **Stop a helper.** Run `$H run --fixture fixtures/stop-helper.jsonl --timeout 30000 --run helper-stop wait live type "Message Hermes" @request click button Send see "du -sh /tmp/highwing-backup-work/backups + 1 command" shot helper-stoppable click button "Stop helper" disabled button "Stopping helper" shot helper-stopping called subagent.interrupt '{"subagent_id":"sa-0-13199361"}' 1 gone button "Stopping helper" see "Stopped" shot helper-stopped wait settled count button "Stop helper" 0 shot settled quiet`.
  - `helper-stoppable.aria.txt` holds the helper button, ending `working`, and right after it `button "Stop helper"`, a sibling and not part of the helper button's name.
  - `helper-stopping.aria.txt` holds `button "Stopping helper" [disabled]`.
  - `helper-stopped.aria.txt` holds the helper button ending `Stopped 2.9 s` and no Stop button. `gateway-calls.jsonl` holds one `subagent.interrupt` with `session_id` and `subagent_id` only.
- **A stop Hermes refuses.** Run `$H run --fixture fixtures/stop-helper-gone.jsonl --timeout 30000 --run helper-stop-refused wait live type "Message Hermes" @request click button Send see "du -sh /tmp/highwing-backup-work/backups + 1 command" click button "Stop helper" see "Hermes is no longer running that helper." enabled button "Stop helper" shot stop-refused called subagent.interrupt '{"subagent_id":"sa-0-13199361"}' 1 gone button "Stop helper" wait settled shot settled quiet`. `stop-refused.png` shows the words in brick under the composer and the Stop button back. The helper then completes as recorded, about 2 s later, and its button goes.
- **The plan after the chat is read again.** Run `$H run --fixture fixtures/delegate-reopened.jsonl --timeout 30000 --run plan-reopened wait live said "The nightly backup died" count button "/^Plan/" 1 shot reopened click button "Plan 3 of 3 done" count list "Plan" 1 shot plan-open quiet`. `plan-open.aria.txt` holds one `button "Plan 3 of 3 done" [expanded]`, after the second request (the helper's completion notice) and right after that turn's `button "Used tool_call"`, over a `list "Plan"` of three entries, each ending `done`. The first turn has no plan.

## Gotchas

- The ARIA snapshot prints `[expanded]` only when `aria-expanded` is true, so a closed node is the line without it.
- Reasoning durations come from this client's clock, so `Thought for 2.0 s` varies. Match `/^Thought/`, never an exact name. A helper's goal is Hermes's words, so match its first words.
- A `/regex/` click takes the first match. The second turn, which Hermes starts when the helper's result returns, has its own reasoning buttons after the first turn's.
- `helper-running` holds for under a second at a time in this story: the helper starts at about 10.3 s and ends at 13.6 s, and the live end moves to a `read_file` step, a reasoning block and a writing tip between. Put `shot` right after `wait`. A shot taken a step later can fail with "state ended before the screenshot finished", which is the harness being honest.
- The helper is often caught before its first tool, so wait for its step text (`see`) after opening it.
- The plan's box is viridian only while its turn is live, so a shot of the settled plan has none of it.
- `fixtures/delegate.jsonl` has Hermes start a second turn itself, with no typed request. Its request line shows the helper's completion notice.
- Press Stop only after `see` finds the helper's first tool. The stop stories wait for `subagent.interrupt` there, and a press any earlier reaches the gateway before the story waits for it, which fails the run.
- The composer's own "Stop" stops the turn. The helper's button is named "Stop helper", or "Stopping helper" once pressed, so match it exactly.
- `see` and `said` take the first match, and the closed records of the first turn's `tool_call` steps hold the plan's entry words, so they time out on an entry. Check the open plan with `count list "Plan" 1` and its `.aria.txt`.
- A chat read again keeps only the newest plan. Hermes stores no older revision, so the first turn of `delegate-reopened` has none, unlike the live story.
