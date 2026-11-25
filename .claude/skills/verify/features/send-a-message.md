# Send a message

The user types in the composer and presses Send (or Enter). The text becomes the turn's request, and the agent starts. While the agent works, a Stop button sits beside Send. The draft is cleared only when Hermes takes the message. Focus is in the message box once a message is sent, by Send or by Enter, and it stays there when the turn ends.

## Sub-features

- `send-button` sends with the Send button.
- `send-enter` sends with Enter. Shift+Enter inserts a newline.
- `send-focus` keeps focus in the message box after a send, through the end of the turn.
- `send-stop-visible` shows Stop while the turn runs and hides it when the turn settles.

## How to get to it (user POV)

- Type in the "Message Hermes" box at the bottom of the window and press Send.

## Driving it with highwing-verify

Preconditions:

- A fixture whose first step awaits `prompt.submit`, such as `fixtures/errand.jsonl`.

- **Send.** Run `$H run --fixture fixtures/errand.jsonl --run send wait live type "Message Hermes" @request click button Send see "In /tmp/hermes-proto-work" shot sent`. `sent.aria.txt` shows the request as the turn's first paragraph, an empty textbox and `button "Stop"`.
- **Enter.** Run `$H run --fixture fixtures/errand.jsonl --run send-enter wait live type "Message Hermes" @request press Enter see "In /tmp/hermes-proto-work" shot sent`. The result is the same as with the button.
- **Focus.** Run `$H run --fixture fixtures/markdown.jsonl --run send-focus wait live type "Message Hermes" @request click button Send focused textbox "Message Hermes" wait settled focused textbox "Message Hermes"`. A press on Send moves focus to the box before Send disables itself for the trip to Hermes, and the turn's end leaves it there.
- **Stop goes away.** Continue either run with `wait approval click button "Run once" wait settled shot settled`. `settled.aria.txt` has no `button "Stop"`.

## Gotchas

- The scripted gateway checks the message's key set, not its text. Use `@request` anyway, so the request on screen matches the reference.
- Send is disabled until the chat is live. Always `wait live` before typing.
- Send is also disabled for the few milliseconds the message takes to reach Hermes. A focused control that becomes disabled loses focus to the page if Chromium updates the page in that gap, so a send moves focus to the box first. Without that, focus after Send lands on Send in some runs and on the page in others, more often under load.
