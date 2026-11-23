---
name: verify
description: Launch, drive and screenshot the Highwing Electron desktop app (apps/desktop) headlessly under Xvfb with Playwright, replaying a recorded Hermes fixture through the real client or connecting through a fake Hermes machine. Use to prove a renderer, IPC or main-process change works in the real window, to drive the setup screen, to capture design screenshots at the reference size, or to compare against the design C references.
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

Every run names one of two gateways. Hermes, ssh and Tailscale are installed on this machine, and a run that named neither would reach the real ones.

- `--fixture <path>` sets `HIGHWING_FIXTURE`. Main then plays that recorded gateway through the real client, and no socket or process outside Electron is touched. The app has no setup screen in this mode.
- `--fake-host <scenario>` starts the fake Hermes machine of `packages/hermes/src/testing/fake-host.ts` and launches the app with the fake machine's bin directory as its whole `PATH`. That directory holds a fake `ssh`, `tailscale` and `hermes`, so the app runs its real setup check and its real remote dial and reaches nothing real. A tool the scenario lacks is a real "command not found". The scenarios are `ok`, `slow` and one per check failure: `tailscale-missing`, `tailscale-off`, `tailscale-signed-out`, `host-not-found`, `host-offline`, `unreachable`, `ssh-missing`, `ssh-denied`, `ssh-check`, `host-changed`, `hermes-not-found`, `hermes-too-old` and `cant-save`. The fake machine is `hermes-host.example-tailnet.ts.net`. Its gateway plays `fixtures/errand.jsonl`, or the file `--fixture` names.
- `--saved none|local|remote|unreadable|newer` needs `--fake-host`. It writes that `connection.json` into the run's user-data directory before launch. The default is `none`, a first run. `remote` saves the fake machine, and `local` saves this computer, where the fake `hermes` answers.
- `--hold-at tailscale|ssh|attach|relay` needs `--fake-host`. The fake tool that reaches that moment waits for the rest of the run. `ssh` pins the setup check at "Connecting to hermes-host".
- `--drop-after <event type>` is verification scaffolding. It writes a copy of the fixture whose gateway closes the socket 50 ms after the first frame of that type, and plays the copy instead. The copy is saved as `fixture-with-drop.jsonl` in the evidence directory. The client shows the dropped link until its redial lands about 1 s later.
- `--run <name>` names the evidence directory. The default is a timestamp plus the PID.
- `--timeout <ms>` is the per-step limit. The default is 15000.

Ready means the first window has loaded. Use `wait window` as the first step.

The window's content area is 1180x860, the size of the reference screenshots. `run` passes `--ozone-platform=x11`, `--force-device-scale-factor=1` and `--disable-gpu`, and removes `WAYLAND_DISPLAY`. Electron 45 would otherwise pick Wayland and open the window on the real compositor. `run` also checks that the X server on its display was started by its own `xvfb-run`. Plain `xvfb-run -a` gives two runs started together the same display, and the first teardown would then kill the other run.

Teardown is part of `run`. The app is closed and then killed by PID if it is still alive, whether the steps passed or failed. A `--fake-host` run then fails if a fake tool the app started is still running, because the app must end its own ssh processes when it quits.

## Doctor

`$H doctor` is read-only. It checks node, `xvfb-run`, `magick`, `playwright-core`, the downloaded electron binary, whether the build is current, and that `tsx` is installed to run the fake host. It also lists verify instances that are still running. Every line must read `ok` before you trust a run. A `note` about running instances means an earlier run did not tear down; `$H cleanup --all` stops them.

## Drive

Steps run in order. Each step's arguments are literal; quote names with spaces.

| Step | Arguments | Does |
|---|---|---|
| `wait <state>` | a named state | waits until the state's locator is visible |
| `see <text>` | text | waits until the text is visible anywhere |
| `click <role> <name>` | ARIA role, exact accessible name | clicks it |
| `type <label> <text>` | exact label, text or `@request` | fills the field. `@request` is the text of the fixture's first `prompt.submit` step |
| `press <key>` | Playwright key name | presses it |
| `shot <name>` | file stem | moves the pointer off the page, then saves `<name>.png` and `<name>.aria.txt` |
| `disabled <role> <name>` | ARIA role, exact accessible name | fails unless that control is disabled now |
| `value <label> <text>` | exact label, text | fails unless the field holds exactly that text now |
| `field <label> <lines> <fits\|scrolls>` | exact label, a line count, `fits` or `scrolls` | logs how many lines the field shows and whether its text scrolls with a visible scrollbar, and fails unless both match |
| `pinned` | none | logs where the thread sits, and fails unless it is scrolled to its end, its last row is in view (wholly, when it fits), and the composer does not cover it |
| `focused <role> <name>` | ARIA role, exact accessible name | fails unless that element is `document.activeElement` now |
| `marks <count>` | number | fails unless the ranges in the `find` and `find-current` highlights add up to the count. A missing highlight counts as 0. It reads state and never sets it |

Named states live in the `STATES` table in the helper. Add a state there, not a sleep.

| State | Visible while |
|---|---|
| `window` | the renderer has mounted a screen |
| `setup` | the setup screen's Connect button is enabled, so no check is running |
| `setup-checking` | the setup screen shows the step a check is at (`role=status`, name "Checking") |
| `setup-failed` | the setup screen shows a failure (`role=alert`) |
| `setup-saved` | the saved screen's "Open chat" button is shown |
| `live` | the composer's Send button is enabled, so the chat is attached and the link is online |
| `tool-running` | a single step whose title starts with "Running" carries the live end (`[data-end="live"]`) |
| `approval` | the "Run this command?" card's "Run once" button is enabled |
| `settled` | the turn's end is the Done ring (`[data-end="done"]`) |
| `offline` | the connection banner (`role=status`, name "Connection") is shown |

`wait` polls with no backoff. The errand's listing step lives about 144 ms at recorded timing. Playwright's own `waitFor` spaces its polls up to 500 ms apart and missed it 3 times out of 3, while this loop caught it 5 times out of 5.

`shot` fails when the image is not 1180x860. After a `wait`, `shot` also fails if that state ended before the screenshot finished. A passing shot therefore shows the moment it was named for. Screenshots disable animations, so the live end's halo pulse never shows.

## Evidence

Each run writes to `/tmp/highwing-verify/<run>/`:

- `steps.log` lists every step with a timestamp, and ends with `PASS` or `FAIL`.
- `<name>.png` and `<name>.aria.txt` hold each shot and the ARIA snapshot of the page at that moment.
- `main.log` holds the Electron main process's stdout and stderr. `console.log` holds the renderer console and page errors.
- `failure.png` is the window when a step failed.
- `compare-<name>.png` comes from `$H compare <run>`. It puts the reference on the left and the shot on the right. Shots named `tool-running`, `approval`, `settled` and `settled-expanded` pair with `docs/design/reference/tool-running-C.png`, `approval-C.png`, `settled-C.png` and `settled-C-expanded.png`.

Proof standards:

- Drive the real user path. Type into the composer and press Send. Click the approval button. Never call the bridge or set state from the test.
- Capture the action and the state it caused: a shot before and after, plus the ARIA text that names the change.
- A fixture is the production boundary for Hermes. In a `--fake-host` run the boundary is the three commands the app runs: `ssh`, `tailscale` and `hermes`. Nothing else is mocked.
- Never launch the app for a check without `--fixture` or `--fake-host`.

## Cleanup

`$H cleanup --run <name>` or `$H cleanup --all` kills only the PIDs this skill recorded in `/tmp/highwing-verify-scratch/<run>/pid` and `host-pid`, the app and its fake host. It then deletes that scratch directory, which holds the Electron user-data dir. It never touches `/tmp/highwing-verify/`. Never kill Electron by process name, because the user may be running their own.

## Feature map

`features/README.md` indexes one file per user-facing feature, each with a recipe and the end state that proves it. Read the index before driving, and add to it when you add a feature.
