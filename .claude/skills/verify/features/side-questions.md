# Side questions

The user types `/btw <question>` and sends it, also while a turn runs. A card headed "Side question" opens above the message box with the question and "Waiting for the answer", and Hermes's answer replaces that line, drawn with the same Markdown as a reply. The answer never enters the thread, and the running turn goes on as it would have. Several cards stack oldest first, so the newest sits nearest the box, and each one finds its own answer whatever order the answers arrive in. Each card has a close button, and Escape in the box closes the newest card. A quiet line on every card says "Not part of the chat." A `/bg` prompt draws the same card headed "Background prompt". An answer to a side question this window never asked, as when another client asks one in the same chat, gets a card too, headed with the question Hermes repeats.

## Sub-features

- `sides-ask` sends a typed `/btw` line as `prompt.btw` with the words alone, and opens a waiting card, also mid-turn.
- `sides-answer` puts the answer on the card of its own `task_id`, in either order, and leaves the thread as it was.
- `sides-close` removes a card with its close button and returns focus to the box.
- `sides-escape` closes the newest card with Escape in the box, when the slash menu or an edit does not take the Escape.
- `sides-elsewhere` draws an answer to a question another client asked, with Hermes's copy of the question.
- `sides-failed` shows Hermes's error words in the error color, with the question kept.
- `sides-lost` says "The answer was missed while the chat reconnected." for a card that was waiting when the chat was read again.

## How to get to it (user POV)

- Type `/btw` and a question in the "Message Hermes" box, and press Send.
- Read the answer in the card above the box. Click its × or press Escape in the box to close it.

## Driving it with highwing-verify

Preconditions:

- `fixtures/btw.jsonl`, written by `fixtures/make_btw_fixture.py` from `fixtures/commands.jsonl`. It is derived, not recorded. Its first turn runs for about 5 s after the first `agent.step`. It waits for `prompt.btw` "why?" and then "what does this flag do?", answers the second one first, finishes the turn, and then sends an answer for `btw_elsewhere`, a question nobody in this window asked.
- Send the first message before any `/btw`. The story waits for `prompt.submit` first and stalls on any other call.

- **Whole story.** Run `$H run --fixture fixtures/btw.jsonl --timeout 20000 --run btw wait live type "Message Hermes" "What does notes.md say about the release?" click button Send shot before type "Message Hermes" "/btw why?" click button Send see "Waiting for the answer" count region "Side question" 1 shot waiting type "Message Hermes" "/btw what does this flag do?" click button Send see "It turns on" see "Because the release notes" count region "Side question" 2 shot answered called prompt.btw '{"text":"why?"}' 1 called prompt.btw '{"text":"what does this flag do?"}' 1 click-at button "Close side question" 1 count region "Side question" 1 absent "Because the release notes" focused textbox "Message Hermes" wait settled see "Which branch is this on?" count region "Side question" 2 shot elsewhere press Escape count region "Side question" 1 absent "Which branch is this on?" shot closed quiet`. `waiting.aria.txt` holds the thread's request and "Thinking" beside `region "Side question"` with the question and "Waiting for the answer". `answered.aria.txt` holds two regions, each with its own answer, and the thread's outline as in `before.aria.txt`.
- **Slash menu over the cards.** Run `$H run --fixture fixtures/btw.jsonl --timeout 20000 --run btw-menu wait live type "Message Hermes" "What does notes.md say about the release?" click button Send type "Message Hermes" "/btw why?" click button Send see "Waiting for the answer" type "Message Hermes" "/b" wait slash-menu shot menu-over-cards press Escape count region "Side question" 1`. The list opens just above the box, over the card, and Escape closes the list and leaves the card.
- **Forced colors.** Add `--forced-colors` to the whole story and look at `answered.png`. Each card keeps a visible border.

## Gotchas

- Do not press Escape before sending a `/btw` line. The slash menu is open only while the box holds `/` and a name with no space, so `type` with a whole line never opens it, and the Escape closes the newest card.
- `count region "Side question"` counts the open cards. A closed card stays closed when its answer arrives later.
- `fixtures/btw.jsonl` holds no failed or lost answer. `sides-failed` and `sides-lost` are covered by `apps/desktop/test/sides.test.tsx`, not by a live run.
- Closed cards are kept per chat in the renderer, so a card closed in one chat stays closed after a switch to another chat and back. No recipe here switches chats yet.
