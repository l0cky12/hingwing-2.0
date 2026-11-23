# Replay a fixture

With `HIGHWING_FIXTURE` set, the app plays a recorded Hermes gateway through the real client and opens its window on the fixture's chat. The errand fixture waits for the user's message, runs four tools, asks for approval before `rm`, and ends Done. At recorded timing the whole story lasts about 2.6 s, plus however long the approval waits.

## Sub-features

- `replay-open` opens the window on the fixture's session, live and empty, with an enabled composer.
- `replay-tool-running` shows "Running `ls -la && ls scratch`" as the live end while the listing runs.
- `replay-settled` ends with the request, the "Created and edited `notes.md`" group, both `Ran` rows, the answered approval, the closing prose with its code block, and the Done ring.
- `replay-records` opens a group and its steps to show diffs.

## How to get to it (user POV)

- Run `HIGHWING_FIXTURE=fixtures/errand.jsonl pnpm --filter @highwing/desktop start` from the repo root.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.

- **Open.** Run `$H run --fixture fixtures/errand.jsonl --run replay wait live shot open`. `open.aria.txt` holds an empty `main` and an enabled `button "Send"`.
- **Whole story.** Run `$H run --fixture fixtures/errand.jsonl --chat-only --run errand wait live type "Message Hermes" @request click button Send wait tool-running shot tool-running wait approval shot approval click button "Run once" wait settled shot settled`, then `$H compare errand`. `tool-running.aria.txt` ends with `text: Running` and `code: ls -la && ls scratch`. `settled.aria.txt` holds `button "Ran rm -rf /tmp/hermes-proto-work/scratch"` and the closing paragraph.
- **Records.** Continue a settled `--chat-only` run with `click button "Created and edited notes.md 2 steps" click button "Created notes.md +5" click button "Edited notes.md +1 −1" click button "Ran ls -la && ls scratch" shot settled-expanded`. The shot shows both diffs, and `compare-settled-expanded.png` sets it against the reference.

## Gotchas

- The story waits at `prompt.submit` until the composer sends, so a run that never sends shows an empty chat forever.
- Step accessible names include their stat, with a real minus sign (`+1 −1`).
- The live end's halo animates, and screenshots freeze animations, so the live dot has no halo ring in shots.
- `tool-running` lasts about 144 ms. Use `wait tool-running` immediately before `shot`, with no step between them.
- The design C references show the chat with no sidebar. `--chat-only` clips each shot to the chat column, so `compare` sets like against like.
