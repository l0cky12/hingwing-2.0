# Tray

The tray icon shows how many chats on the open bot are waiting for your OK. Its menu lists those chats. Picking one opens it, and Show Highwing brings the window back. Quit in the menu leaves Highwing. In Settings, the Window page chooses whether closing the window quits or leaves Highwing running in the tray.

## Sub-features

- `tray-quit` shows the Window page on a fresh user-data directory, with Quit checked for When the window closes.

## How to get to it (user POV)

- With a saved connection, press Settings in the top bar. Then pick Window in the Settings nav.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines.
- Make the roster fixture once: `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run settings-roster wait live wait bots`. Then set `F=/tmp/highwing-verify/settings-roster/fixture-edited.jsonl`.

- **Quit checked.** Run `$H run --fake-host ok --fixture $F --saved remote --run tray-quit wait live wait bots click button Settings wait settings click button Window see "When the window closes" checked radio Quit shot tray-quit click radio "Keep in the tray" checked radio "Keep in the tray" quiet`. The Window page shows When the window closes, with Quit checked, because a fresh user-data directory has no close choice saved. `tray.jsonl` in the evidence directory is the tray record. Read the last line. After Keep in the tray, that line's `decision` is `hide`. This Xvfb has no StatusNotifier panel, so a window screenshot does not show the icon. `tray-icon.png` beside the log is the icon proof.
- **One chat waiting.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/chats.json --run tray-count wait live wait bots click button Research wait live quiet`. The last line of `tray.jsonl` counts 1, names `Send invoice reminder`, and the icon draws a 1.

## Gotchas

- The count is the followed bot only. Waiting chats on other bots stay invisible.
- Hiding the window lets the existing turn-end notification fire, because no window is focused.
- A constructor throw leaves quit-on-close in place.
- `setTitle` is not the count.
