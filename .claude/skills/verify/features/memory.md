# Memory

Memory… sits beside Edit… in the default bot's menu, in the Bots column and in the card. [The bot menu](./bot-menu.md) says how to open that menu. Memory… opens a dialog named Memory that lists the entries Hermes keeps in the home this socket was launched with, MEMORY.md and then USER.md. Edit opens the entry's text, and Save sends `learning.edit`. Remove asks once, and the second Remove sends `learning.delete`. A save past that file's size cap, and a save of an empty entry, stay in the editor and show the words Hermes sent. A removal is kept even when the file is already over the cap. After a save or a removal the list shows what Hermes holds now. A Hermes without the learning calls says "This Hermes can't edit memory yet." The calls take no `profile` key, so the other bots' menus have no Memory….

## Sub-features

- `memory-list` opens the dialog from the default bot and shows both entries.
- `memory-edit` replaces the USER.md entry, and the list shows the new text under a new id.
- `memory-cap` keeps the MEMORY.md entry and shows Hermes's size-cap words when the replacement is too long.
- `memory-remove` removes an entry, and the list no longer shows it.
- `memory-missing` says this Hermes cannot edit memory, and sends no `learning.edit`.

## How to get to it (user POV)

- Open the default bot's menu from its card, or from its row when that bot is hidden, and choose Memory….

## Driving it with highwing-verify

Preconditions:

- `--profiles fixtures/profiles/roster.json` lists the default bot as Emu. Its menu is the card's menu.
- `--memory fixtures/memory/home.json` holds "Prefers short answers." in MEMORY.md and "Lives in Lisbon." in USER.md. The memory file's cap is 40 characters, so a long replacement of that entry is refused and "Lives in Porto." fits in USER.md.
- Without `--memory` the gateway refuses `learning.frames`, `learning.detail`, `learning.edit` and `learning.delete`.

Recipes:

- **The menu.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --memory fixtures/memory/home.json --run memory-menu wait live wait bots click button "More for Emu" count menuitem "Memory…" 1 shot memory-menu press Escape quiet`. `memory-menu.png` shows Memory… beside Edit….
- **Both entries.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --memory fixtures/memory/home.json --run memory-list wait live wait bots click button "More for Emu" click menuitem "Memory…" see "Prefers short answers." see "Lives in Lisbon." count dialog Memory 1 shot memory-dialog called learning.frames '{}' 1 called learning.detail '{"id":"memory:memory:0:cb2f059f0d41"}' 1 called learning.edit '{"profile":"default"}' 0 quiet`.
- **A replacement.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --memory fixtures/memory/home.json --run memory-edit wait live wait bots click button "More for Emu" click menuitem "Memory…" see "Lives in Lisbon." click button "Edit USER.md: Lives in Lisbon." type "Memory text for USER.md" "Lives in Porto." click button Save see "Lives in Porto." absent "Lives in Lisbon." shot memory-saved called learning.edit '{"content":"Lives in Porto."}' 1 quiet`.
- **Past the cap.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --memory fixtures/memory/home.json --run memory-cap wait live wait bots click button "More for Emu" click menuitem "Memory…" see "Prefers short answers." click button "Edit MEMORY.md: Prefers short answers." type "Memory text for MEMORY.md" "Prefers answers that run on for far longer than the file allows." click button Save see "Shorten the new content." value "Memory text for MEMORY.md" "Prefers answers that run on for far longer than the file allows." count dialog Memory 1 shot memory-capped quiet`.
- **A removal.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --memory fixtures/memory/home.json --run memory-remove wait live wait bots click button "More for Emu" click menuitem "Memory…" see "Lives in Lisbon." click button "Remove USER.md: Lives in Lisbon." see "Remove this entry?" click button "Remove USER.md: Lives in Lisbon." gone button "Remove USER.md: Lives in Lisbon." absent "Lives in Lisbon." see "Prefers short answers." shot memory-removed called learning.delete '{"id":"memory:profile:1:4349566ff715"}' 1 quiet`. The second Remove is the confirm, and `gone` waits until the list no longer holds that button.
- **A Hermes without the calls.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run memory-missing wait live wait bots click button "More for Emu" click menuitem "Memory…" see "This Hermes can't edit memory yet." count alert "" 1 shot memory-missing called learning.edit '{}' 0 quiet`.

## Gotchas

- `called` matches each param exactly. An entry id ends in the first 12 hex characters of the sha256 of its trimmed text: `cb2f059f0d41` for "Prefers short answers.", `4349566ff715` for "Lives in Lisbon.", and `8b30830b3778` for "Lives in Porto."
- The confirm Remove keeps the same accessible name as the Remove that asked, so the second click uses the same button name.
- An `alert` has no accessible name, so `count alert "" 1` counts the refusal.
- Memory… is on the default bot only. Research's menu has no Memory… menuitem.
