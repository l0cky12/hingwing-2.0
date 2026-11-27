# Copy a block

A **Copy** control leads the action row of your request and of each whole reply, and sits at the top right of the command on an approval card, of an open command step's row, and of each section of an open step's record. It shows while the pointer is over the block, while keyboard focus is inside it, and for two seconds after a press. Tab reaches it. A press writes the block's plain text to the clipboard: a reply as its Markdown source, a command whole and with no prompt sign, and a diff as a unified diff. Hermes caps the diff it sends, and a diff it cut short has no control, because a copy would drop lines without saying so. The control then reads "Copied" for two seconds, and a polite live region says the same word. A closed step shows no control.

## Sub-features

- `copy-request` copies the request exactly as you typed it.
- `copy-command` copies the approval card's command before you answer.
- `copy-ran` copies the whole command an open terminal step ran, `cd` prefix included, which its title clips.
- `copy-record` shows one control per record section of an open step, named for what it copies: `Copy changes to <path>`, `Copy output`, `Copy result` or `Copy input`. A section that shows only "No output" or "No result" has nothing to copy and no control.
- `copy-closed` keeps every closed step free of controls.
- `copy-keys` reaches each control with Tab.

## How to get to it (user POV)

- Replay the errand, send the request, and allow the delete. Point at the request, a reply, or an open step's record section, then press **Copy**.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.

- **Request.** Run `$H run --fixture fixtures/errand.jsonl --run copy wait live type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled click button "Copy request" see "Copied" clipboard request shot copied`. `request.clip.txt` holds the fixture's request, and `copied.aria.txt` shows `button "Copy request": Copied` and the live region's `text: Copied`.
- **Command.** Run `$H run --fixture fixtures/errand.jsonl --run copy-command wait live type "Message Hermes" @request click button Send wait approval click textbox "Message Hermes" press Shift+Tab focused button "Tell Hermes what to do instead" press Shift+Tab focused button "Don't run" press Shift+Tab press Shift+Tab press Shift+Tab focused button "Run once" press Shift+Tab focused button "Copy command" press Enter see "Copied" clipboard command shot approval-copied`. Shift+Tab from the message box reaches the card's "Tell Hermes what to do instead" before its answers. Attach files sits after the box, in its toolbar. `command.clip.txt` is `rm -rf /tmp/hermes-proto-work/scratch`.
- **Ran.** Run `$H run --fixture fixtures/errand.jsonl --run copy-ran wait live type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled click button "Ran ls -la && ls scratch" count button "Copy command" 1 click button "Copy command" see "Copied" clipboard ls-command shot ran-open`. `ls-command.clip.txt` is `cd /tmp/hermes-proto-work && ls -la && ls scratch`.
- **Records.** Run `$H run --fixture fixtures/errand.jsonl --run copy-record wait live type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled click button "Created and edited notes.md 2 steps" count button "/^Copy (changes|output|result|input)/" 0 click button "Created notes.md +5" count button "/^Copy (changes|output|result|input)/" 1 click button "Edited notes.md +1 −1" count button "/^Copy (changes|output|result|input)/" 2 click button "Ran ls -la && ls scratch" count button "/^Copy (changes|output|result|input)/" 3 click button "Ran rm -rf /tmp/hermes-proto-work/scratch" count button "/^Copy (changes|output|result|input)/" 3 see "No output" shot copy-record`.
- **Closed.** Run `$H run --fixture fixtures/errand.jsonl --run copy-closed wait live type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled count button "/^Copy (command|changes|output|result|input)/" 0 count button "/^Copy/" 3 shot copy-closed`. `copy-closed.aria.txt` holds `Copy request`, the reply's code block's `Copy code`, one `Copy reply` for the whole reply, and nothing else named Copy.
- **Keys.** Run `$H run --fixture fixtures/errand.jsonl --run copy-tab wait live type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled click textbox "Message Hermes" press Shift+Tab focused button React press Shift+Tab focused button Regenerate press Shift+Tab focused button "Copy reply" shot copy-keys-reply press Enter clipboard reply press Shift+Tab focused button "Copy code" press Shift+Tab focused button "Ran rm -rf /tmp/hermes-proto-work/scratch" press Shift+Tab focused button "Ran ls -la && ls scratch" press Enter press Tab focused button "Copy command" press Tab focused button "Copy output" press Enter clipboard output press Shift+Tab press Shift+Tab focused button "Ran ls -la && ls scratch" press Shift+Tab focused button "Created and edited notes.md 2 steps" press Enter press Tab focused button "Created notes.md +5" press Enter press Tab focused button "Copy changes to /tmp/hermes-proto-work/notes.md" press Enter clipboard created-diff press Tab focused button "Open notes.md" press Tab focused button "More for notes.md" press Tab focused button "Edited notes.md +1 −1" press Enter press Tab focused button "Copy changes to /tmp/hermes-proto-work/notes.md" press Enter clipboard edited-diff press Shift+Tab press Shift+Tab press Shift+Tab press Shift+Tab press Shift+Tab press Shift+Tab press Shift+Tab focused button "More actions" shot copy-keys-request press Enter focused menuitem "Branch from here" press Escape focused button "More actions" press Shift+Tab focused button "Edit message" press Shift+Tab focused button "Copy request" press Enter clipboard request`. `copy-keys-reply.png` shows the reply's row and `copy-keys-request.png` the request's row, each drawn by keyboard focus alone. In a scratch directory, `patch -p1 < created-diff.clip.txt` and then `patch -p1 < edited-diff.clip.txt` give the final `notes.md`.

## Gotchas

- The errand waits at `prompt.submit` and again at the approval, so `wait settled` needs the send and the "Run once" click first.
- The controls are transparent until hover or focus, not hidden, so Tab reaches them. `shot` moves the pointer off the page, so a shot of a settled thread looks as it did before this feature.
- A closed record is `display: none`, and the record controls render only when the step is open. Either one keeps them out of the accessibility tree.
- The errand's diffs name an absolute path, `a//tmp/hermes-proto-work/notes.md`, as Hermes wrote it. `patch -p1` reads it relative to the folder it runs in, so it reaches the real file only from `/` (`patch -p1 -d /`). `git apply` refuses any absolute path. A file inside Hermes's working folder has a relative path, which both tools apply.
- After a press, "Copied" stays on screen for two seconds, so a later `see "Copied"` can match the earlier control. Use `clipboard`, which waits for new clipboard text.
- Two open diffs of the same file carry the same name. `click` needs a unique name, so reach the second one with Tab.
