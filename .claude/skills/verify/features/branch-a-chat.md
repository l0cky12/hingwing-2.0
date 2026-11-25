# Branch a chat

The user points at one of their sent messages, chooses "Branch from here", and gets a new chat that holds the conversation through that message's reply. It opens at once with the message's text in its box, focused with the caret at the end, so the user can change it and send. That text is the new chat's draft, so it stays with the chat across a switch, and the Chats list marks the row "Draft". The chat they branched from stays as it was, and its row stays in the Chats list. Hermes titles the new chat next in the lineage ("Notes heading #2"). The button sits beside "Copy request" and "Edit message" on every sent message that has a stored row. It is disabled while a turn runs, while a message waits to be sent, and while the chat is not live. A Hermes that cannot branch is refused in words under the composer, and the open chat does not change.

## Sub-features

- `branch-button` puts "Branch from here" beside "Edit message" on each sent message that has a stored row, and on no message that is still sending.
- `branch-open` opens the new chat at once. Its thread holds the requests and replies through the one branched from, and its box holds that request's text, focused, as the chat's draft.
- `branch-parent` leaves the original chat with all its turns, and lists both chats.
- `branch-title` names the new chat next in the original's lineage, in the top bar and the Chats list.
- `branch-refused` shows "This Hermes can't branch a chat." for a Hermes without branching, keeps the original chat open and its box empty.
- `branch-disabled` disables the button while a turn runs.

## How to get to it (user POV)

- Hover a sent message and press the fork, "Branch from here".

## Driving it with highwing-verify

Preconditions:

- `fixtures/branch.jsonl` and `fixtures/branch-old.jsonl`, written by `python3 fixtures/make_edit_fixtures.py`. Both are the edit chat: three stored turns, rows 1 to 6, titled "Notes heading", with no steps. `branch` says in its header that Hermes branches, so the gateway answers a `session.mutate` branch itself: it copies the stored rows through the row asked for into a new chat of the same profile, and the chat answers a message with `default: <text>`. `branch-old` has no such flag, so the gateway refuses the operation `invalid_params` with no field, as an older Hermes does.
- Every thread has one "Branch from here" per sent message. Use `click-at` and `disabled-at` with the message's number, counting from 1.
- The running-turn check uses `fixtures/edit.jsonl`, whose story holds a two second tool step.

- **Branch from the second message.** Run `$H run --fixture fixtures/branch.jsonl --run branch-a wait live count button "Branch from here" 3 shot branch-before click-at button "Branch from here" 2 see "Notes heading #2" shot branch-opened count heading "Hermes Notes heading #2" 1 said "Rename the heading in notes.md to Plan" said "Add a line about the deadline under it" said 'Added "Due Friday" under the heading.' absent "List the folder" absent "The folder holds" count button "Branch from here" 2 value "Message Hermes" "Add a line about the deadline under it" focused textbox "Message Hermes" press '!' value "Message Hermes" "Add a line about the deadline under it!" called session.mutate '{"operation":"branch","payload":{"through_message_id":4}}' 1 quiet`. The ARIA snapshot `branch-opened.aria.txt` lists the two requests and two replies and the box's text. The typed `!` lands after the text, so the caret was at its end.
- **Return to the original.** Run `$H run --fixture fixtures/branch.jsonl --run branch-b wait live click-at button "Branch from here" 2 see "Notes heading #2" drafts 1 click button "Notes heading" said "List the folder" said "The folder holds" count button "Branch from here" 3 value "Message Hermes" "" shot branch-parent click button "Notes heading #2" said 'Added "Due Friday" under the heading.' absent "List the folder" count button "Branch from here" 2 value "Message Hermes" "Add a line about the deadline under it" called session.mutate '{"operation":"branch"}' 1 quiet`. The Chats list holds both rows, so the click on "Notes heading" opens the original with all three turns and an empty box. `drafts 1` logs the new chat's draft, key `chat:branch-default-1`. `branch-parent.aria.txt` reads `button "Notes heading #2": Notes heading #2 3d Draft`, and picking the new chat again finds the text in its box.
- **A Hermes that cannot branch.** Run `$H run --fixture fixtures/branch-old.jsonl --run branch-c wait live click-at button "Branch from here" 2 see "This Hermes can't branch a chat." shot branch-refused said "List the folder" count button "Branch from here" 3 value "Message Hermes" "" absent "Notes heading #2" drafts 0 called session.mutate '{"operation":"branch"}' 1 quiet`. The thread, the heading and the empty box are the original's.
- **Disabled while a turn runs.** Run `$H run --fixture fixtures/edit.jsonl --run branch-d wait live click-at button "Edit message" 2 type "Message Hermes" "Add a line about the Friday deadline under it" click button "Send" click button "Remove and send" wait tool-running count button "Branch from here" 1 disabled-at button "Branch from here" 1 shot branch-running wait regenerate count button "Branch from here" 2 called session.mutate '{"operation":"branch"}' 0 quiet`. The running turn has no button, because Hermes names its message only in the completion receipt, and the first turn's button is disabled until the reply settles.

## Gotchas

- The branch fixtures have no steps, so a message sent in the original chat would fail the story. Send in the new chat instead: its gateway answers `default: <text>`.
- The fork shows on hover or focus, as Copy and the pencil do. The ARIA snapshot lists it.
- The three actions hang in the margin beside a request, and the request keeps 104px for them. With less, the actions run past the thread and the default 1180px window shows a horizontal scrollbar in a shot.
- The gateway does not read the row beyond checking that the chat has it. Assert the cut with `called ... "through_message_id":4`.
- The window keeps the key it minted for a message until Hermes answers, so a click after a dropped connection sends the same request and gets the same chat. An answer, whether a success or a refusal, makes the next click mint a new key.
- The scripted gateway forgets a branched chat when its run ends. A second run with the same name loses the new chat, and the draft sweep then deletes its draft, as it does for any chat that is gone.
