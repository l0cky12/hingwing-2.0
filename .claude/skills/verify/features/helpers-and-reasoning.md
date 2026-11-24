# Helpers and reasoning

When Hermes hands work to a helper, keeps a to-do list, or reasons before it answers, the thread shows it. A helper is a diamond node with its goal and, while it works, one line saying what it does now. A plan is a node with a checklist that is open while the turn runs. A reasoning block is a quiet one-line node, "Thought for 5.2 s", that opens to the agent's own words.

## Sub-features

- `helper-live` puts the live end on the helper node while it is the newest thing Hermes does, and the node shows "Thinking" or "Started" and a command beneath its title.
- `helper-open` opens a helper to show its tool steps, any helper of its own, and its summary once it ended.
- `plan-open` shows the plan open while its turn runs and closed once the turn settled, with "N of M done" on its head and each entry's state as hidden text.
- `reasoning-closed` shows each reasoning block as a button named "Thought for ..." that is not expanded, with its text out of the accessibility tree.
- `reasoning-open` shows the block's plain text after a press.

## How to get to it (user POV)

- Run `HIGHWING_FIXTURE=fixtures/delegate.jsonl pnpm --filter @highwing/desktop start`, then send a message. The story hands a disk check to one helper, keeps a three-item plan and reasons twice before it answers.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.

- **Helper running, reasoning, helper steps.** Run `$H run --fixture fixtures/delegate.jsonl --chat-only --timeout 30000 --run helpers wait live type "Message Hermes" @request click button Send wait helper-running shot helper-running click button "/^Thought for/" see "The user wants" shot reasoning-open click button "/^Helper In the folder/" see "du -sh /tmp/highwing-backup-work/backups + 1 command" shot helper-open wait settled shot settled quiet`.
  - `helper-running.aria.txt` holds `button "Thought for under a second"` with no `[expanded]`, `button "Plan 0 of 3 done" [expanded]` over a `list "Plan"` of three entries, and a `button` that starts `Helper In the folder` and ends `working`. The state itself proves the live end sits on that helper.
  - `reasoning-open.aria.txt` shows the reasoning button `[expanded]` and the block's text as a `paragraph` that starts "The user wants".
  - `helper-open.aria.txt` shows the helper button `[expanded]` and a `list "Helper steps"` whose item reads `Started`, `du -sh /tmp/highwing-backup-work/backups + 1 command`, `latest step`.
  - `settled.aria.txt` shows the first turn settled: the helper `1 step 3.3 s done` with its steps and `heading "Helper's summary"`, and the plan closed.
- **Find inside a closed block.** Run `$H run --fixture fixtures/delegate.jsonl --timeout 30000 --run find-reasoning wait live type "Message Hermes" @request click button Send wait settled press Control+f type "Find in chat" "tool_describe(" press Enter see "1 of 1" shot found press Escape shot closed`. `found.aria.txt` shows the first reasoning button `[expanded]` with its text. `closed.aria.txt` has no `[expanded]`.

## Gotchas

- The ARIA snapshot prints `[expanded]` only when `aria-expanded` is true, so a closed node is the line without it.
- Reasoning durations come from this client's clock, so `Thought for 2.0 s` varies. Match `/^Thought/`, never an exact name. A helper's goal is Hermes's words, so match its first words.
- A `/regex/` click takes the first match. The second turn, which Hermes starts when the helper's result returns, has its own reasoning buttons after the first turn's.
- `helper-running` holds for under a second at a time in this story: the helper starts at about 10.3 s and ends at 13.6 s, and the live end moves to a `read_file` step, a reasoning block and a writing tip between. Put `shot` right after `wait`. A shot taken a step later can fail with "state ended before the screenshot finished", which is the harness being honest.
- The helper is often caught before its first tool, so wait for its step text (`see`) after opening it.
- The plan's box is viridian only while its turn is live, so a shot of the settled plan has none of it.
- `fixtures/delegate.jsonl` has Hermes start a second turn itself, with no typed request. Its request line shows the helper's completion notice.
