# Send a message

The user types in the composer and presses Send (or Enter). The text becomes the turn's request, and the agent starts. While the agent works, a Stop button sits beside Send. The draft is cleared only when Hermes takes the message.

## Sub-features

- `send-button` sends with the Send button.
- `send-enter` sends with Enter. Shift+Enter inserts a newline.
- `send-stop-visible` shows Stop while the turn runs and hides it when the turn settles.

## How to get to it (user POV)

- Type in the "Message Hermes" box at the bottom of the window and press Send.

## Driving it with highwing-verify

Preconditions:

- A fixture whose first step awaits `prompt.submit`, such as `fixtures/errand.jsonl`.

- **Send.** Run `$H run --fixture fixtures/errand.jsonl --run send wait live type "Message Hermes" @request click button Send see "In /tmp/hermes-proto-work" shot sent`. `sent.aria.txt` shows the request as the turn's first paragraph, an empty textbox and `button "Stop"`.
- **Enter.** Run `$H run --fixture fixtures/errand.jsonl --run send-enter wait live type "Message Hermes" @request press Enter see "In /tmp/hermes-proto-work" shot sent`. The result is the same as with the button.
- **Stop goes away.** Continue either run with `wait approval click button "Run once" wait settled shot settled`. `settled.aria.txt` has no `button "Stop"`.

## Gotchas

- The scripted gateway checks the message's key set, not its text. Use `@request` anyway, so the request on screen matches the reference.
- Send is disabled until the chat is live. Always `wait live` before typing.
