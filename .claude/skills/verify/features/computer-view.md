# Computer view

While the agent of the open chat's bot uses its screen, a card above the composer shows its latest frame, asked for every 2 s, with who has control. Open screen opens the view beside the chat, in the preview pane's column, and is the only way in. The view shows the screen live, says who has control, and offers Take control or, once the user has it, Hand back. Without the display methods, or while the agent uses no screen, there is no card and so no way into the view. A screen that stops while the view is open leaves it saying "Hermes isn't using its screen right now."

## Sub-features

- `computer-card` shows the frame and "Hermes is using its screen" above the composer while the screen runs, and nothing while it is off.
- `computer-control` takes control and hands it back, each call made once with the viewer id Hermes minted for the socket.
- `computer-unavailable` shows no card for a Hermes that can't show its screen.
- `computer-off` shows no card while the agent isn't using its screen, and asks for no frame.
- `computer-preview` gives the pane to a preview asked for while the screen is shown, and Open screen takes it back.
- `computer-live` draws the real screen and passes input to it while the user has control. Only a real Hermes streams a screen.

## How to get to it (user POV)

- Click the card above the composer ("Open screen"). It shows only while the agent uses its screen.

## Driving it with highwing-verify

- **The card, take control, hand back.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --display fixtures/display/running.json --run computer-control wait live wait bots see "Hermes is using its screen" shot card click button "Open screen" see "Hermes has control" see "Highwing couldn't reach the screen." click button "Take control" see "You have control" count region Screen 1 shot taken click button "Hand back" see "Hermes has control" see "Hermes is using its screen" called display.lease.acquire '{"profile":"default","viewer_id":"viewer-1"}' 1 called display.lease.release '{"profile":"default","viewer_id":"viewer-1"}' 1`.
- **A Hermes that cannot show its screen.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run computer-unavailable wait live wait bots called display.status '{"profile":"default"}' 1 count button "Open screen" 0 count region Screen 0`.
- **A screen that is off.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --display fixtures/display/off.json --run computer-off wait live wait bots called display.status '{"profile":"default"}' 1 count button "Open screen" 0 called display.thumbnail '{}' 0`.

- **A preview takes the pane.** Run `$H run --fixture fixtures/preview.jsonl --serve fixtures/preview --display fixtures/display/running.json --run computer-preview wait live click button "Open screen" count region Screen 1 type "Message Hermes" @request click button Send wait preview gone region Screen click button "Open screen" count region Screen 1 gone region Preview`.

## Gotchas

- A fixture has no screen to stream, so the live view always closes with "Highwing couldn't reach the screen." The live view needs a real Hermes whose screen runs: `display.start` for the profile, then the app on a saved local target. No harness option drives the real `hermes`, by design. Stop the screen again with `display.stop` when it was off before.
- noVNC draws JPEG and PNG rectangles from `data:` URLs, which the window's policy refuses. The view draws them from `blob:` URLs instead. A live screen that stays dark gray means that path broke: count the canvas's colors.
