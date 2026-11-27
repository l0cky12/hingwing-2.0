# Notifications

Main shows a desktop notification, as Hermes Desktop does, for three kinds of news. Each kind has a switch under Settings → Notifications, on until the user turns it off, kept in `notices.json` in the user-data directory.

- **Approvals and questions.** A chat the hub keeps attached waits on the user: an approval says "Approval needed" with the command, and a question, a password or a secret says "Input needed". Each request notifies once, at first sight. One first seen in a chat on screen never notifies later.
- **Finished replies.** A turn ends. A completed or stopped turn says "Hermes finished" with the first 140 characters of the reply, or "Message complete." when no reply follows the turn's last step. A failed turn says "Turn failed" with the words the thread shows.
- **Scheduled jobs.** A job of the home profile runs. Main lists the jobs with `cron.manage` on every new socket and on `cron.changed`. The first list is where runs are counted from. A later run says "Scheduled job finished" with the job's name, or "Scheduled job failed" with its name and error.

A chat is on screen when it is the shown chat, no Settings or setup screen covers it, and a Highwing window has focus. Approvals and finished replies notify only for a chat that is not on screen, so a turn ending in another chat notifies even while the window has focus. A click raises the window and opens the chat. A job's click only raises the window, since Hermes names no chat for a job's run. Main owns the notification, so two windows never show it twice.

## Sub-features

- `notify-done` notifies once when the shown chat's turn ends while the window is blurred.
- `notify-focused` stays quiet when the shown chat's turn ends while the window has focus.
- `notify-approval` notifies an approval once while the window is blurred.
- `notify-elsewhere` notifies a turn that ends in another bot's chat while the window has focus, and stays quiet for the approval the user saw on screen.
- `notify-job` notifies a scheduled job's run.
- `notify-settings` notifies an approval in the shown chat while Settings covers it, though the window has focus.
- `notify-switch` stays quiet for finished replies once their switch is off, and the switch stays off when Settings opens again.
- `notify-quiet` stays quiet for history loaded at open, for an end delivered by replay or catch-up, and for a turn that ended while Highwing was away. The unit tests in `apps/desktop/test/notify.test.ts` cover these, together with a failed turn and a click. `apps/desktop/test/notify-hermes.test.ts` drives each kind through the real hub on the scripted gateway.

## How to get to it (user POV)

- Send a message, switch to another app or another bot before the reply ends, and wait for the desktop notification.
- Settings → Notifications holds the three switches.

## Driving it with highwing-verify

Preconditions:

- Every run sets `HIGHWING_NOTIFY_LOG` to `notices.jsonl` in the evidence directory, so main records each notification there as a JSON line (`kind`, `key`, `opens`, `title`, `body`) and shows nothing on the desktop.
- Make the jobs fixture once: `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/jobs.json --run notify-fixture wait live wait bots`. Then set `F=/tmp/highwing-verify/notify-fixture/fixture-edited.jsonl`. `fixtures/profiles/jobs.json` is the roster of `roster.json` with a top-level `cron` key: one job, Morning digest, that runs 4 s after the first `cron.manage` list.

- **Blurred.** Run `$H run --fixture fixtures/errand.jsonl --run notify-blurred wait live type "Message Hermes" @request click button Send wait approval blur click button "Run once" wait settled notified "Hermes finished" 1 shot settled`. `steps.log` logs the recorded notice: kind `replies`, the story's session id in `opens`, the title `Hermes finished` and a body that starts `Done. I created`. It ends in `PASS`.
- **Focused.** Run the same steps without `blur` and with `notified "Hermes finished" 0`, under `--run notify-focused`. The count is checked again at the end of the run, after the shot.
- **An approval.** Run `$H run --fake-host ok --fixture $F --saved remote --run notify-approval wait live wait bots type "Message Hermes" @request click button Send blur wait approval notified "Approval needed" 1`. The notice's body is the command.
- **Another chat.** Run `$H run --fake-host ok --fixture $F --saved remote --run notify-elsewhere wait live wait bots type "Message Hermes" @request click button Send wait approval click button "Run once" click button Research wait live notified "Hermes finished" 1 notified "Approval needed" 0`. The window keeps focus throughout.
- **Settings over the chat.** Run `$H run --fake-host ok --fixture $F --saved remote --run notify-settings wait live wait bots type "Message Hermes" @request click button Send click button "/^Hermes on/" wait settings notified "Approval needed" 1`. The approval reaches the shown chat after Settings opens, and the window keeps focus.
- **A scheduled job.** Run `$H run --fake-host ok --fixture $F --saved remote --run notify-job wait live notified "Scheduled job finished" 1`. The notice's `opens` is null.
- **A switch.** Run `$H run --fake-host ok --fixture $F --saved remote --run notify-switch wait live wait bots click button "/^Hermes on/" wait settings click button Notifications checked switch "Finished replies" click switch "Finished replies" click button Close gone heading Settings type "Message Hermes" @request click button Send wait approval click button "Run once" click button Research wait live pause 4000 notified "Hermes finished" 0 click button "/^Hermes on/" wait settings click button Notifications shot settings-reopened`. `settings-reopened.aria.txt` lists the switch unchecked.

## Gotchas

- `blur` must come before the turn ends. The approval card holds the turn, so blur while it is shown. Playwright's clicks do not give the window focus back.
- Under Xvfb the window has focus from launch. `blur` fails if any Highwing window still has focus after it.
- A click on the notification cannot be driven here, since the recorder shows nothing. The unit tests and `notify-hermes.test.ts` cover it.
- The job's run starts on the gateway's first `cron.manage` list, so every run of `$F` records one "Scheduled job finished" about 4 s after launch. Count other titles, not every line.
