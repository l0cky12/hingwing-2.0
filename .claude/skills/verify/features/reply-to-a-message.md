# Reply to a message

The user answers one message in particular. "Reply", right after "Copy request" on every sent message and after "Copy reply" under every settled reply, puts a quote of that message in a chip at the top of the composer card. The chip shows the quote on one line, ending in an ellipsis when it is long, and has a "Remove quote" button. While it is there, the empty box says "Reply…". Send puts the quote ahead of the text in the shape Hermes's own gateway gives a platform reply, `[Replying to your previous message: "…"]` for a quote of Hermes and `[Replying to: "…"]` for a quote of your own message, then clears the chip. A sent message that carries a quote shows it as a muted block above its words, after a reload too. The quote is part of the draft, so it stays across a chat switch and a restart. "Edit message" on a message that carries a quote puts the quote back in the chip and only the words in the box.

## Sub-features

- `reply-chip` shows the quote in the composer card, focuses the box, and changes the placeholder to "Reply…".
- `reply-send-hermes` sends `[Replying to your previous message: "<reply>"]\n\n<text>` for a quote of Hermes's reply, then clears the chip.
- `reply-send-yours` sends `[Replying to: "<request>"]\n\n<text>` for a quote of your own message.
- `reply-remove` clears the chip with "Remove quote", and the next send carries no quote.
- `reply-shown` draws the quote as a block above the words of a sent message, and never the raw `[Replying to` line.
- `reply-edit` splits a quoted message on "Edit message": the chip holds the quote, the box holds the words, and the edit sends them framed again. Cancel clears both.
- `reply-kept` keeps the chip across a restart, as a draft.
- `reply-command` sends a slash command from the catalog as typed and leaves the chip held, because a quote ahead of it would make Hermes read it as a prompt.
- `reply-find` counts the quoted message's stored text, so find marks the words after the quote, and a match inside the quote marks the whole quote block.

## How to get to it (user POV)

- Hover a sent message or a settled reply and press "Reply", the curved arrow right after Copy.
- Press the x in the chip, "Remove quote", to drop it.

## Driving it with highwing-verify

Preconditions:

- `fixtures/reply.jsonl`, `fixtures/reply-mine.jsonl`, `fixtures/reply-unquoted.jsonl` and `fixtures/reply-edit.jsonl`, written by `python3 fixtures/make_edit_fixtures.py`. Each chat holds four stored turns. The fourth request already replies to the third reply ("The folder holds `notes.md` and a `scratch` folder."). The first three wait for a `prompt.submit` and play one reply with a 2 s tool step. Their recorded text is the one each recipe sends, so the stored turn after the reply matches what was typed. `reply-edit` cuts before the fourth request first.
- Every turn has two "Reply" buttons, the request's and the reply's, so in page order the request of turn n is `2n - 1` and its reply is `2n`. Use `click-at`.
- `called` compares the whole `text`, so `'{"text":"Delete it then."}'` fails on a text that carries a quote.

- **Reply to Hermes.** Run `$H run --fixture fixtures/reply.jsonl --run reply-a wait live click-at button "Reply" 8 count group "Replying to" 1 placeholder "Message Hermes" "Reply…" focused textbox "Message Hermes" shot reply-chip type "Message Hermes" "Delete it then." click button "Send" called prompt.submit '{"text":"[Replying to your previous message: \"The scratch folder is empty.\"]\n\nDelete it then."}' 1 count group "Replying to" 0 placeholder "Message Hermes" "What’s next?" wait tool-running shot reply-running said "Deleted the empty scratch folder." wait regenerate absent "Replying to your previous message" shot reply-sent quiet`. `reply-sent.png` shows "The scratch folder is empty." as a block above "Delete it then.".
- **Reply to yourself.** Run `$H run --fixture fixtures/reply-mine.jsonl --run reply-b wait live click-at button "Reply" 1 count group "Replying to" 1 placeholder "Message Hermes" "Reply…" focused textbox "Message Hermes" shot reply-mine-chip type "Message Hermes" "Use Goals instead." click button "Send" called prompt.submit '{"text":"[Replying to: \"Rename the heading in notes.md to Plan\"]\n\nUse Goals instead."}' 1 called prompt.submit '{"text":"[Replying to your previous message: "}' 0 count group "Replying to" 0 said "The heading now reads" wait regenerate absent "Replying to:" shot reply-mine-sent quiet`.
- **Remove quote.** Run `$H run --fixture fixtures/reply-unquoted.jsonl --run reply-c wait live click-at button "Reply" 8 count group "Replying to" 1 shot reply-remove-before click button "Remove quote" count group "Replying to" 0 placeholder "Message Hermes" "What’s next?" focused textbox "Message Hermes" type "Message Hermes" "Delete it then." click button "Send" called prompt.submit '{"text":"Delete it then."}' 1 said "Deleted the empty scratch folder." wait regenerate shot reply-removed quiet`.
- **Edit a reply.** Run `` $H run --fixture fixtures/reply-edit.jsonl --run reply-d wait live click-at button "Edit message" 4 see "Editing a sent message" value "Message Hermes" "What is in scratch?" count group "Replying to" 1 placeholder "Message Hermes" "Reply…" focused textbox "Message Hermes" shot reply-edit-split type "Message Hermes" "What is in scratch, and how big is it?" click button "Send" called session.mutate '{"operation":"rewind","payload":{"target_message_id":7}}' 1 called prompt.submit '{"text":"[Replying to your previous message: \"The folder holds `notes.md` and a `scratch` folder.\"]\n\nWhat is in scratch, and how big is it?"}' 1 count group "Replying to" 0 absent "Editing a sent message" said "so it takes no space" wait regenerate absent "Replying to your previous message" shot reply-edit-sent quiet ``. With no later message the edit sends at once.
- **Cancel an edit of a reply.** Run `$H run --fixture fixtures/reply-edit.jsonl --run reply-e wait live click-at button "Edit message" 4 count group "Replying to" 1 press Escape value "Message Hermes" "" count group "Replying to" 0 absent "Editing a sent message" click-at button "Reply" 8 click-at button "Edit message" 1 value "Message Hermes" "Rename the heading in notes.md to Plan" count group "Replying to" 0 called prompt.submit {} 0 quiet`. An edit of a message with no quote drops a quote the chip held.
- **Kept across a restart.** Run `$H cleanup --run reply-restart`, then `$H run --fixture fixtures/reply.jsonl --run reply-restart wait live click-at button "Reply" 8 drafts 1 relaunch wait live count group "Replying to" 1 placeholder "Message Hermes" "Reply…" shot reply-restart click button "Remove quote" drafts 0 quiet`.
- **Find.** Run `` $H run --fixture fixtures/reply.jsonl --run reply-find wait live press Control+f type "Find in chat" "What is in" press Enter see "1 of 1" marks 1 marked "What is in" type "Find in chat" 'holds `notes.md`' press Enter see "1 of 1" marks 1 marked 'The folder holds `notes.md` and a `scratch` folder.' shot reply-find quiet ``.
- **Slash command.** Run `$H run --fixture fixtures/commands.jsonl --acted-elsewhere --timeout 20000 --run reply-command wait live type "Message Hermes" "What does notes.md say about the release?" click button Send said "notes.md lists three tasks" gone button Stop type "Message Hermes" "Then outline docs/plan.md." click button Send said "docs/plan.md has two parts" gone button Stop count button "Reply" 4 click-at button "Reply" 4 count group "Replying to" 1 type "Message Hermes" "/btw Which file holds the plan?" click button Send called prompt.btw '{"text":"Which file holds the plan?"}' 1 said "The plan is in docs/plan.md." count group "Replying to" 1 placeholder "Message Hermes" "Reply…" shot reply-command quiet`.
- **Dark.** Add `--theme dark` to the Reply to Hermes recipe, with its own `--run` name, to shoot the chip and the quote block in the dark palette.

## Gotchas

- The quote is the message's Markdown source, the same text Copy takes, so the chip and the quote block show backticks where the reply draws code.
- A quote of a running turn is not offered: the reply's "Reply" shows only where its "Copy reply" does.
- Only a command the slash catalog knows goes without the quote. Any other text that starts with `/`, such as a path, goes with it.
- A group chat's composer never shows the chip.
- The placeholder is not in the ARIA snapshot. Use the `placeholder` step.
