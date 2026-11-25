# Turn notifications

When a turn in the shown chat ends while no Highwing window has focus, Highwing shows a desktop notification, as Hermes Desktop does. A completed or stopped turn says "Hermes finished" with the first 140 characters of the reply, or "Message complete." when no reply follows the turn's last step. A failed turn says "Turn failed" with the words the thread shows. A click on it raises the window and opens that chat again if another one is shown. Main owns the notification, so two windows never show it twice.

## Sub-features

- `notify-done` notifies once when the turn ends while the window is blurred.
- `notify-focused` stays quiet when the window has focus at the turn's end.
- `notify-quiet` stays quiet for history loaded at open, for an end delivered by replay or catch-up, and for a turn that ended while Highwing was away. The unit tests in `apps/desktop/test/notify.test.ts` cover these, together with a failed turn and a click.

## How to get to it (user POV)

- Send a message, switch to another app before the reply ends, and wait for the desktop notification.

## Driving it with highwing-verify

Preconditions:

- `fixtures/errand.jsonl`, sent with `@request`. Every run sets `HIGHWING_NOTIFY_LOG` to `notices.jsonl` in the evidence directory, so main records each notification there as a JSON line and shows nothing on the desktop.

- **Blurred.** Run `$H run --fixture fixtures/errand.jsonl --run notify-blurred wait live type "Message Hermes" @request click button Send wait approval blur click button "Run once" wait settled notified "Hermes finished" 1 shot settled`. `steps.log` logs the recorded notice: the story's session id, turn `run:1`, the title `Hermes finished` and a body that starts `Done. I created`. It ends in `PASS`.
- **Focused.** Run the same steps without `blur` and with `notified "Hermes finished" 0`, under `--run notify-focused`. `notices.jsonl` is never written, and `steps.log` ends in `PASS`. The count is checked again at the end of the run, after the shot.

## Gotchas

- `blur` must come before the turn ends. The approval card holds the turn, so blur while it is shown. Playwright's clicks do not give the window focus back.
- Under Xvfb the window has focus from launch. `blur` fails if any Highwing window still has focus after it.
- A click on the notification cannot be driven here, since the recorder shows nothing. The unit tests cover it.
