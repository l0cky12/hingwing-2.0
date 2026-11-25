# Open a file

The path of a file that Hermes wrote or edited is a button in the step's open record. Pressing it opens the file with the desktop's default program. The **More for** button beside it shows **Show in folder** and **Copy path**, and **Preview** first for an HTML file, which [Preview pane](./preview.md) covers. Main opens only a path that a finished step of a session this window watches named. A file that no longer exists shows "This file isn't there any more." under the path.

## Sub-features

- `open-file-open` opens the file from the path button.
- `open-file-show` shows the file in its folder from the menu.
- `open-file-copy` copies the path from the menu.

## How to get to it (user POV)

- Send a message that makes Hermes edit a file. Open the "Edited" step, then press the path, or press the button beside it.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.
- Every `run` sets `HIGHWING_OPEN_LOG` to `opens.jsonl` in the evidence directory. Main then records each open or show call there and never opens anything on the desktop. The `opened` step reads that file.

Each recipe starts with the same steps, `PRE`: `wait live type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled click button "Created and edited notes.md 2 steps" click button "Edited notes.md +1 −1"`.

- **Open.** Run `$H run --fixture fixtures/errand.jsonl --run open-file PRE shot edited-open click button "Open notes.md" opened open /tmp/hermes-proto-work/notes.md shot opened`. `edited-open.aria.txt` holds `button "Open notes.md": /tmp/hermes-proto-work/notes.md` and `button "More for notes.md"`. `opens.jsonl` holds one line, `{"action":"open","path":"/tmp/hermes-proto-work/notes.md"}`.
- **Show in folder.** Run `$H run --fixture fixtures/errand.jsonl --run open-file-show PRE click button "More for notes.md" shot menu-open click button "Show in folder" opened show /tmp/hermes-proto-work/notes.md shot shown`. `menu-open.aria.txt` holds `button "More for notes.md" [expanded]`, then `button "Show in folder"` and `button "Copy path"`.
- **Copy path.** Run `$H run --fixture fixtures/errand.jsonl --run open-file-copy PRE click button "More for notes.md" click button "Copy path" copied /tmp/hermes-proto-work/notes.md shot copied`.

## Gotchas

- `opened` fails unless the log holds exactly one call. Drive each action in its own run.
- The test double always reports success, so a verify run never shows the missing-file words. `apps/desktop/test/files.test.ts` covers that outcome.
- The "Created" step also has a `button "Open notes.md"`. Open only one of the two steps, or the name matches twice.
