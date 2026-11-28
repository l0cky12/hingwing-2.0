# Approval mode

In the composer's toolbar, after the paperclip and the microphone, a quiet menu button with a shield names how Hermes treats this chat's risky commands: "Manual", "Smart" or "Off". Its text content, which `see` matches, and its accessible name read "Manual approvals", "Smart approvals" or "Approvals Off". It opens a menu named "Approvals" above it, of three `menuitemradio` items, "Manual", "Smart" and "Off", the current one checked, each described by one line on what it does. Manual or Smart is sent at once. Off first asks "Turn off approvals for this bot?", and nothing reaches Hermes until "Turn off". The button reads the new mode only once Hermes answers with it, and a reply that names no mode leaves it as it was. Hermes starts a bot on Smart: it runs the commands its judge finds safe and asks about risky ones.

The mode is the bot's, so it changes every chat with that bot. A chat can also have YOLO of its own, turned on by `/yolo` or another client, which runs that chat without asking whatever the bot's mode. The toolbar has no YOLO button: such a chat reads "Approvals Off" with Off checked. Picking Manual or Smart there turns the chat's own YOLO off too, and sends the mode first only when the bot is not on it already. The menu is not shown while the link is down, or when Hermes never says the mode.

## Sub-features

- `approvals-smart` reads "Smart approvals", shows no YOLO button, and still shows the card for the risky command after the safe one ran.
- `approvals-pick` moves the bot to Manual from the menu, keeps it there when the Off question is cancelled or closed with Escape, then turns approvals off.
- `approvals-bot-off` reads "Approvals Off" for a bot on `off`, and moves it to Smart with one call.
- `approvals-chat-yolo` reads "Approvals Off" for a chat whose own YOLO is on, and leaves it for Smart with one call that turns the chat's YOLO off.
- `approvals-chat-yolo-manual` leaves a chat's own YOLO for Manual with two calls, the mode first.
- `approvals-elsewhere` reads "Approvals Off", with no question, when another client turns the chat's YOLO on.
- `approvals-refused` shows Hermes's words when it refuses to turn the chat's YOLO off, and keeps reading Off.
- `approvals-card` keeps an open approval card when approvals turn off.
- `approvals-offline` hides the menu while the link is down.
- `approvals-unsupported` shows no menu when Hermes never says the mode.

## How to get to it (user POV)

- Open a chat. The shield button sits in the composer's toolbar, after the paperclip and the microphone. Press it.

## Driving it with highwing-verify

Preconditions:

- `--yolo off|on` plays a Hermes that tells each chat's own YOLO and takes the switch. Without `--yolo` the scripted gateway sends no `info.yolo` and refuses `config.set` as unknown, as an older Hermes does.
- `--approvals manual|smart|off` needs `--yolo`. Every bot then has that approval mode, which the gateway answers to `config.get` of `approval_mode` and changes on `config.set` of it. `info.yolo` stays the chat's own flag, as on Hermes. One mode serves every bot.
- A `called config.set` count is what the gateway was sent. The gateway fails the run if a call carries a `scope` of "global", and refuses any other `scope` key.

- **Smart by default.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --approvals smart --run approvals-smart wait live see "Smart approvals" count button /^YOLO/ 0 type "Message Hermes" @request click button Send wait approval see "Ran" shot smart-asks-risky click button "Run once" wait settled called config.set '{}' 0 quiet`. The `ls` ran with no card, and the `rm -rf` waits on one.
- **Pick a mode.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --approvals smart --run approvals-pick wait live shot smart click button "Smart approvals" shot menu click menuitemradio Manual see "Manual approvals" click button "Manual approvals" click menuitemradio Off count dialog "Turn off approvals for this bot?" 1 focused button Cancel shot confirm-off click button Cancel count dialog "Turn off approvals for this bot?" 0 see "Manual approvals" click button "Manual approvals" click menuitemradio Off press Escape count dialog "Turn off approvals for this bot?" 0 see "Manual approvals" click button "Manual approvals" click menuitemradio Off click button "Turn off" see "Approvals Off" called config.set '{"key":"approval_mode","value":"manual"}' 1 called config.set '{"key":"approval_mode","value":"off"}' 1 called config.set '{}' 2 shot off quiet`. Two `config.set` calls in all prove that Cancel and Escape sent nothing.
- **A bot on off.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --approvals off --run approvals-bot-off wait live see "Approvals Off" click button "Approvals Off" checked menuitemradio Off click menuitemradio Smart see "Smart approvals" called config.set '{"key":"approval_mode","value":"smart"}' 1 called config.set '{}' 1 shot bot-smart quiet`. The chat's own flag was already off, so no `yolo` set is sent.
- **A chat's own YOLO.** Run `$H run --fixture fixtures/errand.jsonl --yolo on --approvals smart --run approvals-chat-yolo wait live see "Approvals Off" shot chat-yolo click button "Approvals Off" checked menuitemradio Off click menuitemradio Smart see "Smart approvals" called config.set '{"key":"yolo","value":"off"}' 1 called config.set '{}' 1 quiet`. The bot was on Smart already, so only the chat's flag is sent.
- **From a chat's own YOLO to Manual.** Run `$H run --fixture fixtures/errand.jsonl --yolo on --approvals smart --run approvals-chat-yolo-manual wait live click button "Approvals Off" click menuitemradio Manual see "Manual approvals" called config.set '{"key":"approval_mode","value":"manual"}' 1 called config.set '{"key":"yolo","value":"off"}' 1 called config.set '{}' 2 quiet`.
- **Another client turns YOLO on.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --approvals smart --yolo-elsewhere-after tool.start --run approvals-elsewhere wait live see "Smart approvals" type "Message Hermes" @request click button Send see "Approvals Off" count dialog "Turn off approvals for this bot?" 0 called config.set '{}' 0 shot elsewhere wait approval click button "Run once" wait settled quiet`.
- **Hermes refuses.** Run `$H run --fixture fixtures/errand.jsonl --yolo on --yolo-denied --approvals smart --run approvals-refused wait live click button "Approvals Off" click menuitemradio Smart see "Hermes won't let Highwing do that in this chat." see "Approvals Off" called config.set '{"key":"yolo","value":"off"}' 1 shot refused`.
- **The card stays.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --approvals smart --run approvals-card wait live type "Message Hermes" @request click button Send wait approval click button "Smart approvals" click menuitemradio Off click button "Turn off" see "Approvals Off" wait approval shot card-kept click button "Run once" wait settled quiet`. The "Run once" button is still there after the change.
- **Link down.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --approvals smart --drop-after message.start --run approvals-offline wait live see "Smart approvals" type "Message Hermes" @request click button Send wait offline gone button "Smart approvals" shot offline wait live see "Smart approvals" quiet`. The drop needs the turn's frames, so the request is sent first.
- **Not supported.** Run `$H run --fixture fixtures/errand.jsonl --run approvals-unsupported wait live count button "Smart approvals" 0 count button /^YOLO/ 0 quiet`. The rest of the errand and its C shots are unchanged.

## Gotchas

- The menu follows Hermes. It changes only after Hermes answers the call, or after a `session.info` that says so. The button is disabled while a change is on its way.
- The mode is the bot's `approvals.mode`, so every chat of that bot changes. Another chat shows it the next time it goes live, since the mode is read then and Hermes sends no session.info for the write.
- Highwing never sends a `scope`. Hermes treats a missing one as this chat only, and "global" would flip the whole profile.
- `called` counts what reached the scripted gateway, from `gateway-calls.jsonl`. It works only in `--fixture` runs.
