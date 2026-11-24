# New chat

The New chat button in the top bar, or Ctrl+N (Cmd+N on macOS), opens a new, empty chat in the bot of the chat shown, and the message box takes the keyboard. Opening it asks Hermes nothing. Its first message makes the chat in that bot's profile and runs there, and the chat stays open when Hermes's session list and bot roster refresh. Typing `/new` alone and sending it does the same as the button.

## Sub-features

- `new-chat-button` opens an empty chat in the shown bot from the top bar, with the keyboard in the message box.
- `new-chat-first-message` makes the chat with its first message, once, in the bot's profile, and shows the reply.
- `new-chat-stays` keeps the new chat open after the list and the roster refresh, so a later message goes to it too.
- `new-chat-slash` opens another empty chat for a sent `/new`, and asks Hermes nothing for it.
- `new-chat-key` opens an empty chat with Ctrl+N, on a Hermes that lists no bots, in the socket's own profile.

## How to get to it (user POV)

- Click New chat in the top bar.
- Or press Ctrl+N (Cmd+N on macOS) anywhere in the chat window.
- Or type `/new` in the message box and send it.

## Driving it with highwing-verify

Preconditions:

- `--profiles fixtures/profiles/roster.json` lists six bots. Research's Bot Chat is `local-0001` and holds one reply, "In Let's talk about QAing your". The roster names that chat on every read, so a new chat of Research that a roster read moved would show this reply.
- The gateway makes a new chat `chat-<profile>-<n>` for an untitled `session.create` and answers each message there with `<profile>: <text>`.
- `fixtures/slash.jsonl` has the catalog, so `/new` is listed and runs. Its story is empty and waits for a `prompt.submit`, so nothing but the new chat's turns makes the app read the roster again.
- `said` reads the thread only. `see` and `absent` also match a bot's preview in the sidebar.

- **Button, first message, stays, `/new`.** Run `$H run --fixture fixtures/slash.jsonl --profiles fixtures/profiles/roster.json --run new-chat wait live wait bots click button Research current button Research said "In Let's talk about QAing your" shot bot-chat click button "New chat" wait unstarted current button Research focused textbox "Message Hermes" shot new type "Message Hermes" hello click button Send said "research: hello" shot started called session.create '{"profile":"research","source":"gui","follow_profile_config":true}' 1 reached profiles.list '{}' 2 type "Message Hermes" again click button Send said "research: again" said "research: hello" current button Research shot stayed called prompt.submit '{"profile":"research","session_id":"chat-research-1"}' 2 called prompt.submit '{"session_id":"local-0001"}' 0 type "Message Hermes" /new wait slash-menu press Enter value "Message Hermes" "/new " press Enter wait unstarted focused textbox "Message Hermes" current button Research shot slash-new called session.create '{}' 1 called command.dispatch '{}' 0 quiet`. The second `profiles.list` is the refresh after the first turn. The second message reaching `chat-research-1` shows the chat stayed open through it.
- **Ctrl+N with no bots.** Run `$H run --fixture fixtures/slash.jsonl --run new-chat-key wait live press Control+n wait unstarted focused textbox "Message Hermes" shot new type "Message Hermes" hi click button Send said "default: hi" shot started called session.create '{"source":"gui","follow_profile_config":true}' 1 quiet`. A Hermes that lists no bots makes the chat in the socket's own profile, which the gateway names `default`.

## Gotchas

- `called <method> <json> n` is checked again when the steps end, so it cannot wait for a call the app keeps making, such as `profiles.list` after each turn. `reached` waits for at least n.
- `wait unstarted` passes only while the chat column holds no thread. A chat that has a session, even an empty one, draws one.
- Ctrl+N does nothing while the setup screen covers the chat, because the button it reads is hidden then.
- The composer's Enter picks the highlighted command while the slash menu is open. The first Enter completes `/new `, the second sends it.
