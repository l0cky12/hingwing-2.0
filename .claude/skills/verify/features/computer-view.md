# Computer view

While the agent of the open chat's bot uses its screen, a card above the composer shows its latest frame, asked for every 2 s, with who has control. Open screen, or the top bar's Screen button, opens the view beside the chat, in the preview pane's column. The view shows the screen live, says who has control, and offers Take control or, once the user has it, Hand back. Without the display methods, the view says "This Hermes can't show its screen." When the agent uses no screen, it says "Hermes isn't using its screen right now."

## Sub-features

- `computer-card` shows the frame and "Hermes is using its screen" above the composer while the screen runs, and nothing while it is off.
- `computer-control` takes control and hands it back, each call made once with the viewer id Hermes minted for the socket.
- `computer-unavailable` says plainly that this Hermes can't show its screen.
- `computer-off` says the agent isn't using its screen, and asks for no frame.
- `computer-live` draws the real screen and passes input to it while the user has control. Only a real Hermes streams a screen.

## How to get to it (user POV)

- Click the card above the composer ("Open screen").
- Or click Screen in the top bar of a bot's chat.

## Driving it with highwing-verify

- **The card, take control, hand back.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --display fixtures/display/running.json --run computer-control wait live wait bots see "Hermes is using its screen" shot card click button "Open screen" see "Hermes has control" see "Highwing couldn't reach the screen." click button "Take control" see "You have control" pressed button Screen true shot taken click button "Hand back" see "Hermes has control" see "Hermes is using its screen" called display.lease.acquire '{"profile":"default","viewer_id":"viewer-1"}' 1 called display.lease.release '{"profile":"default","viewer_id":"viewer-1"}' 1`.
- **A Hermes that cannot show its screen.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run computer-unavailable wait live wait bots click button Screen see "This Hermes can't show its screen." called display.status '{"profile":"default"}' 1`.
- **A screen that is off.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --display fixtures/display/off.json --run computer-off wait live wait bots click button Screen see "Hermes isn't using its screen right now." gone button "Open screen" called display.thumbnail '{}' 0`.

## Gotchas

- A fixture has no screen to stream, so the live view always closes with "Highwing couldn't reach the screen." The live view needs a real Hermes whose screen runs: `display.start` for the profile, then the app on a saved local target. No harness option drives the real `hermes`, by design. Stop the screen again with `display.stop` when it was off before.
- noVNC draws JPEG and PNG rectangles from `data:` URLs, which the window's policy refuses. The view draws them from `blob:` URLs instead. A live screen that stays dark gray means that path broke: count the canvas's colors.
