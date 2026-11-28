# Memory tab

The details panel of [Bot details](./bot-details.md) has a Memory tab after Routines. It shows what Hermes remembers for the open bot, MEMORY.md and then USER.md. Each file has a heading, a line saying what it holds, a meter of how full it is against its cap with the same words as text ("MEMORY.md: 1,365 of 1,500 characters"), and its entries in full. An empty file says "Nothing yet." The meter turns to the caution color at 90% of the cap. The tab reads three of the gateway's HTTP routes each time it opens, all with the bot's `?profile=`: `GET /api/learning/graph` for the entries, `GET /api/config` for the caps, and `GET /api/learning/node` for an entry whose card the graph cut short. It never writes memory. Editing stays with [Memory](./memory.md)'s Memory… on the default bot. A Hermes without the graph route says "This Hermes can't show memory yet." `docs/compatibility.md` ("A bot's memory") has the other refusals.

## Sub-features

- `memory-tab` shows Rae's three MEMORY.md entries, the long one in full, with a near-full meter, and its one USER.md entry.
- `memory-tab-default` shows Emu's own entries and none of Rae's.
- `memory-tab-missing` says this Hermes cannot show memory, with no meter.

## How to get to it (user POV)

- Open a bot's chat, click the bot's name in the top bar, then click Memory.

## Driving it with highwing-verify

Preconditions: `--profiles fixtures/profiles/rae.json`, and `--memory fixtures/memory/bots.json`. Emu is the `default` profile and its chat is open at launch.

- **A bot's memory.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --memory fixtures/memory/bots.json --run memory-tab wait live wait bots click button Rae said "The weekly report is ready" click button "Details for Rae" see "Upload picture" count tab Memory 1 click tab Memory see "Sends the summary to the team on Fridays." see "Step 12: look through the notes folder" see "Likes plain words and short lists." count meter "MEMORY.md: 1,365 of 1,500 characters" 1 count meter "USER.md: 34 of 1,375 characters" 1 count tabpanel Memory 1 count button Save 0 shot memory-tab reveal meter "USER.md: 34 of 1,375 characters" shot memory-tab-user quiet`. `memory-tab.png` shows the near-full MEMORY.md meter over the long entry. "Step 12" is past the graph's 1,200-character cut, so seeing it proves the tab read that entry in full.
- **The default bot.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --memory fixtures/memory/bots.json --run memory-tab-default wait live wait bots click button "Details for Emu" click tab Memory see "Prefers short answers." see "Lives in Lisbon." absent "Sends the summary" count meter "MEMORY.md: 22 of 2,200 characters" 1 count meter "USER.md: 16 of 1,375 characters" 1 shot memory-tab-default quiet`. Emu's caps are Hermes's defaults, which the fake sends for a file whose cap the fixture leaves out.
- **A Hermes without the read.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --run memory-tab-missing wait live wait bots click button Rae said "The weekly report is ready" click button "Details for Rae" click tab Memory see "This Hermes can't show memory yet." count alert "" 1 count meter "/.*/" 0 shot memory-tab-missing click button Close gone dialog Rae quiet`.

## Gotchas

- The HTTP reads do not reach `gateway-calls.jsonl`, which logs the socket only, so `called` cannot check them. `apps/desktop/test/memory-read.test.ts` checks each path the reader sends, and `packages/hermes/test/tickets.test.ts` checks the ticket line that names the profile.
- `fixtures/memory/home.json` sets the MEMORY.md cap to 40 characters for the Memory… recipes. Use `bots.json` here, whose top-level caps are left to the fake's defaults.
- `click button Emu` finds nothing in `rae.json`, because Emu's chat is open at launch. Open its panel with `Details for Emu`.
