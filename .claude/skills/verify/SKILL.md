---
name: verify
description: Launch, drive and screenshot the Highwing Electron desktop app (apps/desktop) headlessly under Xvfb with Playwright, replaying a recorded Hermes fixture through the real client or connecting through a fake Hermes machine. Use to prove a renderer, IPC or main-process change works in the real window, to drive the setup screen, to capture design screenshots at the reference size, or to compare against the design C references.
---

# Verify Highwing

Highwing is an Electron viewer for the Hermes agent gateway. The surface a user touches is one desktop window: a bots sidebar, the open bot's chat list, a chat thread, a composer, approval cards and a connection banner. This skill drives that window through Playwright's Electron driver. Every run happens inside a private Xvfb display, so no window reaches the user's Hyprland desktop and two runs can go side by side.

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
- `--drop-after <event type or request method>` is verification scaffolding. It writes a copy of the fixture whose gateway closes the socket 50 ms after the first frame of that event type, or the first request frame of that method (`sudo`), and plays the copy instead. The copy is saved as `fixture-edited.jsonl` in the evidence directory. The client shows the dropped link until its redial lands about 1 s later.
- `--answered-elsewhere` is verification scaffolding for a fixture in which Hermes asks for things the window would otherwise have to answer, such as the requests of `fixtures/asks.jsonl`. It writes a copy of the fixture without the steps that wait for this client's answer to a request: each `answer` step that carries a result, and each `clarify.lock` and `connection.respond` call. The gateway then plays the `request.cancel` that follows each one as if another client had answered, so the story runs to its end. An `answer` step that carries an error stays, because the app sends that decline itself. It combines with the other fixture edits into one `fixture-edited.jsonl`.
- `--acted-elsewhere` is verification scaffolding for a fixture whose story makes calls the window has no control for yet, such as `fixtures/commands.jsonl` and `fixtures/panels.jsonl`. It writes a copy of the fixture without the steps that wait for them: each `prompt.resolve_unknown`, `prompt.replace_queued`, `prompt.cancel`, `prompt.steer_queued`, `session.steer`, `session.redirect`, `session.export`, `process.kill`, `session.control`, `rollback.list`, `rollback.diff`, `rollback.restore` and `message.react` call. The gateway then plays what followed each call, as when another client makes it. The messages and the approval answer are still the window's to send. The copy is saved as `fixture-edited.jsonl` in the evidence directory.
- `--window-makes <call,...>` needs `--acted-elsewhere`. It keeps the steps of those calls, so the window makes them and the story waits for each. A call is a method, such as `process.kill`, or `session.control:<action>` for one action, such as `session.control:goal.pause`.
- `--answer-here <method,...>` needs `--answered-elsewhere`. It keeps the `answer` steps of requests of those methods (`sudo`, `secret`), and the `clarify.lock` and `connection.respond` calls for a `clarify` batch or a `connection` card, so the window has to answer them. The gateway then waits for the window's answer, and an answer that carries a typed value matches the recorded `•••`.
- `--cancel <method>=<reason>` drops the `answer` step of the first request of that method and sets the reason of that request's `request.cancel` to `<reason>`, as Hermes withdrawing it. `sudo=shutdown` reads as withdrawn, `sudo=timeout` as nobody answering in time. The card is open from the request until the recorded cancel, about 1.5 s for the sudo of `fixtures/asks.jsonl`. It combines with `--answered-elsewhere` into one `fixture-edited.jsonl`.
- `--models <reply.json>` writes a copy of the fixture whose header carries that canned `model.options` reply, and plays the copy. The gateway then lists those models, starts the chat on the reply's `model`, and switches it on a `session.mutate` with operation `model`. Without it the gateway refuses `model.options` as an unknown method, as an older Hermes does. `fixtures/models/three.json` offers three models with `fast-small` current. `fixtures/models/none.json` offers none. It combines with `--drop-after` into one `fixture-edited.jsonl`.
- `--catalog <catalog.json>` writes a copy of the fixture whose header carries that canned `commands.catalog` reply, and plays the copy. Highwing runs a listed command it owns, such as `/busy`, itself. Without it the gateway refuses `commands.catalog` as an unknown method, unless the fixture's own header has one. `fixtures/catalog/busy.json` lists Hermes's `/busy` entry only. It combines with the other fixture options into one `fixture-edited.jsonl`.
- `--guarded <model,...>` makes a switch to those models need a second yes, as Hermes's guard does for a costly model. An idle switch answers with a confirmation. A switch held during a turn is asked about when the turn ends.
- `--usage <usage.json>` writes a copy of the fixture whose header carries that canned usage: `before` and `after`, two `session.stats` replies, and `breakdown`, a `session.context_breakdown` reply. The gateway then answers `session.stats` with `before` until the story's first turn ends and with `after` from then on, puts `after` on the turn's end as its usage, and answers `session.context_breakdown` with `breakdown`. Without it the gateway refuses both calls as unknown methods, as an older Hermes does, and the chat shows no context meter and no token counts. `fixtures/usage/errand.json` starts at 3 percent and ends the errand at about 34 percent with 1,204 tokens in, 380 out and 412 of reasoning. `fixtures/usage/nearly-full.json` ends it at 87 percent. It combines with the other fixture options into one `fixture-edited.jsonl`.
- `--profiles <reply.json>` writes a copy of the fixture whose header carries that canned `profiles.list` reply, and plays the copy. The sidebar then lists those bots. Without it the gateway refuses `profiles.list` as an unknown method, as an older Hermes does, and the sidebar says "This Hermes can't list its bots." `fixtures/profiles/roster.json` holds the six bots of the user's own Hermes, as the approved layout shows them. `fixtures/profiles/edge.json` holds thirty-one awkward ones, one of them hidden. It combines with `--models` and `--drop-after` into one `fixture-edited.jsonl`. The gateway gives every bot whose row names a Bot Chat that chat, holding the row's preview as its one reply, and answers a message there with `<profile>: <text>`. The fixture's story is the default bot's Bot Chat. An untitled `session.create`, which a new chat's first message sends, makes an empty chat `chat-<profile>-<n>` in the routed profile that answers the same way. The file may also hold a top-level `chats` key, which maps a profile to the chats it has beside its Bot Chat. `run` moves it into the header's `chats`, so `profiles.list` never carries it. Each chat is `{ id, title, last_active, rows: [{ role, text }], asking?, hidden?, branched_from? }`. One with `asking: { command, description }` resumes running, waiting on that approval. One with `hidden: true` is listed only to a call that asks for hidden chats, as a Bot Chat is. One with `branched_from: <chat id>` was branched from that chat of the same profile, which `--tree` lists. `session.list` for a profile other than the default lists its chats: stored by last use, and live only the ones that wait. A `session.mutate` that renames one of these chats retitles it, and `session.export` renders its title and messages under Hermes's file name, `hermes_session_<id>.<format>`. `fixtures/profiles/chats.json` gives Research no Bot Chat and three chats, one of them waiting. The file may also hold a top-level `relay` key, which `run` moves into the header's `relay` the same way. It maps a profile to what its bot does with a message handed to it by `bot_relay.deliver`: `{ reply, delay_ms? }` answers with that one reply after the delay, and `{ refuse }` refuses with that reason. A profile with no entry is refused as `runtime_unavailable`. Without the key the gateway refuses every `bot_relay.*` call as an unknown method, as a Hermes without the bot relay does, and `@` opens no list. `fixtures/profiles/team.json` holds Ada, Sam and Rae, with Rae answering after 1500 ms and Sam not running.
- `--paths <file.json>` copies that file into the fixture header's `paths`: `{ cwd?, words }`. `words` maps a typed word such as `@not` to the `complete.path` reply as Hermes sends it, and a word not listed answers `{ items: [] }`. `cwd` becomes the story chat's working folder, which the `@` list names under its files. Without the key the gateway refuses `complete.path` as an unknown method, as a Hermes without it does, and the `@` list holds bots alone. `fixtures/paths/notes.json` holds `@not` (a profile row, which Highwing leaves out, two files and a folder), `@notebooks/`, `@sa` and `@My`. It combines with `--profiles`.
- `--create-warnings <file.json>` sets the header's `createWarnings`, a JSON array of strings that every successful `profiles.create` answers as its `warnings`. Without it the list is empty. `fixtures/profiles/create-warnings.json` holds the warning Hermes gives when it cannot copy a subscription login (hermes_cli/profile_provision.py:259-265). With `--profiles` the gateway answers `profiles.create` as Hermes does: a blank name is refused 4061, and `default`, a name that is no profile id, a reserved name and a name a bot already has are refused 4062 with Hermes's own words. A created bot joins the roster that later `profiles.list` replies give, as the lowercase name under the home path's `profiles/`. It has no Bot Chat and no chats, and a chat made in it answers like any listed bot's. The call needs `--profiles`, and `--bound` answers it as an unknown method, since a socket with no interactive grant does not reach it. Without `--profiles` it is an unknown method too, and the sidebar's New bot says the Hermes cannot create bots. `model.options` with no session answers the `--models` reply, so the form's Model list holds those models.
- `--serve <dir>` serves that folder over http on a free port of 127.0.0.1 for the length of the run, as the fixture's dev server. A folder's `index.html` answers for the folder. It writes a copy of the fixture with the served origin in place of every `http://localhost:5173`, a URL that a reply streams in two pieces included, and plays the copy. The steps `previewing` and `opened browse` put the served origin in the same place, so a recipe names `http://localhost:5173/` and stays the same from run to run. `fixtures/preview` holds the page that `fixtures/preview.jsonl` opens. It combines with the other fixture options into one `fixture-edited.jsonl`.
- `--configure-clash <title>` needs `--profiles`. It sets the header's `configureClash`. The first `profiles.configure` that writes `ui_meta` then finds that another client renamed the bot to `<title>` just before, one revision on, so a rename sent at the revision the app read is refused as a clash and nothing of it is written. Later calls work as usual. With `--profiles` the gateway answers `profiles.describe`, `profiles.configure`, `profiles.set_asset` and `profiles.get_asset` as Hermes does: per-key revisions on `ui_meta`, each section applied on its own, Hermes's picture checks and error codes, and `has_avatar` on the row. A profiles file may also hold a top-level `souls` key, which maps a profile to its persona, the SOUL.md that `profiles.describe` answers. `run` moves it into the header's `souls`. A profile not in it has none. `fixtures/profiles/rae.json` is `roster.json` with Rae added in New section, with a description, a persona and a Bot Chat. `--bound` answers the four calls as unknown methods, as it does `profiles.create`.
- `--pick-file <path>` sets `HIGHWING_PICK_FILE`. Main then takes that file as the one the user picked in place of showing the file dialog, for Upload picture. `fixtures/pictures/rae.png` is a 64x64 PNG and `fixtures/pictures/not-a-picture.txt` is text.
- `--bound` needs `--profiles`. It plays a Hermes whose socket reaches only its own profile: the other bots have no previews, launch opens the story as a chat with no bot, and a click on a bot is refused.
- `--no-bot-chat` needs `--profiles`. The default bot then has no Bot Chat, so launch shows its unstarted chat and the story is never opened.
- `--tree` needs `--profiles`. The gateway then answers `projects.tree` for a profile with its chats beside the story, newest first and three unless `preview_limit` asks for more, as Hermes does. A chat seeded with `branched_from: <chat id>`, and a chat a branch makes, names that chat as its `parent_session_id` and `_branched_from`. The story session is never listed. Without the flag the gateway refuses `projects.tree` as an unknown method, and no message shows a version switcher. `--bound` refuses it too, since a socket with no interactive grant does not reach it. The gateway pages `session.transcript` for a chat beside the story either way. `fixtures/profiles/versions.json` gives Research a chat with two branches made at its second message.
- `--yolo off|on` writes a copy of the fixture whose header carries the story chat's YOLO at the start, and plays the copy. The attach reply then carries `info.yolo`, every Bot Chat starts off, and the gateway answers `config.set` for key `yolo` for the one chat the call names. Without it the gateway refuses `config.set` as an unknown method and sends no `info.yolo`, as an older Hermes does, and the pill is not shown. The gateway refuses any `scope` key, and fails the run when the client sends `scope: "global"`, which would flip the whole profile. It combines with the other fixture options into one `fixture-edited.jsonl`.
- `--yolo-denied` needs `--yolo`. Every YOLO set is then refused `permission_denied`, as Hermes refuses a viewer without control of the chat.
- `--yolo-elsewhere-after <event type>` needs `--yolo`. It adds a `session.info` frame with `yolo: true` 50 ms after the first frame of that type, and moves the seq of every later frame of the session up by one. It stands for another client turning YOLO on.
- `--pick <path[,path]>` sets `HIGHWING_PICK_FILES` to those files, each resolved from the repo root. Main then answers every press of the paperclip ("Attach files") with them, in that order, and opens no file dialog. Without it a press opens the system dialog, which nothing in a run can answer.
- `--attach-limit <bytes>` writes a copy of the fixture whose header carries `attachLimits` with that many bytes for both an image and a file, and plays the copy. Main then refuses to attach a larger file, in words that name the file and the limit. Without it the limits are Hermes's own: 25 MiB for an image and 256 MiB for a file. It combines with the other fixture options into one `fixture-edited.jsonl`.
- `--size <width>x<height>` sets the window's content size before the first step, and the size every `shot` must have. The default is 1180x860.
- `--chat-only` makes the size above the size of the chat column. The window grows by the width of whatever sits left of the chat, the bots and chats columns' 536 px, and every `shot` is clipped to the chat column. The ARIA snapshot still covers the whole page. Use it for any shot that a tool reads as a chat with no sidebar: the design C references, `forced-colors-check.mjs` and `chat-parity.mjs`.
- `--forced-colors` emulates the desktop's forced-colors (high-contrast) mode in the first window once it opens, before any step runs, so the window draws only with system colors.
- `--more-contrast` emulates `prefers-contrast: more`.
- `--run <name>` names the evidence directory. The default is a timestamp plus the PID.
- `--timeout <ms>` is the per-step limit. The default is 15000.

Every run sets `HIGHWING_OPEN_LOG` to `opens.jsonl` in the evidence directory. Main then records each request to open a file, show its folder, or open a link in the browser in that file, and opens nothing on the desktop. A run without `--pick-file` removes any `HIGHWING_PICK_FILE` it inherited. Every run also sets `HIGHWING_SAVE_DIR` to `saves/` in the evidence directory. Main then writes an exported chat there under Hermes's file name, and opens no save dialog.

Every run also sets `HIGHWING_NOTIFY_LOG` to `notices.jsonl` in the evidence directory. Main then records each desktop notification there as a JSON line (`sessionId`, `turnId`, `title`, `body`) and shows nothing on the desktop.

A JavaScript dialog the page opens (`alert`, `confirm` or `prompt`) is logged to `steps.log` as `DIALOG`, dismissed, and fails the run once the steps end. The app never opens one, so a dialog means script ran that should not have.

Ready means the first window has loaded. Use `wait window` as the first step.

The window's content area is 1180x860, the size of the reference screenshots, unless `--size` or `--chat-only` changes it. `run` passes `--ozone-platform=x11`, `--force-device-scale-factor=1` and `--disable-gpu`, and removes `WAYLAND_DISPLAY`. Electron 45 would otherwise pick Wayland and open the window on the real compositor. `run` also checks that the X server on its display was started by its own `xvfb-run`. Plain `xvfb-run -a` gives two runs started together the same display, and the first teardown would then kill the other run.

Teardown is part of `run`. The app is closed and then killed by PID if it is still alive, whether the steps passed or failed. A `--fake-host` run then fails if a fake tool the app started is still running, because the app must end its own ssh processes when it quits.

## Doctor

`$H doctor` is read-only. It checks node, `xvfb-run`, `magick`, `playwright-core`, the downloaded electron binary, whether the build is current, and that `tsx` is installed to run the fake host. It also lists verify instances that are still running. Every line must read `ok` before you trust a run. A `note` about running instances means an earlier run did not tear down; `$H cleanup --all` stops them.

## Drive

Steps run in order. Each step's arguments are literal; quote names with spaces.

| Step | Arguments | Does |
|---|---|---|
| `wait <state>` | a named state | waits until the state's locator is visible, then logs how many ms after launch it appeared |
| `see <text>` | text | waits until the text is visible anywhere |
| `said <text>` | text | waits until the text is visible in the thread. A bot's preview in the sidebar does not count |
| `click <role> <name>` | ARIA role, exact accessible name or `/regex/` | clicks it. A `/regex/` clicks the first match |
| `type <label> <text>` | exact label, text or `@request` | fills the field. `@request` is the text of the fixture's first `prompt.submit` step. Text typed into a password field, or into any field of a masked card or a connector card (`[data-private]`), is written as `•••` in `steps.log`, and that field's value is `•••` in each `.aria.txt`. A failed `value` check on that field names neither value. The run fails if any evidence file holds such typed text, as typed or escaped |
| `select <label> <option>` | exact label, exact option text | picks that option of the labelled select |
| `press <key>` | Playwright key name | presses it |
| `reload` | none | reloads the window, as Ctrl+R in a browser does. Main and the gateway keep running, so the open chat stays. Follow it with `wait live` |
| `click-at <role> <name> <n>` | ARIA role, exact accessible name, a number | clicks the `n`th such control in page order, counting from 1, for a control the thread repeats on every turn |
| `shot <name>` | file stem | moves the pointer off the page, then saves `<name>.png` and `<name>.aria.txt` |
| `disabled <role> <name>` | ARIA role, exact accessible name or `/regex/` | fails unless that control is disabled now |
| `value <label> <text>` | exact label, text | waits two frames, then fails unless the field holds exactly that text |
| `field <label> <lines> <fits\|scrolls>` | exact label, a line count, `fits` or `scrolls` | logs how many lines the field shows and whether its text scrolls with a visible scrollbar, and fails unless both match |
| `pinned` | none | logs where the thread sits, and fails unless it is scrolled to its end, its last row is in view (wholly, when it fits), and the composer does not cover it |
| `disabled-at <role> <name> <n>` | ARIA role, exact accessible name, a number | fails unless the `n`th such control, counting from 1 in page order, is disabled now |
| `focused <role> <name>` | ARIA role, exact accessible name or `/regex/` | fails unless that control has keyboard focus now |
| `count <role> <name> <n>` | ARIA role, exact name or `/regex/`, a number | fails unless exactly `n` such controls are in the accessibility tree |
| `clipboard <name>` | file stem | waits until the system clipboard holds new text, then saves it as `<name>.clip.txt`. Fails when it stays empty or unchanged since the last `clipboard` step |
| `marks <count>` | number | fails unless the ranges in the `find` and `find-current` highlights add up to the count. A missing highlight counts as 0, and so does a collapsed range, which marks nothing. It reads state and never sets it |
| `marked <text>` | text | fails unless the `find-current` highlight holds one range whose text is exactly this. It proves the current match sits on the words find counted. It reads state and never sets it |
| `hues <n>` | number | waits until the last code block in the thread draws its text in exactly n distinct computed colors, and fails at the timeout. It logs the colors it saw |
| `fonts <family>` | a font family, such as `KaTeX_Main` | waits until the page has loaded a face of that family and none is still loading, and fails at the timeout or when a face of it failed to load. It logs each face's style, weight and status. A face loads only once text uses it |
| `steady <lang>` | a fence language, such as `ts` | put it right after Send. It samples the last code block labelled `lang` after every change to the page until the block shows more than one color. It fails if the block showed colors while its fence was open (`data-open`), if it was never plain with its fence closed before the colors, or if the block's height or the thread's scroll height differ between the last closed plain sample and the first colored one. It logs the sample count and both heights |
| `opened <action> <target>` | `open` or `show` and an absolute path, or `browse` and a URL | fails unless `opens.jsonl` holds exactly one call, and that call is this one |
| `nothing-opened` | none | fails if `opens.jsonl` holds any call, so nothing went to the desktop or the browser |
| `previewing <url>` | URL or `/regex/` | waits until the preview pane's page has finished loading that URL, and logs where main draws it and whether it is visible. A failed page counts once its load has stopped |
| `page-says <text>` | text | waits until the text of the page in the preview pane holds the text |
| `blur` | none | takes focus from the window, and fails if any Highwing window still has focus. Playwright's clicks do not give it back |
| `notified <title> <n>` | title, number | waits until `notices.jsonl` holds n notifications with that title, logs each, and fails on any other count. It is checked again when the steps end |
| `home` | none | fails unless the app has one window and its address is still the one it launched with |
| `copied <text>` | text | fails unless the system clipboard holds exactly this text |
| `gone <role> <name>` | ARIA role, exact accessible name or `/regex/` | polls until no visible element has that role and name, and fails at the timeout. Waits out a fade |
| `inview <role> <name>` | ARIA role, exact accessible name or `/regex/` | fails unless that element's box lies fully inside the visible area of every scrolling ancestor and of the window |
| `enabled <role> <name>` | ARIA role, exact accessible name or `/regex/` | fails unless that control is enabled now |
| `checked <role> <name>` | ARIA role, exact accessible name or `/regex/` | fails unless that radio or checkbox is checked now |
| `current <role> <name>` | ARIA role, exact accessible name or `/regex/` | waits until that control carries `aria-current="true"`, as the bot of the open chat does, and fails at the timeout. An ARIA snapshot does not print it |
| `pressed <role> <name> <true\|false>` | ARIA role, exact accessible name or `/regex/`, `true` or `false` | waits until that control's `aria-pressed` equals the value, and fails at the timeout |
| `tally <role> <n>` | ARIA role, number | waits two frames, then waits until exactly n elements of that role are shown, and fails if the count never settles on n |
| `absent <text>` | text | fails if the text is visible anywhere now |
| `called <method> <json> <n>` | method, JSON object, number | waits until the gateway was sent n calls of that method whose params contain the JSON (every key, recursively), and fails on any other count. It is checked again when the steps end, so "exactly n" holds for the whole run. `--fixture` runs only |
| `reached <method> <json> <n>` | method, JSON object, number | waits until the gateway was sent at least n calls of that method whose params contain the JSON, and fails at the timeout. Unlike `called`, later calls do not fail it. Use it to wait for a call the app makes by itself, such as a refresh. `--fixture` runs only |
| `avatar <name> <picture\|letter>` | exact accessible name of a bot row, `picture` or `letter` | waits until that row's avatar draws a loaded picture, or the bot's letter, and fails at the timeout. It logs what the avatar draws |
| `drafts <n>` | number | polls until the run's `user-data/drafts` folder holds exactly n `*.json` files, logs each file's key and text, and fails at the timeout. A `--fixture` run keeps that folder for the next run with the same `--run` name |
| `paste-image <path>` | a PNG file | writes the file to the system clipboard as `image/png`, focuses the "Message Hermes" box and presses Control+V |
| `drag-file <name>` | a file name | dispatches `dragenter` and `dragover` on the thread with a three-byte file of that name, built in the page. The window then shows its drag state until a `drop-file` |
| `drop-file` | none | dispatches `drop` on the thread with the file of the last `drag-file`. That file has no path on this computer, so main refuses it |
| `answered <method> <json> <n>` | request method, JSON object, number | waits until the gateway was sent n answers to a server request of that method that contain the JSON, and fails on any other count. An answer is a result or error frame, so `'{"error":{"code":-32601}}'` counts declines and `'{}'` counts every answer. It is checked again when the steps end. `--fixture` runs only |
| `quiet` | none | fails if the window logged a console error or a page error so far |
| `quiet-except <pattern>` | `/regex/` | like `quiet`, but lets through the errors that match the regex. It logs how many matched |

A `/regex/` name is any name that starts and ends with a slash, as `count` already takes. It is case-sensitive. A step that finds several matches uses the first, except `count`, `focused` and `gone`, which look at all of them. Use one for a name that holds a time or a goal, such as `button /^Thought/`.

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
| `drawn` | the last reply that holds a diagram has none still drawing, so each is drawn or shows why it could not be (`.diagram[data-state]`) |
| `offline` | the connection banner (`role=status`, name "Connection") is shown |
| `regenerate` | the thread's "Regenerate" button is enabled, so the chat is idle and its last turn has a stored message to cut before |
| `slash-menu` | the composer's "Commands and skills" listbox is shown |
| `mentions` | the composer's "Mentions" listbox is shown |
| `relay-waiting` | a message handed to another bot says it waits for that bot (`.turn.relay [role="status"]`) |
| `bots` | the sidebar holds a roster Hermes listed (`aside[data-state="listed"]`) |
| `unstarted` | the chat column holds no thread (`main#scroll:empty`), as a chat no message has made yet shows |
| `preview` | the preview pane beside the chat is shown (`role=region`, name "Preview") |
| `helper-running` | a helper that has started work, not one still waiting to start, carries the live end (`.helper[data-end="live"]` whose hidden state reads "working") |

`wait` polls with no backoff. The errand's listing step lives about 144 ms at recorded timing. Playwright's own `waitFor` spaces its polls up to 500 ms apart and missed it 3 times out of 3, while this loop caught it 5 times out of 5.

Main draws the preview pane's page in a view of its own, over the window, and a page screenshot cannot see it. When that view is shown, `shot` captures it from main and draws it onto the PNG at its place, and logs that it did. A shot with no pane shown is the page screenshot alone, as before. The ARIA snapshot never holds the page's text: use `page-says`.

`shot` fails when the image is not 1180x860, or the size `--size` names. After a `wait`, `shot` also fails if that state ended before the screenshot finished. A passing shot therefore shows the moment it was named for. Screenshots disable animations, so the live end's halo pulse never shows.

## Evidence

Each run writes to `/tmp/highwing-verify/<run>/`:

- `steps.log` lists every step with a timestamp, and ends with `PASS` or `FAIL`.
- `<name>.png` and `<name>.aria.txt` hold each shot and the ARIA snapshot of the page at that moment.
- `<name>.clip.txt` holds the clipboard text that a `clipboard` step read.
- `opens.jsonl` holds one JSON line for each open or show call that main accepted.
- `notices.jsonl` holds one JSON line for each desktop notification main would have shown.
- `main.log` holds the Electron main process's stdout and stderr. `console.log` holds the renderer console and page errors.
- `failure.png` is the window when a step failed.
- `gateway-calls.jsonl` holds every frame the client sent the scripted gateway, one per line, as it arrived (`--fixture` runs). A typed answer's `value` and a connector card's credentials are written as `•••`, so the file proves a value was sent and never what it was. Main writes it when `HIGHWING_FIXTURE_CALLS` names a file, which `run` always sets.
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
