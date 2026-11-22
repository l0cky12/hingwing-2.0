# Live gateway

With no fixture, the app dials the user's real Hermes gateway on this machine. The link comes online, the sidebar lists the stored chats, and the window opens the most recent one. A message typed there goes to the real gateway. With no AI provider set up, Hermes fails the turn, and the thread ends in a failure line in plain words with no banner.

## Sub-features

- `live-connect` brings the link online and lists the stored chats.
- `live-send` sends a message and settles the turn.
- `live-failure` shows "Hermes couldn't sign in to its model provider. Check the provider's key or sign-in in Hermes." when the turn fails with `auth_permanent`.
- `live-record` saves the run as a fixture through `--record`.

## How to get to it (user POV)

- Launch Highwing while Hermes is running, type in the "Message Hermes" box and press Send.

## Driving it with highwing-verify

Preconditions:

- Hermes is running on this machine, and no AI provider is set up, so the turn fails.
- `$H build` is current.

- **Journey.** Run `$H run --live --run live wait live type "Message Hermes" "Reply with the single word: hello" click button Send see "Hermes couldn't sign in" shot failed`. `failed.aria.txt` shows the request as the first paragraph, then a `status` holding the failure sentence, and no `status "Connection"` banner. `steps.log` ends in `PASS`.
- **Record it.** Add `--record /tmp/live.jsonl` to the same run. The file is a fixture of the real gateway for this journey.
- **Without the app.** `pnpm live:check [recording path]` runs the same connect, list, create and send from the command line and exits 0 on the failure line or a normal finish.

## Gotchas

- Every send writes to the user's real Hermes. `live:check` also creates a new chat each run.
- There is no new-chat button. The window opens the most recent chat (`FirstChat` in `App.tsx`), so the message lands there.
- Hermes stores nothing for a failed turn, so reopening that chat shows an empty thread.
- `@request` needs a fixture. Type the message literally.
- `wait live` means the chat is attached. It can take longer than with a fixture, so raise `--timeout` if the first run misses it.
