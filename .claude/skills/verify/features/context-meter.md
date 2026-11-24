# Context meter and tokens per reply

Under each finished reply a quiet line says what the reply used, such as "1,204 in, 380 out, 412 reasoning". Under the message box, at its right edge, a meter says how full the chat's context window is: a small bar and "about 34%". Pressing the meter opens a panel with the window's size, the model, a bar split into what fills the window, and the list of those parts with their token counts. Above 80 percent the meter turns the caution color and says "nearly full". While the chat is not connected the meter keeps its last value, dims, and says "(stale)". A Hermes that reports no usage shows no meter and no line. Highwing shows tokens only, never money.

## Sub-features

- `tokens-per-reply` shows the counts in and out under a finished reply, and the reasoning count only when it is above zero.
- `meter` shows the percent as text, with "about" when Hermes estimated it. Its accessible name is "Context about 34% full".
- `meter-breakdown` opens the panel named "What fills the context", which lists each part by name. Escape closes it and returns focus to the meter.
- `meter-nearly-full` says "nearly full" above 80 percent.
- `meter-stale` keeps the last value and says "(stale)" while the connection banner shows.
- `usage-unsupported` shows no meter and no token line when Hermes refuses `session.stats` and its turn ends carry no usage.

## How to get to it (user POV)

- Open a chat. The meter sits under the message box, at its right edge, on the same line as the model readout. Press it.
- Send a message and wait for the reply to finish. The token line is under the Done ring.

## Driving it with highwing-verify

Preconditions:

- `--usage fixtures/usage/errand.json` starts the chat at about 3 percent and ends the errand at about 34 percent. `--usage fixtures/usage/nearly-full.json` ends it at 87 percent, measured and not estimated, with no reasoning tokens. Without `--usage` the scripted gateway refuses `session.stats` and `session.context_breakdown` as unknown methods.

- **Meter, reply line and breakdown.** Run `$H run --fixture fixtures/errand.jsonl --usage fixtures/usage/errand.json --models fixtures/models/three.json --run usage-meter wait live see "about 3%" shot before type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled see "1,204 in, 380 out, 412 reasoning" shot settled click button "Context about 34% full" see "Context: 68k of 200k (about)" see "Model: fast-small" see System see Tools see Messages shot split called session.context_breakdown '{}' 1 press Escape gone dialog "What fills the context" focused button "Context about 34% full" quiet`. `settled.aria.txt` holds the meter with its percent and the reply's counts. `split.aria.txt` lists each part by name.
- **Nearly full, and stale while the link is down.** Run `$H run --fixture fixtures/errand.jsonl --usage fixtures/usage/nearly-full.json --drop-after message.complete --run usage-stale wait live type "Message Hermes" @request click button Send wait approval click button "Run once" wait offline see "87%, nearly full (stale)" shot stale wait live see "1,204 in, 380 out" absent "reasoning" absent "(stale)" count button "Context 87% full, nearly full" 1 shot near quiet`.
- **Not supported.** Run `$H run --fixture fixtures/errand.jsonl --run usage-unsupported wait live type "Message Hermes" @request click button Send wait approval click button "Run once" wait settled count button "/^Context /" 0 absent " in, " called session.stats '{}' 3 quiet`. The errand and its C shots are unchanged.

## Gotchas

- The meter's accessible name holds the whole sentence, "Context about 34% full". Its face holds only "about 34%". `click button` and `count button` take the name. `see` takes the face.
- The parts of the bar are one color, split by gaps. The list under it, in the same order, says which part is which. Do not check a part by its color.
- The percent is the one Hermes sends. The "before" value comes from the `session.stats` read made when the chat opens, and the "after" value arrives on the turn's end.
- The scripted gateway gives every turn end the same `after` usage, so a second turn in one run would show zero tokens.
