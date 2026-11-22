# Offline banner

When the link to Hermes is not online, a banner under the top bar says why. If the user can help, it carries a button: Retry when the link is blocked, or Start Hermes when Hermes isn't running. The thread stays on screen. A running turn's end turns graphite with "Paused while Highwing is disconnected." Send, Stop and the approval buttons are disabled, and the draft is kept. The banner goes when the link comes back.

## Sub-features

- `offline-blocked` shows "Highwing can't find the hermes command." with Retry when Hermes is missing.
- `offline-dropped` shows "Reconnecting to Hermes." with no button after the socket drops, with the buttons disabled.
- `offline-recovered` removes the banner and makes the approval card answerable again after the redial.

## How to get to it (user POV)

- Start Highwing on a machine without Hermes, or lose the connection to the gateway while a chat is open.

## Driving it with highwing-verify

Preconditions:

- For `offline-blocked`, `$H doctor` shows `ok   no-fixture launch cannot see hermes`.

- **Blocked.** Run `$H run --no-fixture --run offline-missing wait window wait offline shot offline-missing see "Highwing can't find the hermes command." click button Retry wait offline`. The banner holds its words and a Retry button, and is still there after Retry.
- **Dropped.** Run `$H run --fixture fixtures/errand.jsonl --drop-after approval.request --run offline-drop wait live type "Message Hermes" @request click button Send wait offline shot offline-drop see "Reconnecting to Hermes." disabled button "Run once" disabled button Send wait approval shot approval-back`. `offline-drop.png` shows the banner, the greyed-out card and buttons, and the paused end. `approval-back.png` shows the card answerable with no banner.

## Gotchas

- The dropped state lasts about 1 s, until the first redial. Put `shot` and the `disabled` checks right after `wait offline`.
- `--no-fixture` is the only safe way to see the blocked banner on this machine. Without it the app dials the real Hermes gateway.
- No banner shows while the link is still `connecting` at launch. That matches `banner()` in `docs/design/sketch/usage.ts`.
