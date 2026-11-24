# Chat list

The Chats column, between the bots and the chat, lists the chats of the open chat's bot, newest first, under the bot's name. Each row is a button named by the chat's title. It shows when the chat was last used, and "Working" or "Waiting for your OK" while the chat runs or waits on an approval, in place of its preview. A click opens that chat, and the top bar's heading names it as its bot and title. A bot with no chats says "No chats yet." The column follows the open chat to another bot, and is hidden below 928 px of window width.

## Sub-features

- `chat-list-rows` lists a bot's chats by title when the bot is opened.
- `chat-list-open` opens a chat picked from the list, marks its row current, and shows its thread.
- `chat-list-asking` says "Waiting for your OK" on the row of a chat that waits on an approval while another chat is open.
- `chat-list-runs-in` runs a message in a picked chat as its bot, in that chat's session, and leaves the other chats as they were.
- `chat-list-heading` names the open chat in the top bar's heading.
- `chat-list-empty` says "No chats yet." for a bot with no chats, with the New chat button still in the top bar.

## How to get to it (user POV)

- Click a bot in the Bots column. Its chats show in the Chats column.
- Click a chat's row, or move to it with Tab and press Enter.

## Driving it with highwing-verify

Preconditions:

- `--profiles fixtures/profiles/chats.json` is `roster.json` with no Bot Chat for Research, plus a `chats` key that seeds Research with three chats, newest first: "Send invoice reminder" (`local-0101`), which waits on an approval, "Sort the invoices" (`local-0102`) and "Clean up Downloads" (`local-0103`). Each holds one request and one reply. The bot shown as Hermes, the profile `hermes-dev`, has no chats.
- A chat answers a message with `<profile>: <text>`, so the reply names the bot the message ran as. `called prompt.submit` names the session it ran in.
- `said` reads the thread only. `see` also matches the Chats column.

- **List, open, waiting, run in, return, heading, empty.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/chats.json --run chat-list wait live wait bots click button Research current button Research count button "/^(Send invoice reminder|Sort the invoices|Clean up Downloads)$/" 3 shot listed click button "Sort the invoices" current button "Sort the invoices" said "Sorted fourteen invoices by due date" see "Waiting for your OK" count heading "Hermes Research · Sort the invoices" 1 shot picked type "Message Hermes" hello click button Send said "research: hello" shot sent called prompt.submit '{"profile":"research","session_id":"local-0102","text":"hello"}' 1 click button "Send invoice reminder" current button "Send invoice reminder" said "Email Acme a reminder about invoice 1042." wait approval absent "research: hello" count heading "Hermes Research · Send invoice reminder" 1 shot first click button "Sort the invoices" current button "Sort the invoices" said "research: hello" said "Sort the invoices in the inbox folder by due date." click button Hermes current button Hermes see "No chats yet." enabled button "New chat" count heading "Hermes Hermes" 1 shot empty called session.create '{}' 0 quiet`. `listed.aria.txt` holds the three rows under `navigation "Chats"`. "Waiting for your OK" is seen while "Sort the invoices" is open, so it is the row's words, not the open chat's. `called session.create '{}' 0` shows that no click made a chat.
- **Narrow window.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/chats.json --size 927x700 --run chat-list-narrow wait live wait bots click button Research current button Research gone navigation Chats shot narrow quiet`. With `--size 928x700` the column shows.

## Gotchas

- An ARIA snapshot does not print `aria-current`. Use `current button "<title>"`.
- A row's name is its title alone. The ARIA snapshot prints the rest of the row after the name: the time, then the state words or the preview.
- The seeded approval is never answered. The gateway has no handler for a seeded chat's `approval.respond`.
- The time on each row is counted from the machine's clock, so a seeded chat reads some days old.
- The Chats column is hidden below 928 px, so a run with a narrower `--size` has no `navigation "Chats"`.
