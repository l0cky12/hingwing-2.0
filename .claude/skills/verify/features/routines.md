# Routines

The details panel of [Bot details](./bot-details.md) has a Routines tab beside Details. It lists the cron jobs Hermes runs for the bot, read with `cron.manage` action `list` under the bot's profile with paused jobs included. Each row shows the job's name, without the `[bot:<name>] ` tag an older Hermes puts in front of it, and when it runs in plain words, or Paused. Each row has Pause or Resume and Delete…. Each control is one `cron.manage` call with the job's id, and the row shows the job Hermes answers with. Delete… asks first. The list is read again on every `cron.changed` and every new socket while the tab is shown. Hermes runs the jobs, and Highwing keeps no scheduler.

## Sub-features

- `routines-list` lists each job with its schedule in plain words or Paused, and asks `cron.manage` once when the tab opens.
- `routines-empty` tells the user to ask the bot in a chat when the bot has no jobs.
- `routines-unsupported` shows Hermes's refusal in words when it has no `cron.manage`.
- `routines-controls` pauses and resumes a job, backs out of a delete by Escape and by Cancel with the panel left open and focus back on Delete…, then confirms one, and each row shows Hermes's answer.

## How to get to it (user POV)

- Open a bot's chat, click the bot's name in the top bar, then click Routines.

## Driving it with highwing-verify

Preconditions: `--profiles fixtures/profiles/rae.json`, and `--cron` with a file whose `profiles` name `rae`.

- **List.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --cron fixtures/cron/two-jobs.json --run routines-list wait live wait bots click button Rae said "The weekly report is ready" click button "Details for Rae" see "Upload picture" count tablist "/.*/" 1 click tab Routines see "Morning digest" see "Weekdays at 09:00" see "Backup check" see "Paused" count list Routines 1 count button Close 1 count button Save 0 shot routines-jobs click tab Details see "Upload picture" value Name Rae press Escape gone dialog Rae called cron.manage '{"action":"list","include_disabled":true,"profile":"rae"}' 1 quiet`. `routines-jobs.png` shows both rows under the selected Routines tab.
- **Empty.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --cron fixtures/cron/none.json --run routines-empty wait live wait bots click button Rae said "The weekly report is ready" click button "Details for Rae" see "Upload picture" click tab Routines see "Rae has no routines yet. To make one, ask Rae in a chat" count list Routines 0 shot routines-empty press ArrowRight focused tab Details see "Upload picture" press ArrowRight focused tab Routines click button Close gone dialog Rae focused button "Details for Rae" quiet`.
- **Controls.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --cron fixtures/cron/two-jobs.json --run routines-controls wait live wait bots click button Rae said "The weekly report is ready" click button "Details for Rae" see "Upload picture" click tab Routines see "Morning digest" click button "Pause Morning digest" count button "Resume Morning digest" 1 count button "Resume Backup check" 1 click button "Resume Backup check" see "Every hour" count button "Pause Backup check" 1 shot routines-paused-resumed click button "Delete Backup check…" count dialog "Delete Backup check?" 1 shot routines-confirm press Escape gone dialog "Delete Backup check?" count dialog Rae 1 focused button "Delete Backup check…" click button "Delete Backup check…" click button Cancel gone dialog "Delete Backup check?" focused button "Delete Backup check…" see "Backup check" click button "Delete Backup check…" click button Delete gone dialog "Delete Backup check?" absent "Backup check" see "Morning digest" shot routines-deleted called cron.manage '{"action":"pause","name":"4f1c2a9e0b7d","profile":"rae"}' 1 called cron.manage '{"action":"resume","name":"9a3e6d21c4f8","profile":"rae"}' 1 called cron.manage '{"action":"remove","name":"9a3e6d21c4f8","profile":"rae"}' 1 quiet`. `routines-paused-resumed.png` shows Morning digest Paused with Resume and Backup check every hour with Pause. `routines-confirm.png` shows the delete question over the panel.
- **Unsupported.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/rae.json --run routines-unsupported wait live wait bots click button Rae said "The weekly report is ready" click button "Details for Rae" see "Upload picture" click tab Routines see "This Hermes can't show routines to Highwing." count alert "" 1 shot routines-unsupported quiet`.

## Gotchas

- The scripted gateway pushes `cron.changed` only after a control, so a recipe cannot show a job that changed elsewhere. `packages/hermes/test/routines.test.ts` covers that push.
- `--bound` launches into a chat with no bot, so the panel cannot be opened there. `packages/hermes/test/routines.test.ts` covers a bound socket's refusal.
