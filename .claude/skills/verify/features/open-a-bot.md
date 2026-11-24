# Open a bot

Clicking a bot in the sidebar opens that bot's chat in the chat column. A message sent there runs as that bot, in its Hermes profile. Clicking another bot and coming back shows the same chat with everything said in it. A bot that has no chat yet opens an empty one, and its first message makes the chat. At launch the default bot's chat is open and Highwing creates nothing. On a Hermes too old to switch bots, a click changes nothing and one line under the list says why.

## Sub-features

- `open-bot` opens the clicked bot's Bot Chat with what it already holds, and selects the bot.
- `open-runs-as` sends a message in the open chat as that chat's bot.
- `open-returns` returns to the same chat, with its replies, after a visit to another bot.
- `open-unstarted` opens an empty chat for a bot that has none, and creates nothing on a click.
- `open-first-message` makes the bot's chat with the first message, once, and keeps what is typed meanwhile.
- `open-launch` opens the default bot's chat at launch and creates nothing.
- `open-refused` keeps the open chat and says why on a Hermes that cannot switch bots.
- `open-remote` switches bots on a Hermes on another machine.

## How to get to it (user POV)

- Click a bot in the Bots column at the left of the window.
- Or move to a bot with Tab and press Enter.

## Driving it with highwing-verify

Preconditions:

- `--profiles fixtures/profiles/roster.json` lists six bots. Research's Bot Chat is `local-0001` and holds one reply, "In Let's talk about QAing your". The bot shown as Hermes is the profile `hermes-dev` and has no Bot Chat. The default bot Emu is the profile `default`, and its Bot Chat is the fixture's story.
- A Bot Chat answers a message with `<profile>: <text>`. The profile is the one the message was sent for, so the reply names the bot the message ran as.
- `said` reads the thread only. `see` would also match a bot's preview in the sidebar.

- **Open, run as, return.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run open-bot wait live wait bots current button "Emu, default bot" shot launch click button Research current button Research said "In Let's talk about QAing your" shot opened type "Message Hermes" hello click button Send said "research: hello" shot sent called prompt.submit '{"profile":"research","session_id":"local-0001","text":"hello"}' 1 click button "Emu, default bot" current button "Emu, default bot" absent "research: hello" shot away click button Research current button Research said "research: hello" shot back called session.resume '{"profile":"research"}' 1 called session.create '{}' 0 quiet`. One `session.resume` for Research over two visits shows the second visit is the same chat, still attached.
- **A bot with no chat.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run open-unstarted wait live wait bots click button Hermes current button Hermes enabled button Send shot unstarted click button Research current button Research click button Hermes current button Hermes called session.list '{"profile":"hermes-dev","title":"Bot Chat","include_hidden":true}' 2 called session.create '{}' 0 quiet`. Each click looks the chat up by its title, and none creates one.
- **The first message makes the chat.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run open-first-message wait live wait bots click button Hermes current button Hermes type "Message Hermes" one press Enter type "Message Hermes" two wait live press Enter said "hermes-dev: one" said "hermes-dev: two" shot started called session.create '{"profile":"hermes-dev","title":"Bot Chat","hidden":true,"follow_profile_config":true}' 1 called session.create '{}' 1 called prompt.submit '{"profile":"hermes-dev","session_id":"bot-chat-hermes-dev"}' 2 quiet`. The second message is typed while the first is on its way, and both land in the one chat.
- **Launch creates nothing.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --no-bot-chat --run open-launch wait bots wait live current button "Emu, default bot" shot launch called session.create '{}' 0 called session.resume '{}' 0 quiet`. Then run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --no-bot-chat --run open-launch-message wait bots wait live type "Message Hermes" hello click button Send said "default: hello" shot started called session.create '{"profile":"default","title":"Bot Chat"}' 1 quiet`.
- **A Hermes that cannot switch bots.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --bound --run open-refused wait live wait bots type "Message Hermes" @request click button Send wait approval click button Research see "This Hermes can't switch bots from Highwing yet." wait approval said "In /tmp/hermes-proto-work" shot refused called session.list '{"title":"Bot Chat"}' 0 called session.resume '{}' 1 quiet`. The approval card is still there after the click, and Hermes was asked nothing.
- **On another machine.** Run the first recipe, then `$H run --fake-host ok --fixture /tmp/highwing-verify/open-bot/fixture-edited.jsonl --saved remote --run open-remote wait live wait bots click button Research current button Research type "Message Hermes" hello click button Send said "research: hello" shot remote quiet`. The app reaches the fake machine through its real ssh dial and the ticket `hermes gateway tickets --serve` mints. With `--fake-host ok-bound` and `--run open-remote-bound`, replace the steps after `wait bots` with `click button Research see "This Hermes can't switch bots from Highwing yet." wait live shot remote-bound quiet`.

## Gotchas

- `called <method> <json> 0` is checked again when the steps end, so it cannot say "none yet" in a run that makes the call later. Use one run for "none" and another for "one".
- The composer sends one message at a time. Enter does nothing while a send is on its way, so put `wait live` between typing a second message and pressing Enter.
- A Bot Chat's reply and its sidebar preview do not affect each other. The previews come from the fixture header.
- `--fake-host` runs write no `gateway-calls.jsonl`, so `called` works in `--fixture` runs only.
- `--bound` and `--no-bot-chat` edit the fixture, so they do nothing with `--fake-host`. Use the scenario `ok-bound` there.
