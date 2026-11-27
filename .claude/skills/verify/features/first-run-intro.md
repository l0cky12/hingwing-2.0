# First-run intro

The first time a connection saves, Highwing shows three steps. Skip, Escape, or Open chat on the last step leaves the steps and opens the default bot's chat. Three example requests sit above the message box. A click on one sends it, and the requests leave. After you leave the steps, a later launch opens on the chat. If you quit during the steps, the next launch shows them again, from the first step.

## Sub-features

- `intro-steps` shows the three steps, then the default bot's chat with the three requests. A click sends one and clears them.
- `intro-relaunch` shows the intro again, from the first step, after a quit on that step.
- `intro-saved-launch` shows no intro when a connection is already saved and the run has no intro file.

## How to get to it (user POV)

- Start Highwing for the first time and connect.
- Press Skip on any step, or Next until Open chat.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines.
- Make the roster fixture once: `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run intro-roster wait live wait bots`. Then set `F=/tmp/highwing-verify/intro-roster/fixture-edited.jsonl` and `M=hermes-host.example-tailnet.ts.net`. Pass `F` as `--fixture` on the `--fake-host` runs below. `--profiles` beside `--fake-host` is refused, and `--fixture` on those runs does not edit the file. The roster's default bot is Emu. A bare `--fake-host ok` lists no bots, so the example buttons stay hidden.

- **The three steps.** Run `$H run --fake-host ok --fixture $F --saved none --run intro-steps wait setup type "Hermes machine" $M click button Connect wait intro see "Highwing now uses the Hermes on hermes-host." shot intro-step-1 click button Next see "Each bot keeps its own chats." click button Next see "Start with the default bot." click button "Open chat" wait live wait bots see "What can you help me with?" see "Summarize what is in this folder." see "What should I do next?" shot intro-requests click button "What can you help me with?" said "What can you help me with?" gone button "Summarize what is in this folder." quiet`. `intro-step-1.png` shows the first step, with Skip and Next. `intro-requests.png` shows the three requests above the message box, and they are gone after the click.

- **Quit on the first step.** Run `$H run --fake-host ok --fixture $F --saved none --run intro-relaunch wait setup type "Hermes machine" $M click button Connect wait intro relaunch wait intro see "Highwing now uses the Hermes on hermes-host." shot intro-again`. The next launch opens with the intro on its first step.

- **A saved connection.** Run `$H run --fake-host ok --saved remote --run intro-saved-launch wait live count region Intro 0`. An existing install and a `--saved` run have no intro file, so the intro stays hidden.

## Gotchas

- `wait setup-saved` matches a button named Open chat. The intro's last step has that button, so a first connection waits on `intro`.
- Skip, Escape, and Open chat leave the steps. Next only moves to the next step. Escape does not open the command palette.
- The requests stay until a send in the chat that shows them succeeds. A failed send leaves them.
