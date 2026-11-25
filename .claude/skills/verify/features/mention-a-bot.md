# Mention a bot

The user types `@` in the message box and a list of the other bots opens above it, each row with the bot's avatar, its name and what it is for. Typing narrows the list to the bots whose name or id starts with the typed text. Enter or Tab puts `@Rae ` in the box, or `@"Timothy · CEO" ` for a name with a space. Sending a message that names another bot hands it to that bot and not to the chat's own bot. The message shows in the thread with a group named for the bot under it. The group says "Waiting for Rae" until the one reply comes back, and then shows the reply. A bot that is offline, a refusal or 25 minutes with no reply shows in words there, and the message stays sent. A Hermes that cannot hand a message to another bot opens no list, and `@Rae` is plain text.

## Sub-features

- `mention-open` opens the "Mentions" listbox, with the group "Bots", for an `@` at the start of a word.
- `mention-narrow` keeps only the bots whose name or id starts with what follows the `@`.
- `mention-complete` replaces the `@` word with the mention and a space, with Tab or Enter.
- `mention-mid-text` reads the `@` word the caret is in, not only the end of the text.
- `mention-escape` closes the list until the text changes, and the list hides while the box has no focus.
- `mention-address` opens nothing for an `@` inside a word, as in `sam@example`.
- `mention-send` calls `bot_relay.deliver` for the named bot's profile, and sends no `prompt.submit`.
- `mention-waiting` shows "Waiting for Rae" under the sent message until the reply comes.
- `mention-reply` shows the reply as Markdown in a group named for the bot.
- `mention-offline` shows "Sam is offline, so it didn't get your message." for a bot that is not running.
- `mention-unsupported` opens no list on a Hermes with no `bot_relay.deliver`.

## How to get to it (user POV)

- Type `@` in the "Message Hermes" box, at the start or after a space, in any chat of a Hermes that lists more than one bot.

## Driving it with highwing-verify

Preconditions:

- `--profiles fixtures/profiles/team.json` gives the scripted gateway three bots: Ada as the default bot, Sam ("Finds and fixes bugs") and Rae ("Writes the weekly report"). Its `relay` key makes Rae answer a handed message after 1500 ms and Sam refuse it as not running.
- `--profiles fixtures/profiles/roster.json` has no `relay` key, so its gateway answers `bot_relay.deliver` with -32601, as a Hermes without the bot relay does.

- **Open, complete, send and reply.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/team.json --run mention-rae wait live wait bots type "Message Hermes" "Ask @Ra" wait mentions count group Bots 1 count option Rae 1 tally option 1 shot mention-menu press Enter value "Message Hermes" "Ask @Rae " tally listbox 0 press f press o press r click button Send see "Waiting for Rae" wait relay-waiting shot mention-waiting called bot_relay.deliver '{"profile":"rae","message":"Ask @Rae for"}' 1 said "The weekly report is drafted." count group Rae 1 value "Message Hermes" "" called prompt.submit '{}' 0 pinned shot mention-answered quiet`. `mention-menu.aria.txt` shows `listbox "Mentions"` holding `group "Bots"` holding `option "Rae"`. `mention-waiting.aria.txt` shows `group "Rae"` holding `status: Waiting for Rae`. `mention-answered.aria.txt` shows the reply in that group. The one `bot_relay.deliver` aimed at `rae` and no `prompt.submit` show the message went to Rae alone.
- **Offline, after a turn.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/team.json --run mention-offline wait live wait bots type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled type "Message Hermes" "@" wait mentions tally option 2 press ArrowDown press ArrowUp press ArrowUp press Tab value "Message Hermes" "@Rae " press Backspace press Backspace press Backspace press Backspace press S wait mentions press Enter value "Message Hermes" "@Sam " press h press i click button Send said "Sam is offline, so it didn't get your message." count group Sam 1 called bot_relay.deliver '{"profile":"sam"}' 1 called prompt.submit '{}' 1 pinned shot mention-offline quiet`. The list holds Sam and Rae and not Ada, the bot of the open chat. Down, Up and Up wrap to Rae. The shot shows the handed message under the settled errand, and the one `prompt.submit` is the errand's.
- **An address, Escape and focus.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/team.json --run mention-address wait live wait bots type "Message Hermes" "mail me at sam@example" tally listbox 0 value "Message Hermes" "mail me at sam@example" type "Message Hermes" "Ask @Sa" wait mentions press Escape tally listbox 0 value "Message Hermes" "Ask @Sa" press m wait mentions press Shift+Tab tally listbox 0 quiet`.
- **Mid-text.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/team.json --run mention-mid wait live wait bots type "Message Hermes" "Ask  about the build" press Home press ArrowRight press ArrowRight press ArrowRight press ArrowRight press @ wait mentions tally option 2 press S tally option 1 press Enter value "Message Hermes" "Ask @Sam about the build" tally listbox 0 quiet`. The pick keeps the space that was already there and adds no second one.
- **A Hermes without the bot relay.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run mention-none wait live wait bots type "Message Hermes" "Ask @" tally listbox 0 press R tally listbox 0 value "Message Hermes" "Ask @R" called bot_relay.deliver '{}' 1 shot mention-none quiet`. The one `bot_relay.deliver` is the question Highwing asks each new socket, with no params.
- **Forced colors.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/team.json --forced-colors --run mention-forced wait live wait bots type "Message Hermes" "@" wait mentions shot menu press Enter press h press i click button Send said "Sam is offline" shot offline quiet`. Each avatar in the list and in the thread has a `CanvasText` border.

## Gotchas

- `called bot_relay.deliver '{}' <n>` counts the question Highwing asks each new socket as well, because `{}` matches every call. Name the profile to count deliveries only.
- Rae's reply comes 1500 ms after Send. `wait relay-waiting` before a shot proves the shot shows the waiting moment.
- A handed message is not a turn. `wait settled` does not see it, and Stop does not show for it.
- The handed messages live in Electron main for as long as the connection does. They are not in Hermes's history of the chat, so a restart of the app shows the chat without them.
- The list offers every listed bot but the open chat's own. In Ada's chat `@Ada` opens no list and is sent as plain text.
- `type` replaces the box's text and leaves the caret at its end. Use `press` with arrow keys to move the caret.
