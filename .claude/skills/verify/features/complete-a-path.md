# Complete a path

The user types `@` and a few letters in the message box and the files and folders of the chat's working folder that start with them open in the same list the bots use, under a group named "Files" after "Bots". Each row shows the name in the mono face and the folder it sits in, as `./` or `./archive/`. A line under the list says `in <folder>`. Enter or Tab puts the plain path and a space in the box, in quotes when the path holds a space, and the message that is sent holds that path and nothing else. A folder row puts `@notebooks/` in the box with the caret still in the word, and the list goes on into that folder. Hermes is asked once the word has held still for a moment, and an answer for a word typed past is dropped. A Hermes that does not serve the call, or a chat with no session yet, lists bots alone.

## Sub-features

- `path-open` opens the "Mentions" listbox with the group "Files" for an `@` and letters that match a file or folder.
- `path-bots-first` lists the group "Bots" before "Files" when both match.
- `path-complete` replaces the `@` word with the path and a space, with Tab or Enter, and closes the list.
- `path-quote` wraps a path that holds a space in double quotes.
- `path-folder` leaves a folder as `@folder/` with no space and lists that folder's contents next.
- `path-address` opens nothing for an `@` inside a word, as in `sam@example`.
- `path-send` sends the plain path in `prompt.submit`, with no `@` and no quotes.
- `path-folder-line` shows `in <folder>` under a list that has files.
- `path-unsupported` lists no files on a Hermes with no `complete.path`.

## How to get to it (user POV)

- Type `@` and the start of a file or folder name in the "Message Hermes" box of a chat that has a session, at the start of the text or after a space.

## Driving it with highwing-verify

Preconditions:

- `--paths fixtures/paths/notes.json` makes the gateway answer `complete.path` from its `words` and gives the chat the folder `/home/sam/errands`. `@not` lists `notes.md`, `archive/notes-2024.md` and the folder `notebooks/`, after a profile row that Highwing leaves out. `@notebooks/` lists two files. `@sa` lists `sample.txt` and `@My` lists `My Notes.md`. A word it does not list answers no rows.
- Without `--paths` the gateway answers `complete.path` with -32601, as a Hermes without it does.
- A `--fixture` run keeps the box's draft for the next run of the same name. Use a new `--run` name, or `$H cleanup --run <name>` first.

- **Open, shot and complete.** Run `$H run --fixture fixtures/errand.jsonl --paths fixtures/paths/notes.json --run complete-path wait live type "Message Hermes" "Rename the heading in @not" wait mentions tally option 3 count group Files 1 count option notes.md 1 count option archive/notes-2024.md 1 count option notebooks/ 1 see "in /home/sam/errands" shot path-menu press Enter value "Message Hermes" "Rename the heading in notes.md " tally listbox 0 quiet`. `path-menu.aria.txt` shows `listbox "Mentions"` holding `group "Files"` holding the three options, and the paragraph `in /home/sam/errands` under it.
- **A folder.** Run `$H run --fixture fixtures/errand.jsonl --paths fixtures/paths/notes.json --run complete-path-folder wait live type "Message Hermes" "Open @not" wait mentions click option notebooks/ value "Message Hermes" "Open @notebooks/" tally option 2 count option notebooks/plan.md 1 count option notebooks/ideas.md 1 shot path-folder press ArrowDown press Enter value "Message Hermes" "Open notebooks/ideas.md " tally listbox 0 quiet`. The list stays open after the folder row and then holds that folder's two files.
- **A name with a space.** Run `$H run --fixture fixtures/errand.jsonl --paths fixtures/paths/notes.json --run complete-path-quote wait live type "Message Hermes" "Open @My" wait mentions count option "My Notes.md" 1 press Enter value "Message Hermes" 'Open "My Notes.md" ' quiet`.
- **An address.** Run `$H run --fixture fixtures/errand.jsonl --paths fixtures/paths/notes.json --run complete-path-address wait live type "Message Hermes" "mail me at sam@example" tally listbox 0 value "Message Hermes" "mail me at sam@example" quiet`.
- **Send.** Run `$H run --fixture fixtures/errand.jsonl --paths fixtures/paths/notes.json --run complete-path-send wait live type "Message Hermes" "Rename the heading in @not" wait mentions press Enter click button Send called prompt.submit '{"text":"Rename the heading in notes.md"}' 1 value "Message Hermes" "" quiet`. `called` compares the whole text, so the one call shows the gateway received the plain path with no `@` and no quotes.
- **Bots and files together.** Run `$H run --fixture fixtures/errand.jsonl --paths fixtures/paths/notes.json --profiles fixtures/profiles/team.json --run complete-path-bots wait live wait bots type "Message Hermes" "Ask @sa" wait mentions tally option 2 count group Bots 1 count group Files 1 shot path-bots quiet`. `path-bots.aria.txt` lists `group "Bots"` with `option "Sam"` before `group "Files"` with `option "sample.txt"`.
- **A Hermes without the call.** Run `$H run --fixture fixtures/errand.jsonl --run complete-path-none wait live type "Message Hermes" "Rename the heading in @not" tally listbox 0 value "Message Hermes" "Rename the heading in @not" quiet`.

## Gotchas

- The list of bots opens at once and the files arrive about 120 ms later, so `wait mentions` can pass before the Files group is there. `tally option <n>` polls for the count, so put it before `count group Files`.
- `tally listbox 0` right after typing can pass before the files arrive, so it proves "no list" only where no `--paths` word matches.
- A folder row keeps the caret in the word and the old rows stay, dimmed, until the new list arrives, so the list does not close between them. Enter, Tab and a click do nothing on a dimmed row. The scripted gateway answers at once, so the recipes do not show the dimmed rows. `apps/desktop/test/menu.test.ts` covers them.
- The unit test for a late answer for an older word is `apps/desktop/test/paths.test.ts`. The scripted gateway answers at once, so the recipes cannot make one arrive late.
- `type` replaces the box's text and leaves the caret at its end. Use `press` for each further character, as a user types.
