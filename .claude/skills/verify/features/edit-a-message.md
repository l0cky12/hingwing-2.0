# Edit a message

The user fixes a sent message and sends it again, or asks for a different answer to the last one. A pencil beside "Copy request" on every sent message puts its text back in the message box under the line "Editing a sent message" with a Cancel button, and Escape cancels the same way. Sending the edit removes that message and everything after it, in the thread and in Hermes's history, after a dialog that counts the later messages when there are any. "Regenerate" under the last reply sends the same text again with no dialog. Both are disabled while a turn runs or the chat is not live, and a refusal from Hermes shows in words under the composer with the thread unchanged.

## Sub-features

- `edit-start` puts the sent text in the box, focused with the caret at the end, and shows "Editing a sent message".
- `edit-cancel` clears the box and the line, with Escape or the Cancel button, and returns focus to the box.
- `edit-confirm` names the count in a modal dialog ("This removes 1 later message.") with Cancel and "Remove and send". With no later message the edit sends at once.
- `edit-send` cuts the thread before the edited message, then shows the new text as a running turn.
- `regenerate` sends the last message again and replaces its reply.
- `rewrite-disabled` disables "Edit message" and "Regenerate" while a turn runs, and "Regenerate" while an edit is open.
- `rewrite-refused` keeps the draft, the editing line and the thread, and shows Hermes's refusal under the composer.
- `rewrite-compacted` shows "Hermes compacted this part of the chat, so it can't edit this message." for a message from before a compaction, with the thread unchanged.

## How to get to it (user POV)

- Hover a sent message and press the pencil, "Edit message".
- Press "Regenerate" under the last reply.

## Driving it with highwing-verify

Preconditions:

- `fixtures/edit.jsonl`, `fixtures/regenerate.jsonl` and `fixtures/edit-refused.jsonl`, written by `python3 fixtures/make_edit_fixtures.py`. Each chat has three stored turns. The story waits for the `session.mutate` rewind, then for the `prompt.submit`, and plays one reply with a 2 s tool step. `edit` cuts before the second message, `regenerate` before the third, and `edit-refused` refuses any rewind as Hermes does for a row that is gone.
- `fixtures/edit-compacted.jsonl`, from the same script, holds the three turns after Hermes compacted the first. The thread shows no compaction notice, as on Hermes, whose resume leaves the handoff out. Its story refuses a rewind of the first message with Hermes's `compacted:` detail.
- Every thread has one "Edit message" per sent message. Use `click-at` and `disabled-at` with the message's number, counting from 1.

- **Start and cancel.** Run `$H run --fixture fixtures/edit.jsonl --run edit-a wait live click-at button "Edit message" 1 value "Message Hermes" "Rename the heading in notes.md to Plan" see "Editing a sent message" focused textbox "Message Hermes" shot edit-editing press Escape value "Message Hermes" "" absent "Editing a sent message" focused textbox "Message Hermes" shot edit-cancelled quiet`.
- **Dialog and Cancel.** Run `$H run --fixture fixtures/edit.jsonl --run edit-b wait live click-at button "Edit message" 1 type "Message Hermes" "Rename the heading in notes.md to Plan for Friday" click button "Send" see "This removes 2 later messages." shot edit-dialog count button "Cancel" 2 click-at button "Cancel" 2 tally dialog 0 focused textbox "Message Hermes" called prompt.submit {} 0 called session.mutate '{"operation":"rewind"}' 0 quiet`. The second "Cancel" is the dialog's.
- **Remove and send.** Run `$H run --fixture fixtures/edit.jsonl --run edit-c wait live click-at button "Edit message" 2 type "Message Hermes" "Add a line about the Friday deadline under it" click button "Send" see "This removes 1 later message." click button "Remove and send" wait tool-running disabled-at button "Edit message" 1 disabled button "Regenerate" shot edit-running wait regenerate absent "List the folder" absent "The folder holds" shot edit-settled called session.mutate '{"operation":"rewind","payload":{"target_message_id":3}}' 1 called prompt.submit '{"text":"Add a line about the Friday deadline under it"}' 1 quiet`.
- **Refused.** Run `$H run --fixture fixtures/edit-refused.jsonl --run edit-d wait live click-at button "Edit message" 2 type "Message Hermes" "Add a line about the Friday deadline under it" click button "Send" click button "Remove and send" see "That message is no longer in this chat." shot edit-refused see "The folder holds" called prompt.submit {} 0 quiet`. The draft and "Editing a sent message" stay.
- **Compacted.** Run `$H run --fixture fixtures/edit-compacted.jsonl --run edit-g wait live absent "Renamed the heading in notes.md to Plan." click-at button "Edit message" 1 type "Message Hermes" "Rename the heading in notes.md to Goals" click button "Send" click button "Remove and send" see "Hermes compacted this part of the chat, so it can't edit this message." shot edit-compacted absent "That message is no longer in this chat." see "The folder holds" called session.mutate '{"operation":"rewind","payload":{"target_message_id":1}}' 1 called prompt.submit {} 0 quiet`. The draft and "Editing a sent message" stay.
- **Regenerate.** Run `$H run --fixture fixtures/regenerate.jsonl --run regenerate-e wait live click button "Regenerate" wait tool-running disabled button "Regenerate" wait regenerate see "Here is the folder" absent "The folder holds" called session.mutate '{"operation":"rewind","payload":{"target_message_id":5}}' 1 called prompt.submit '{"text":"List the folder"}' 1 quiet`.
- **Regenerate refused.** Run `$H run --fixture fixtures/edit-refused.jsonl --run regenerate-f wait live click button "Regenerate" see "That message is no longer in this chat." see "The folder holds" called prompt.submit {} 0 quiet`.

## Gotchas

- `wait settled` matches the Done ring of any turn, so it passes at once in a thread that already holds a settled turn. Use `wait regenerate`, which is visible only when the chat is idle and its last turn has a stored message.
- The pencil shows on hover or focus, as the Copy button does, so a shot taken with the pointer off the page does not show it. The ARIA snapshot lists it.
- The gateway does not check which row the rewind names. Each fixture's story is written for one row, and a run that edits another still passes the gateway. Assert the row with `called`.
- A turn that is running has no "Edit message" until it settles, because Hermes names its message only in the completion receipt.
