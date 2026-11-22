---
name: verify
description: Launch, drive and screenshot the Highwing Electron desktop app (apps/desktop) headlessly under Xvfb with Playwright, replaying a recorded Hermes fixture through the real client. Use to prove a renderer, IPC or main-process change works in the real window, to capture design screenshots at the reference size, or to compare against the design C references.
---

# Verify Highwing

Highwing is an Electron viewer for the Hermes agent gateway. The surface a user touches is one desktop window: a chat thread, a composer, approval cards and a connection banner. This skill drives that window through Playwright's Electron driver. Every run happens inside a private Xvfb display, so no window reaches the user's Hyprland desktop and two runs can go side by side.

Everything goes through one helper:

```
H=.claude/skills/verify/scripts/highwing-verify.mjs     # from the repo root
$H doctor                     # is this checkout worth driving?
$H build                      # electron-vite build of apps/desktop into apps/desktop/out
$H run [options] <steps...>   # launch, drive, screenshot, tear down; exit 0 only if every step passed
$H compare <run>              # reference | ours composites for every shot named after a reference
$H cleanup --run <run> | --all
```

## Launch

`run` launches the built app (`apps/desktop/out/main/index.js`) with the npm `electron` binary, never `/usr/bin/electron*`. It refuses to start when the build is older than any file in `apps/desktop/src`, `packages/hermes/src` or `packages/thread/src`. Run `$H build` first. Runs share the build read-only, so build once before starting parallel runs.

Options:

- `--fixture <path>` sets `HIGHWING_FIXTURE`. Main then plays that recorded gateway through the real client, and no socket or process outside Electron is touched.
- `--no-fixture` launches with no fixture and with every `PATH` directory that holds a `hermes` executable removed. Hermes is installed on this machine, and without this the app would dial the user's real gateway. With it, the link ends `blocked` (Hermes missing).
- `--run <name>` names the evidence directory. The default is a timestamp plus the PID.
- `--timeout <ms>` is the per-step limit. The default is 15000.

Ready means the first window has loaded. Use `wait window` as the first step.

The window's content area is 1180x860, the size of the reference screenshots. `run` passes `--ozone-platform=x11`, `--force-device-scale-factor=1` and `--disable-gpu`, and removes `WAYLAND_DISPLAY`. Electron 45 would otherwise pick Wayland and open the window on the real compositor. `run` also checks that the X server on its display was started by its own `xvfb-run`. Plain `xvfb-run -a` gives two runs started together the same display, and the first teardown would then kill the other run.

Teardown is part of `run`. The app is closed and then killed by PID if it is still alive, whether the steps passed or failed.

## Doctor

`$H doctor` is read-only. It checks node, `xvfb-run`, `magick`, `playwright-core`, the downloaded electron binary, whether the build is current, and that the `hermes` filter works. It also lists verify instances that are still running. Every line must read `ok` before you trust a run. A `note` about running instances means an earlier run did not tear down; `$H cleanup --all` stops them.

## Drive

Steps run in order. Each step's arguments are literal; quote names with spaces.

| Step | Arguments | Does |
|---|---|---|
| `wait <state>` | a named state | waits until the state's locator is visible |
| `see <text>` | text | waits until the text is visible anywhere |
| `click <role> <name>` | ARIA role, exact accessible name | clicks it |
| `type <label> <text>` | exact label, text or `@request` | fills the field. `@request` is the text of the fixture's first `prompt.submit` step |
| `press <key>` | Playwright key name | presses it |
| `shot <name>` | file stem | saves `<name>.png` and `<name>.aria.txt` |

Named states live in the `STATES` table in the helper. Add a state there, not a sleep.

| State | Visible while |
|---|---|
| `window` | the renderer has mounted |

`shot` fails when the image is not 1180x860. After a `wait`, `shot` also fails if that state ended before the screenshot finished. A passing shot therefore shows the moment it was named for.

## Evidence

Each run writes to `/tmp/highwing-verify/<run>/`:

- `steps.log` lists every step with a timestamp, and ends with `PASS` or `FAIL`.
- `<name>.png` and `<name>.aria.txt` hold each shot and the ARIA snapshot of the page at that moment.
- `main.log` holds the Electron main process's stdout and stderr. `console.log` holds the renderer console and page errors.
- `failure.png` is the window when a step failed.
- `compare-<name>.png` comes from `$H compare <run>`. It puts `docs/design/reference/<name>-C.png` on the left and `<name>.png` on the right.

Proof standards:

- Drive the real user path. Type into the composer and press Send. Click the approval button. Never call the bridge or set state from the test.
- Capture the action and the state it caused: a shot before and after, plus the ARIA text that names the change.
- A fixture is the production boundary for Hermes. Nothing else is mocked.

## Cleanup

`$H cleanup --run <name>` or `$H cleanup --all` kills only the PIDs this skill recorded in `/tmp/highwing-verify-scratch/<run>/pid`. It then deletes that scratch directory, which holds the Electron user-data dir. It never touches `/tmp/highwing-verify/`. Never kill Electron by process name, because the user may be running their own.

## Feature map

`features/README.md` indexes one file per user-facing feature, each with a recipe and the end state that proves it. Read the index before driving, and add to it when you add a feature.
