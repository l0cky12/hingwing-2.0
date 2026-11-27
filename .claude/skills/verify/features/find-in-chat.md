# Find in chat

Ctrl+F opens a find bar at the top right of the thread. Typing marks every match in the open chat, including text inside steps that are closed, messages handed to another bot with their replies, and side questions with their answers. Enter and Shift+Enter step through the matches, and a match in a closed step or group opens it. Escape, from the bar or the thread, shuts the rows find opened that you didn't close and open again, clears the marks and puts focus back in the composer.

## Sub-features

- `find-count` shows nothing for an empty field, "No matches", "N matches" before stepping, and "i of N" after.
- `find-step` moves to the next match with Enter or "Next match" and to the previous with Shift+Enter or "Previous match". Both wrap.
- `find-open` opens the step, and its group, that holds the current match.
- `find-marks` marks matches with the `find` and `find-current` highlights, with no extra elements.
- `find-close` closes with Escape or "Close find", shuts the rows find opened and focuses the composer.
- `find-earlier` says "Searching the loaded part of this chat." with a "Load earlier turns" button while earlier turns are unloaded.

## How to get to it (user POV)

- Press Ctrl+F (Cmd+F on macOS) anywhere in the window while a chat is open.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.

- **Closed step.** Run `$H run --fixture fixtures/errand.jsonl --run find wait live type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled press Control+f type "Find in chat" drwxr press Enter see "1 of 3" marks 3 shot find-open press Escape focused textbox "Message Hermes" marks 0 shot find-closed`. `find-open.aria.txt` holds `button "Ran ls -la && ls scratch" [expanded]` and `status: 1 of 3`. `find-closed.aria.txt` has no `[expanded]`.
- **No match.** Run the same steps up to `press Control+f`, then `type "Find in chat" zzzz see "No matches" marks 0`.
- **Group.** Run the same steps up to `press Control+f`, then `type "Find in chat" sketch see "3 matches" press Shift+Enter see "3 of 3" press Shift+Enter see "2 of 3" shot find-group`. The shot shows the group and its "Edited notes.md" step open with the diff scrolled to the match.
- **A handed message.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/team.json --run find-relay wait live wait bots type "Message Hermes" "Ask @Rae for the weekly report" click button Send said "The weekly report is drafted." press Control+f type "Find in chat" "weekly report" see "2 matches" press Enter see "1 of 2" press Enter see "2 of 2" marks 2 marked "weekly report" shot find-relay quiet`. The first match is in the message, the second in Rae's reply.
- **A side question.** Run `$H run --fixture fixtures/btw.jsonl --timeout 20000 --run find-side wait live type "Message Hermes" "What does notes.md say about the release?" click button Send type "Message Hermes" "/btw why?" click button Send see "Waiting for the answer" type "Message Hermes" "/btw what does this flag do?" click button Send said "It turns on" said "Because the release notes" wait settled said "Which branch is this on?" press Control+f type "Find in chat" "does" see "2 matches" press Enter press Enter see "2 of 2" marked "does" shot find-side-asked type "Find in chat" "release notes" press Enter see "1 of 1" marked "release notes" shot find-side quiet`. The second "does" is in the side question after the turn's request, and "release notes" is in an answer.
- **Escape from the thread.** Run the same steps up to `press Control+f`, then `type "Find in chat" drwxr press Enter see "1 of 3" click button "Ran ls -la && ls scratch" click button "Ran ls -la && ls scratch" focused button "Ran ls -la && ls scratch" press Escape focused textbox "Message Hermes" marks 0 shot refocus-closed`. Escape closes the bar while focus is on the step. `refocus-closed.aria.txt` still shows that step `[expanded]`, because you opened it again yourself.

## Gotchas

- The bar's field and the search landmark need different names. `type` uses an exact label match, so the landmark is "Search this chat" and only the field is "Find in chat".
- `marks` counts ranges across both highlights and reads state. It never sets it.
- Matches in closed steps are marked while the step is hidden. The count includes them, and a hidden mark paints nothing until the step opens.
- `focused` checks `document.activeElement` at that instant, so run it right after the key that moves focus.
