# Routines

Each bot's menu has Routines… right after Edit…. It opens a dialog named "Routines for <bot>" that lists the jobs Hermes runs for that bot on a schedule. Highwing reads them with `cron.manage` `list`, with paused jobs included, scoped to the bot's profile. Each row shows the job's name, when it runs in plain words, such as "Weekdays at 09:00" or "Every 6 hours", and a Paused tag for a paused job. A name tagged `[bot:<profile>]` by Hermes desktop is shown without the tag. While the dialog is open, Highwing reads the list again when Hermes sends `cron.changed` and when the link comes back. A bot with no jobs says to ask the bot in a chat to do something on a schedule. A Hermes without `cron.manage`, or a socket that reaches only its own profile, says it can't list routines. Escape and Close close the dialog and give focus back to the bot's row. Highwing only shows routines. It does not create, pause, run or delete them.

## Sub-features

- `routines-list` opens Routines… for Research, lists two jobs with one paused, then shows a third after `cron.changed`, with no flash back to "Reading routines…".
- `routines-empty` opens Routines… for a bot with no jobs and shows the empty state.
- `routines-unsupported` opens Routines… on a Hermes without `cron.manage` and shows the refusal.

## How to get to it (user POV)

- Right-click a bot row in the Bots column, or press the ⋯ at its right end, and choose Routines….

## Driving it with highwing-verify

Preconditions:

- `--profiles fixtures/profiles/roster.json` lists the bots, Research and Timothy among them.
- `--cron fixtures/cron/research.json` gives Research "Morning brief" (`0 9 * * 1-5`) and "[bot:research] Backup check" (`every 360m`, paused), and adds "Inbox sweep" (`every 30m`) 1500 ms after the first `cron.manage`. Timothy has none.

Recipes:

- **List and live update.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --cron fixtures/cron/research.json --mode bots --run routines-list wait live wait bots click button "More for Research" count menu "More for Research" 1 shot menu click menuitem Routines… count dialog "Routines for Research" 1 see "Morning brief" see "Weekdays at 09:00" see "Backup check" see "Every 6 hours" see Paused absent "[bot:research]" shot listed see "Inbox sweep" see "Every 30 minutes" shot updated reached cron.manage '{"profile":"research","action":"list","include_disabled":true}' 2 press Escape gone dialog "Routines for Research" focused button Research quiet`. `listed.aria.txt` holds `dialog "Routines for Research"` with `list "Routines"` and two items. `updated.aria.txt` holds three.
- **Empty.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --cron fixtures/cron/research.json --mode bots --run routines-empty wait live wait bots click button "More for Timothy · CEO" click menuitem Routines… see "has no routines yet" count list Routines 0 shot empty called cron.manage '{"profile":"timothy"}' 1 click button Close gone dialog "Routines for Timothy · CEO" quiet`.
- **Unsupported.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --mode bots --run routines-unsupported wait live wait bots click button "More for Research" click menuitem Routines… see "This Hermes can't list routines for Highwing." count alert "" 1 shot unsupported called cron.manage '{"profile":"research"}' 1 press Escape gone dialog "Routines for Research" quiet`.

## Gotchas

- Hermes sends `cron.changed` only for the launch profile's `cron/jobs.json` (tui_gateway/change_watcher.py:460), so on a real Hermes another bot's list is read again only on reopen or reconnect. The fixture's `then` sends it whatever the bot.
- An `alert` has no accessible name, so `count alert "" 1` counts it.
