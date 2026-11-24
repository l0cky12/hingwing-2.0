---
name: verify
description: Launch, drive and screenshot the Highwing Electron desktop app (apps/desktop) headlessly under Xvfb with Playwright, replaying a recorded Hermes fixture through the real client or connecting through a fake Hermes machine. Use to prove a renderer, IPC or main-process change works in the real window, to drive the setup screen, to capture design screenshots at the reference size, or to compare against the design C references.
---

# Verify Highwing

Highwing is an Electron viewer for the Hermes agent gateway. The surface a user touches is one desktop window: a bots sidebar, a chat thread, a composer, approval cards and a connection banner. This skill drives that window through Playwright's Electron driver. Every run happens inside a private Xvfb display, so no window reaches the user's Hyprland desktop and two runs can go side by side.

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
- `--fake-host <scenario>` starts the fake Hermes machine of `packages/hermes/src/testing/fake-host.ts` and launches the app with the fake machine's bin directory as its whole `PATH`. That directory holds a fake `ssh`, `tailscale` and `hermes`, so the app runs its real setup check and its real remote dial and reaches nothing real. A tool the scenario lacks is a real "command not found". The scenarios are `ok`, `ok-bound`, `slow` and one per check failure: `tailscale-missing`, `tailscale-off`, `tailscale-signed-out`, `host-not-found`, `host-offline`, `unreachable`, `ssh-missing`, `ssh-denied`, `ssh-check`, `host-changed`, `hermes-not-found`, `hermes-too-old` and `cant-save`. The fake machine is `hermes-host.example-tailnet.ts.net`. Its gateway plays `fixtures/errand.jsonl`, or the file `--fixture` names. The Hermes of `ok` mints the ticket that reaches every bot, so the app can switch bots. The Hermes of `ok-bound` passes the same check and mints none, as an older Hermes does, so the app reaches one profile and refuses to switch.
- `--saved none|local|remote|unreadable|newer` needs `--fake-host`. It writes that `connection.json` into the run's user-data directory before launch. The default is `none`, a first run. `remote` saves the fake machine, and `local` saves this computer, where the fake `hermes` answers.
- `--hold-at tailscale|ssh|attach|relay` needs `--fake-host`. The fake tool that reaches that moment waits for the rest of the run. `ssh` pins the setup check at "Connecting to hermes-host".
- `--drop-after <event type>` is verification scaffolding. It writes a copy of the fixture whose gateway closes the socket 50 ms after the first frame of that type, and plays the copy instead. The copy is saved as `fixture-edited.jsonl` in the evidence directory. The client shows the dropped link until its redial lands about 1 s later.
- `--models <reply.json>` writes a copy of the fixture whose header carries that canned `model.options` reply, and plays the copy. The gateway then lists those models, starts the chat on the reply's `model`, and switches it on a `session.mutate` with operation `model`. Without it the gateway refuses `model.options` as an unknown method, as an older Hermes does. `fixtures/models/three.json` offers three models with `fast-small` current. `fixtures/models/none.json` offers none. It combines with `--drop-after` into one `fixture-edited.jsonl`.
- `--guarded <model,...>` makes a switch to those models need a second yes, as Hermes's guard does for a costly model. An idle switch answers with a confirmation. A switch held during a turn is asked about when the turn ends.
- `--profiles <reply.json>` writes a copy of the fixture whose header carries that canned `profiles.list` reply, and plays the copy. The sidebar then lists those bots. Without it the gateway refuses `profiles.list` as an unknown method, as an older Hermes does, and the sidebar says "This Hermes can't list its bots." `fixtures/profiles/roster.json` holds the six bots of the user's own Hermes, as the approved layout shows them. `fixtures/profiles/edge.json` holds thirty-one awkward ones, one of them hidden. It combines with `--models` and `--drop-after` into one `fixture-edited.jsonl`. The gateway gives every bot whose row names a Bot Chat that chat, holding the row's preview as its one reply, and answers a message there with `<profile>: <text>`. The fixture's story is the default bot's Bot Chat. An untitled `session.create`, which a new chat's first message sends, makes an empty chat `chat-<profile>-<n>` in the routed profile that answers the same way.
- `--bound` needs `--profiles`. It plays a Hermes whose socket reaches only its own profile: the other bots have no previews, launch opens the story as a chat with no bot, and a click on a bot is refused.
- `--no-bot-chat` needs `--profiles`. The default bot then has no Bot Chat, so launch shows its unstarted chat and the story is never opened.
- `--size <width>x<height>` sets the window's content size before the first step, and the size every `shot` must have. The default is 1180x860.
- `--chat-only` makes the size above the size of the chat column. The window grows by the width of whatever sits left of the chat, the sidebar's 288 px, and every `shot` is clipped to the chat column. The ARIA snapshot still covers the whole page. Use it for any shot that a tool reads as a chat with no sidebar: the design C references, `forced-colors-check.mjs` and `chat-parity.mjs`.
- `--forced-colors` emulates the desktop's forced-colors (high-contrast) mode in the first window once it opens, before any step runs, so the window draws only with system colors.
- `--more-contrast` emulates `prefers-contrast: more`.
- `--run <name>` names the evidence directory. The default is a timestamp plus the PID.
- `--timeout <ms>` is the per-step limit. The default is 15000.

Every run sets `HIGHWING_OPEN_LOG` to `opens.jsonl` in the evidence directory. Main then records each request to open a file or show its folder in that file, and opens nothing on the desktop.

Ready means the first window has loaded. Use `wait window` as the first step.

The window's content area is 1180x860, the size of the reference screenshots, unless `--size` or `--chat-only` changes it. `run` passes `--ozone-platform=x11`, `--force-device-scale-factor=1` and `--disable-gpu`, and removes `WAYLAND_DISPLAY`. Electron 45 would otherwise pick Wayland and open the window on the real compositor. `run` also checks that the X server on its display was started by its own `xvfb-run`. Plain `xvfb-run -a` gives two runs started together the same display, and the first teardown would then kill the other run.

Teardown is part of `run`. The app is closed and then killed by PID if it is still alive, whether the steps passed or failed. A `--fake-host` run then fails if a fake tool the app started is still running, because the app must end its own ssh processes when it quits.

## Doctor

`$H doctor` is read-only. It checks node, `xvfb-run`, `magick`, `playwright-core`, the downloaded electron binary, whether the build is current, and that `tsx` is installed to run the fake host. It also lists verify instances that are still running. Every line must read `ok` before you trust a run. A `note` about running instances means an earlier run did not tear down; `$H cleanup --all` stops them.

## Drive

Steps run in order. Each step's arguments are literal; quote names with spaces.

| Step | Arguments | Does |
|---|---|---|
| `wait <state>` | a named state | waits until the state's locator is visible |
| `see <text>` | text | waits until the text is visible anywhere |
| `said <text>` | text | waits until the text is visible in the thread. A bot's preview in the sidebar does not count |
| `click <role> <name>` | ARIA role, exact accessible name | clicks it |
| `type <label> <text>` | exact label, text or `@request` | fills the field. `@request` is the text of the fixture's first `prompt.submit` step |
| `press <key>` | Playwright key name | presses it |
| `click-at <role> <name> <n>` | ARIA role, exact accessible name, a number | clicks the `n`th such control in page order, counting from 1, for a control the thread repeats on every turn |
| `shot <name>` | file stem | moves the pointer off the page, then saves `<name>.png` and `<name>.aria.txt` |
| `disabled <role> <name>` | ARIA role, exact accessible name | fails unless that control is disabled now |
| `value <label> <text>` | exact label, text | waits two frames, then fails unless the field holds exactly that text |
| `field <label> <lines> <fits\|scrolls>` | exact label, a line count, `fits` or `scrolls` | logs how many lines the field shows and whether its text scrolls with a visible scrollbar, and fails unless both match |
| `pinned` | none | logs where the thread sits, and fails unless it is scrolled to its end, its last row is in view (wholly, when it fits), and the composer does not cover it |
| `disabled-at <role> <name> <n>` | ARIA role, exact accessible name, a number | fails unless the `n`th such control, counting from 1 in page order, is disabled now |
| `focused <role> <name>` | ARIA role, exact accessible name | fails unless that control has keyboard focus now |
| `count <role> <name> <n>` | ARIA role, exact name or `/regex/`, a number | fails unless exactly `n` such controls are in the accessibility tree |
| `clipboard <name>` | file stem | waits until the system clipboard holds new text, then saves it as `<name>.clip.txt`. Fails when it stays empty or unchanged since the last `clipboard` step |
| `marks <count>` | number | fails unless the ranges in the `find` and `find-current` highlights add up to the count. A missing highlight counts as 0. It reads state and never sets it |
| `opened <action> <path>` | `open` or `show`, absolute path | fails unless `opens.jsonl` holds exactly one call, and that call is this one |
| `copied <text>` | text | fails unless the system clipboard holds exactly this text |
| `gone <role> <name>` | ARIA role, exact accessible name | polls until no visible element has that role and name, and fails at the timeout. Waits out a fade |
| `inview <role> <name>` | ARIA role, exact accessible name | fails unless that element's box lies fully inside the visible area of every scrolling ancestor and of the window |
| `enabled <role> <name>` | ARIA role, exact accessible name | fails unless that control is enabled now |
| `checked <role> <name>` | ARIA role, exact accessible name | fails unless that radio or checkbox is checked now |
| `current <role> <name>` | ARIA role, exact accessible name | waits until that control carries `aria-current="true"`, as the bot of the open chat does, and fails at the timeout. An ARIA snapshot does not print it |
| `tally <role> <n>` | ARIA role, number | waits two frames, then waits until exactly n elements of that role are shown, and fails if the count never settles on n |
| `absent <text>` | text | fails if the text is visible anywhere now |
| `called <method> <json> <n>` | method, JSON object, number | waits until the gateway was sent n calls of that method whose params contain the JSON (every key, recursively), and fails on any other count. It is checked again when the steps end, so "exactly n" holds for the whole run. `--fixture` runs only |
| `reached <method> <json> <n>` | method, JSON object, number | waits until the gateway was sent at least n calls of that method whose params contain the JSON, and fails at the timeout. Unlike `called`, later calls do not fail it. Use it to wait for a call the app makes by itself, such as a refresh. `--fixture` runs only |
| `quiet` | none | fails if the window logged a console error or a page error so far |

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
| `regenerate` | the thread's "Regenerate" button is enabled, so the chat is idle and its last turn has a stored message to cut before |
| `slash-menu` | the composer's "Commands and skills" listbox is shown |
| `bots` | the sidebar holds a roster Hermes listed (`aside[data-state="listed"]`) |
| `unstarted` | the chat column holds no thread (`main#scroll:empty`), as a chat no message has made yet shows |

`wait` polls with no backoff. The errand's listing step lives about 144 ms at recorded timing. Playwright's own `waitFor` spaces its polls up to 500 ms apart and missed it 3 times out of 3, while this loop caught it 5 times out of 5.

`shot` fails when the image is not 1180x860, or the size `--size` names. After a `wait`, `shot` also fails if that state ended before the screenshot finished. A passing shot therefore shows the moment it was named for. Screenshots disable animations, so the live end's halo pulse never shows.

## Evidence

Each run writes to `/tmp/highwing-verify/<run>/`:

- `steps.log` lists every step with a timestamp, and ends with `PASS` or `FAIL`.
- `<name>.png` and `<name>.aria.txt` hold each shot and the ARIA snapshot of the page at that moment.
- `<name>.clip.txt` holds the clipboard text that a `clipboard` step read.
- `opens.jsonl` holds one JSON line for each open or show call that main accepted.
- `main.log` holds the Electron main process's stdout and stderr. `console.log` holds the renderer console and page errors.
- `failure.png` is the window when a step failed.
- `gateway-calls.jsonl` holds every frame the client sent the scripted gateway, one per line, as it arrived (`--fixture` runs). Main writes it when `HIGHWING_FIXTURE_CALLS` names a file, which `run` always sets.
- `compare-<name>.png` comes from `$H compare <run>`. It puts the reference on the left and the shot on the right. Shots named `tool-running`, `approval`, `settled` and `settled-expanded` pair with `docs/design/reference/tool-running-C.png`, `approval-C.png`, `settled-C.png` and `settled-C-expanded.png`. Those four references show the chat with no sidebar, so take their shots with `--chat-only`. A shot named `bots-approved` pairs with `bots-sidebar.png`, the approved sidebar layout, and shows the whole window.

`node .claude/skills/verify/scripts/chat-parity.mjs <before-run-dir> <after-run-dir>` counts the pixels that differ between the shots of two runs, name by name. It ends in `PASS` only when every pair differs by zero. A missing shot, a size mismatch and a run with no shots are `FAIL`. `--self-test` proves it reports each of those.

Proof standards:

- Drive the real user path. Type into the composer and press Send. Click the approval button. Never call the bridge or set state from the test.
- Capture the action and the state it caused: a shot before and after, plus the ARIA text that names the change.
- A fixture is the production boundary for Hermes. In a `--fake-host` run the boundary is the three commands the app runs: `ssh`, `tailscale` and `hermes`. Nothing else is mocked.
- Never launch the app for a check without `--fixture` or `--fake-host`.

## Cleanup

`$H cleanup --run <name>` or `$H cleanup --all` kills only the PIDs this skill recorded in `/tmp/highwing-verify-scratch/<run>/pid` and `host-pid`, the app and its fake host. It then deletes that scratch directory, which holds the Electron user-data dir. It never touches `/tmp/highwing-verify/`. Never kill Electron by process name, because the user may be running their own.

## Feature map

`features/README.md` indexes one file per user-facing feature, each with a recipe and the end state that proves it. Read the index before driving, and add to it when you add a feature.
