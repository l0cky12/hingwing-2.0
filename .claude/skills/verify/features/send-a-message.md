# Send a message

The user types in the composer and presses Send (or Enter). Settings' Composer page has a Send with Ctrl+Enter switch (Cmd+Enter on macOS), off at first. With it on, Ctrl+Enter sends and Enter adds a line. Main keeps the choice in `send-key.json`, and every composer follows it: a chat's, a group chat's and an edit. The Send button's tooltip names the key that sends. The text becomes the turn's request, and the agent starts. While the agent works, a Stop button sits beside Send. The draft is cleared only when Hermes takes the message. Focus is in the message box once a message is sent, by Send or by Enter, and it stays there when the turn ends.

In the thread a sent message sits at the right in a tinted pill, with its Copy request, Edit message and More actions row at its left, and a reply sits at the left on a raised card. A quiet time line is centred above a turn that began 15 minutes or more after the one before it, or on another day, such as "Sat 21 Nov 02:16" in the machine's time zone. In forced colors the pill and the cards get a 1px outline, as [Forced colors](./forced-colors.md) says.

## Sub-features

- `send-button` sends with the Send button.
- `send-enter` sends with Enter. Shift+Enter inserts a newline.
- `send-mod-enter` turns on Send with Ctrl+Enter in Settings, after which Enter adds a line and Ctrl+Enter sends, and the switch stays on across a restart.
- `send-focus` keeps focus in the message box after a send, through the end of the turn.
- `send-stop-visible` shows Stop while the turn runs and hides it when the turn settles.
- `message-layout` draws the request as a pill at the right, the reply on a card at the left, and a time line above a turn that began a while after the last.

## How to get to it (user POV)

- Type in the "Message Hermes" box at the bottom of the window and press Send.

## Driving it with highwing-verify

Preconditions:

- A fixture whose first step awaits `prompt.submit`, such as `fixtures/errand.jsonl`.

- **Send.** Run `$H run --fixture fixtures/errand.jsonl --run send wait live type "Message Hermes" @request click button Send see "In /tmp/hermes-proto-work" shot sent`. `sent.aria.txt` shows the request as the turn's first paragraph, an empty textbox and `button "Stop"`.
- **Enter.** Run `$H run --fixture fixtures/errand.jsonl --run send-enter wait live type "Message Hermes" @request press Enter see "In /tmp/hermes-proto-work" shot sent`. The result is the same as with the button.
- **Ctrl+Enter.** Make the roster fixture once: `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run settings-roster wait live wait bots`. Then set `F=/tmp/highwing-verify/settings-roster/fixture-edited.jsonl`. Settings, and so both switches, exist only in a `--fake-host` run. Run `$H run --fake-host ok --fixture $F --saved remote --run send-mod-enter wait live wait bots click button "/^Hermes on/" wait settings click button Composer unchecked switch "Send with Ctrl+Enter" click switch "Send with Ctrl+Enter" checked switch "Send with Ctrl+Enter" click button Close wait live click textbox "Message Hermes" press h press i press Enter press t press h press e press r press e value "Message Hermes" $'hi\nthere' press Control+Enter see "In /tmp/hermes-proto-work" value "Message Hermes" "" relaunch wait live wait bots click button "/^Hermes on/" wait settings click button Composer checked switch "Send with Ctrl+Enter" quiet`. Enter leaves `hi` and a new line in the box, and Ctrl+Enter sends, so the errand starts and the box empties. The fake gateway shows its recorded request, not the typed text, so the recipe waits for that. The switch is still on after the restart. The tooltip is checked in `apps/desktop/test/group-pane.test.tsx`, since a shot never shows a native tooltip.
- **Focus.** Run `$H run --fixture fixtures/markdown.jsonl --run send-focus wait live type "Message Hermes" @request click button Send focused textbox "Message Hermes" wait settled focused textbox "Message Hermes"`. A press on Send moves focus to the box before Send disables itself for the trip to Hermes, and the turn's end leaves it there.
- **The bot's face waits for the reply.** Run `$H run --fixture fixtures/delegate.jsonl --profiles fixtures/profiles/roster.json --video --run send-face wait live wait bots type "Message Hermes" @request click button Send see Thinking shot thinking wait settled shot settled`. The fixture thinks for about 3 s before its first step. `thinking.png` shows Emu's ink hexagon on the thread line in place of the dot, with three dots for eyes, and `video.webm` shows them bounce in turn until the first step takes over. Add `--reduced-motion` and the dots stand still. A `--timed-shot` screenshot does not catch the bounce, so use the video.
- **Pill, card and time line.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/chats.json --mode chats --chat-only --run message-layout wait live wait bots click button "/^Bot: /" click menuitemradio Research click button "Sort the invoices" said "Sorted fourteen invoices by due date" shot layout quiet`. The seeded chat is days old, so `layout.aria.txt` holds the time line as the article's first paragraph, such as `paragraph: Sat 21 Nov 02:16`, then the request's paragraph with its three buttons, then the reply. `layout.png` shows the date centred, the request in a pill at the right and the reply on a card at the left.
- **Stop goes away.** Continue either run with `wait approval click button "Run once" wait settled shot settled`. `settled.aria.txt` has no `button "Stop"`.

## Gotchas

- The scripted gateway checks the message's key set, not its text. Use `@request` anyway, so the request on screen matches the reference.
- Send is disabled until the chat is live. Always `wait live` before typing.
- Send is also disabled for the few milliseconds the message takes to reach Hermes. A focused control that becomes disabled loses focus to the page if Chromium updates the page in that gap, so a send moves focus to the box first. Without that, focus after Send lands on Send in some runs and on the page in others, more often under load.
