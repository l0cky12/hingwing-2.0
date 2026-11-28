# Theme

Settings has an Appearance page whose first row, Theme, has the segments System, Light and Dark, each drawn as a small window preview in its palette and the picked accent, System split light and dark. System is picked on a first launch, and follows the computer's light or dark setting, at launch and live while Highwing runs. Light and Dark hold that palette whatever the computer says. Main keeps the pick in `theme.json` in the user-data directory and hands it to Chromium as `nativeTheme.themeSource`, so the page's `prefers-color-scheme`, the native scrollbars, fields and menus, and the window's own background all follow it, and a dark launch never shows a light window first. The palettes are dark first: a near-black sidebar, a slightly lighter chat ground and raised surfaces one step lighter, with the same roles in light. Every text color holds 4.5:1 on every surface in both palettes and with more contrast, which `apps/desktop/test/theme.test.ts` checks against `app.css`. A drawn diagram is drawn again in the new palette after a switch.

## Sub-features

- `theme-launch` opens dark on a dark desktop and light on a light one, with System picked.
- `theme-live` follows the desktop from light to dark and back while a chat with code is open.
- `theme-pick` picks Light over a dark desktop and Dark over a light one in Settings, and keeps Dark across a restart.
- `theme-diagram` draws diagrams in the light palette, then again in the dark one after a switch, and back.
- `theme-more` draws the dark palette with its own more-contrast graphite and rule.
- `theme-forced` draws the dark palette under forced colors, which `forced-colors-check.mjs` checks as it does the light one.
- `theme-unit` holds the rules in `apps/desktop/test/theme.test.ts`, `preferences.test.ts`, `ipc.test.ts` and `appearance.test.tsx`, not a run: every light color has a dark value, every text and surface pair holds 4.5:1 in each palette, the window's background is the page's paper, `theme.json` reads and writes like `mode.json`, and a pick sends `setTheme`.

## How to get to it (user POV)

- Press the Hermes button at the foot of the sidebar (or Ctrl+,), open Appearance, and pick System, Light or Dark.
- With System picked, switch the computer between light and dark.

## Driving it with highwing-verify

Preconditions:

- `$H doctor` prints only `ok` lines and the build is current.
- Make the roster fixture once: `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --run settings-roster wait live wait bots`. Then set `F=/tmp/highwing-verify/settings-roster/fixture-edited.jsonl`.
- Note `gsettings get org.gnome.desktop.interface color-scheme` before the runs and check it reads the same after. Each `--system-theme` run checks it too, and fails if it changed.

- **At launch.** Run `$H run --fixture fixtures/errand.jsonl --profiles fixtures/profiles/roster.json --system-theme dark --run theme-launch-dark wait live wait bots palette dark shot launch-dark quiet`, then the same with `--system-theme light`, `--run theme-launch-light`, `palette light` and `shot launch-light`. `launch-dark.png` shows the bots sidebar and the composer on dark paper, with each avatar a light tone and its letter dark.
- **Live.** Run `$H run --fixture fixtures/markdown.jsonl --system-theme light --size 1180x1300 --run theme-live wait live type "Message Hermes" @request click button Send wait settled palette light shot live-light system-theme dark palette dark shot live-dark system-theme light palette light quiet`. Nothing is clicked between the shots: the desktop's switch alone turns the page. `live-dark.png` shows the reply's table, inline code and both code blocks with their syntax colors on dark sheets.
- **A pick in Settings, and a restart.** Run `$H run --fake-host ok --fixture $F --saved remote --system-theme dark --run theme-pick wait live wait bots click button "/^Hermes on/" wait settings click button Appearance checked radio System palette dark shot settings-system click radio Light checked radio Light palette light shot settings-light system-theme light click radio System checked radio System palette light click radio Dark checked radio Dark palette dark shot settings-dark relaunch wait live wait bots palette dark click button "/^Hermes on/" wait settings click button Appearance checked radio Dark quiet`. Light holds over the dark desktop, System then follows the light one, and Dark holds over it and across the restart. Settings opens on Connection each time, so the recipe opens Appearance after each `wait settings`. `settings-dark.png` shows the Appearance page with Dark picked above the "Show in the sidebar" row.
- **Diagrams.** Run `$H run --fixture fixtures/diagram.jsonl --system-theme light --size 1180x1300 --run theme-diagram wait live type "Message Hermes" @request click button Send wait settled wait drawn palette light shot diagram-light system-theme dark palette dark shot diagram-dark system-theme light palette light quiet-except "/^Executing inline event handler/"`. `palette` waits until every drawn diagram holds the page's `--signal-soft`, so it fails while one is still in the other palette. Its log line reads `3 of 3 diagram(s) in its colors`. [Diagrams in replies](./diagram.md) says why the recipe lets one console error through.
- **Dialog.** Run `$H run --fake-host ok --fixture $F --saved remote --theme dark --run theme-dialog wait live wait bots click button New click menuitem "New bot…" type Name Inky click button "Change picture" click button Ink shot dialog-ink quiet`. `dialog-ink.png` shows the dialog over a darker backdrop, and the ink faces with their graphite rim.
- **More contrast.** Run `$H run --fixture fixtures/errand.jsonl --theme dark --more-contrast --chat-only --run theme-more wait live type "Message Hermes" @request click button Send wait approval palette dark shot approval-more quiet`. The `palette` line logs `--graphite #C2C5CC`, the dark more-contrast value. The light one is `#43464E`.
- **Forced colors.** Run `$H run --fixture fixtures/errand.jsonl --theme dark --forced-colors --chat-only --run theme-forced wait live type "Message Hermes" @request click button Send wait tool-running shot tool-running wait approval shot approval click button "Run once" wait settled shot settled click button "Created and edited notes.md 2 steps" click button "Created notes.md +5" click button "Edited notes.md +1 −1" click button "Ran ls -la && ls scratch" shot settled-expanded`, then `node .claude/skills/verify/scripts/forced-colors-check.mjs /tmp/highwing-verify/theme-forced`. It ends in `PASS`. Run the light story of [Forced colors](./forced-colors.md) and its check as well. Both must pass.

## Gotchas

- A run with neither `--theme` nor `--system-theme` emulates a light `prefers-color-scheme`, so a Dark pick there changes nothing on the page. Pass one of them.
- `--system-theme` gives the app a desktop bus of the run's own. It does not go with `--keyring system`, whose Secret Service lives on the desktop's own bus.
- `palette` passes at once when the page already draws that palette. To prove a switch, check the other palette first, as the recipes do.
- The window behind the page is the page's `--paper` in each palette, set by main from `nativeTheme`. A shot cannot see it, because the page covers it. `theme.test.ts` checks the two colors against `app.css`.
- An ink face is the color of the dark paper, so it carries a graphite rim in both palettes. A picture drawn from one keeps it.
- The dark palette's contrast is checked by `theme.test.ts`, not by a run. The recipes show that the palette applies, not that it reads.
