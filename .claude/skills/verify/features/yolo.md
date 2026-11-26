# Switch YOLO

Beside the model readout under the message box, a quiet pill says whether Hermes runs this chat's commands without asking. It reads "YOLO" when off and "YOLO on" in the signal color when on, and it is a toggle button (`aria-pressed`). Turning it on opens a small confirmation every time, and nothing reaches Hermes until "Turn on". Turning it off needs none. The switch changes only the open chat. A chat with an approval card already open keeps the card. The pill is not shown while the link is down, or when Hermes never says the chat's state.

Before the pill, while YOLO is off, a quiet readout names the bot's approval mode: "Smart approvals" or "Manual approvals". Hermes starts a bot on Smart: it runs the commands its judge finds safe and asks about risky ones. A bot whose mode is `off` runs every chat without asking, so the pill reads "YOLO on" there even though Hermes says the chat's own flag is off. Pressing it asks "Turn off YOLO for this bot?", and "Use Smart" moves the whole bot to Smart. It turns the chat's own YOLO off as well only when that was on too.

## Sub-features

- `yolo-switch` asks first, turns the chat on with one call to Hermes, then turns it off with no question.
- `yolo-cancel` closes the confirmation with Cancel or Escape and sends nothing.
- `yolo-card` keeps an open approval card when YOLO turns on.
- `yolo-apart` keeps one chat's state out of another chat.
- `yolo-elsewhere` turns the pill on, with no question, when another client turns YOLO on.
- `yolo-refused` shows Hermes's words when it refuses the switch, and leaves the pill off.
- `yolo-offline` hides the pill while the link is down.
- `yolo-unsupported` shows no pill when Hermes sends no `yolo`.
- `approvals-smart` reads "Smart approvals" with YOLO off, and still shows the card for the risky command after the safe one ran.
- `approvals-bot-off` starts in YOLO for a bot on `off`, asks, then moves the bot to Smart and turns YOLO off.
- `approvals-bot-cancel` closes that question with Cancel or Escape and sends nothing.
- `approvals-manual` reads "Manual approvals", and hides the readout while YOLO is on.

## How to get to it (user POV)

- Open a chat. The pill sits to the right of the model readout. When Hermes lists no models the pill stands alone at the left edge. Press it.

## Driving it with highwing-verify

Preconditions:

- `--yolo off` plays a Hermes that tells each chat's YOLO and takes the switch. Without `--yolo` the scripted gateway sends no `info.yolo` and refuses `config.set` as unknown, as an older Hermes does.
- `--approvals manual|smart|off` needs `--yolo`. Every bot then has that approval mode, which the gateway answers to `config.get` of `approval_mode` and changes on `config.set` of it. `info.yolo` stays the chat's own flag, as on Hermes. One mode serves every bot.
- A `called config.set` count is what the gateway was sent. The gateway fails the run if a call carries a `scope` of "global", and refuses any other `scope` key.

- **Ask, turn on, turn off.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --run yolo-switch wait live pressed button YOLO false shot off click button YOLO count dialog "Turn on YOLO for this chat?" 1 focused button Cancel pressed button YOLO false shot asking click button "Turn on" pressed button "YOLO on" true count dialog "Turn on YOLO for this chat?" 0 called config.set '{"key":"yolo","value":"on"}' 1 shot on click button "YOLO on" pressed button YOLO false count dialog "Turn on YOLO for this chat?" 0 called config.set '{"key":"yolo","value":"off"}' 1 called config.set '{"key":"yolo"}' 2 shot off-again quiet`. The end state that proves it is two `config.set` calls in all, the pill off, and no dialog open. `called` counts hold for the whole run, so the pill still reading off while the dialog is open, and the Cancel run below, prove the dialog itself sends nothing.
- **Cancel and Escape.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --run yolo-cancel wait live click button YOLO click button Cancel count dialog "Turn on YOLO for this chat?" 0 click button YOLO press Escape count dialog "Turn on YOLO for this chat?" 0 pressed button YOLO false called config.set '{}' 0 quiet`.
- **The card stays.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --run yolo-card wait live type "Message Hermes" @request click button Send wait approval click button YOLO click button "Turn on" pressed button "YOLO on" true wait approval shot card-kept click button "Run once" wait settled quiet`. The "Run once" button is still there after the switch.
- **Another chat.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --yolo off --run yolo-apart wait live wait bots click button YOLO click button "Turn on" pressed button "YOLO on" true click button Research current button Research pressed button YOLO false click button "Emu, default bot" current button "Emu, default bot" pressed button "YOLO on" true called config.set '{}' 1 quiet`.
- **Another client turns it on.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --yolo-elsewhere-after tool.start --run yolo-elsewhere wait live pressed button YOLO false type "Message Hermes" @request click button Send pressed button "YOLO on" true count dialog "Turn on YOLO for this chat?" 0 called config.set '{}' 0 shot elsewhere wait approval click button "Run once" wait settled quiet`.
- **Hermes refuses.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --yolo-denied --run yolo-refused wait live click button YOLO click button "Turn on" see "Hermes won't let Highwing do that in this chat." pressed button YOLO false called config.set '{"key":"yolo","value":"on"}' 1 shot refused`.
- **Link down.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --drop-after message.start --run yolo-offline wait live pressed button YOLO false type "Message Hermes" @request click button Send wait offline gone button YOLO shot offline wait live pressed button YOLO false quiet`. The drop needs the turn's frames, so the request is sent first.
- **Smart by default.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --approvals smart --run approvals-smart wait live see "Smart approvals" pressed button YOLO false type "Message Hermes" @request click button Send wait approval see "Ran" shot smart-asks-risky click button "Run once" wait settled called config.set '{}' 0 quiet`. The `ls` ran with no card, and the `rm -rf` waits on one.
- **A bot on off.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --approvals off --run approvals-bot-off wait live pressed button "YOLO on" true absent "Smart approvals" click button "YOLO on" count dialog "Turn off YOLO for this bot?" 1 focused button Cancel click button "Use Smart" pressed button YOLO false see "Smart approvals" count dialog "Turn off YOLO for this bot?" 0 called config.set '{"key":"approval_mode","value":"smart"}' 1 called config.set '{}' 1 shot bot-smart quiet`. The chat's own flag was already off, so no `yolo` set is sent.
- **Keep the bot on off.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --approvals off --run approvals-bot-cancel wait live click button "YOLO on" click button Cancel click button "YOLO on" press Escape count dialog "Turn off YOLO for this bot?" 0 pressed button "YOLO on" true called config.set '{}' 0 quiet`.
- **Manual.** Run `$H run --fixture fixtures/errand.jsonl --yolo off --approvals manual --run approvals-manual wait live see "Manual approvals" pressed button YOLO false click button YOLO click button "Turn on" pressed button "YOLO on" true absent "Manual approvals" called config.set '{"key":"yolo","value":"on"}' 1 quiet`.
- **Not supported.** Run `$H run --fixture fixtures/errand.jsonl --run yolo-unsupported wait live count button YOLO 0 absent "YOLO" quiet`. The rest of the errand and its C shots are unchanged.

## Gotchas

- The pill follows Hermes. It turns on only after Hermes answers the call, or after a `session.info` that says so. Pressing "Turn on" shows the button disabled until then.
- "Use Smart" writes the bot's `approvals.mode`, so every chat of that bot changes. Another chat shows it the next time it goes live, since the mode is read then and Hermes sends no session.info for the write.
- Highwing never sends a `scope`. Hermes treats a missing one as this chat only, and "global" would flip the whole profile.
- `called` counts what reached the scripted gateway, from `gateway-calls.jsonl`. It works only in `--fixture` runs.
