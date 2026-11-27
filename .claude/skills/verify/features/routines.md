# Routines

Routines… in each bot's menu opens a dialog with the jobs Hermes runs on a schedule for that bot. Each row shows the job's name, when it runs in plain words, and Paused for a paused job. Highwing reads them with `cron.manage` `list` for the bot's profile, paused jobs included, and asks again each time Hermes sends `cron.changed`, keeping the last list while it asks. A bot with no jobs says so and how to make one by asking the bot. A Hermes without `cron.manage` says "This Hermes can't list routines." Highwing keeps no scheduler and changes no job.

## Sub-features

- `routines-after` lists Research's two jobs, one Paused, updates when `cron.changed` arrives, gives focus back to the row on Escape, and shows Rae's empty state.
- `routines-refused` shows the refusal of a Hermes without `cron.manage`.

## How to get to it (user POV)

- Right-click a bot in the Bots column, or press ⋯ at its right end, then pick Routines….

## Driving it with highwing-verify

Preconditions:

- `--profiles fixtures/profiles/rae.json` lists Research and Rae.
- `--cron fixtures/cron/two.json` gives Research a daily 9:00 job and a paused two-hourly one. 1.5 s after the first list it pauses the daily job, adds a Monday job and sends `cron.changed`. Rae has no jobs.

Recipes:

- **Listed, live and empty.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --cron fixtures/cron/two.json --run routines-after wait window wait live wait bots click button "More for Research" count menuitem "Routines…" 1 shot after-menu click menuitem "Routines…" see "Morning paper digest" see "Every day at 9:00" see "Every 2 hours" see Paused shot after-routines see "Weekly reading list" see "Mondays at 8:30" shot after-live called cron.manage '{"action":"list","include_disabled":true,"profile":"research"}' 2 press Escape focused button Research right-click button Rae click menuitem "Routines…" see "Rae has no routines yet" shot after-empty quiet`. `after-routines.png` shows one Paused mark and `after-live.png` shows three jobs, two of them Paused.
- **Refused.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --run routines-refused wait window wait live wait bots right-click button Research click menuitem "Routines…" see "This Hermes can't list routines." shot refused press Escape focused button Research quiet`.

## Gotchas

- The Paused mark is a plain label, so `count` cannot count it. Check the number of marks in the shot.
- The fixture's `later` starts at the first list, not at launch, so the recipe sees the first list before the change.
