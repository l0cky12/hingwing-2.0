# Remote route, saved connection and setup

Design for issue #7. Status: reviewed. The remote route, the setup check, the saved connection and the setup screen are built against it. "Implementation reconciliation" at the end lists where the code differs and why.

## Problem

Highwing reaches Hermes only on its own machine. `cliMint` in `packages/hermes/src/wire/link.ts` runs `hermes gateway attach --json` locally, and `dialWith` dials the loopback URL it prints. The goal is a Highwing on an Arch laptop that reaches the Hermes gateway on another machine of the same tailnet, chosen in a setup screen, with the local route unchanged and an Arch package to install.

The gateway's rules shape the answer. It listens on loopback only. It redeems a native ticket only from a loopback peer and only when the upgrade has no `Origin` header (`gateway/run_api.py:472-493` in Hermes 0.23.3). A ticket is single-use and expires 30 s after it is minted (`gateway/runtime_bootstrap.py:37-76`). It is bound to the gateway instance, profile and purpose, not to the peer address.

## What Hermes supports

Hermes documents one contract for this case: `website/docs/developer-guide/gateway-ssh-clients.md`, "Gateway over SSH: client contract". The client machine needs only `ssh`. The Hermes machine needs `hermes`. The client runs `hermes gateway attach --json` on the Hermes machine over ssh, forwards the loopback port it names, and dials with its ticket. A forwarded connection arrives on the Hermes machine from 127.0.0.1, so the loopback rule holds.

Routes Hermes has that this design does not use:

| Route | Why not |
|---|---|
| `hermes serve --isolated` over ssh (Hermes Desktop's "ssh" kind) | Authenticates with a long-lived `?token=`, not a single-use ticket. Needs `python3` on the Hermes machine. |
| Remote URL with OAuth (`POST /api/auth/ws-ticket`) | Needs a non-loopback Webapp bind (`0.0.0.0` only) and an auth provider on the Hermes machine. |
| Forwarding the control socket | Not a contract. The socket checks the OS user on the same machine. |
| `hermes gateway tickets --serve --json` channel | Its `interactive` ticket serves every profile. Highwing uses one profile, the channel never starts a gateway, and `attach` is still needed for the port. Kept as the path for a multi-profile Highwing. |

Hermes has no Tailscale integration of its own. Tailscale's part is name resolution and transport for ssh, plus the setup check below.

## Usage

```ts
// apps/desktop/src/main/index.ts
const routeFor = (target: Target): Route =>
  target.kind === 'local' ? { dial: liveDialer(), dispose: () => {} } : remoteRoute(target.host)

const owner = fixture
  ? pinnedConnection(openHermes({ dial: scriptedDialer(fixture), client }))
  : ownConnection({ loaded: await loadSettings(dir), save: t => saveSettings(dir, t), check: checkTarget, routeFor, open })
serveWindows(owner, ipcMain, isAppUrl)

// renderer
const setup = useTopic('setup')
run({ do: 'checkTarget', target: { kind: 'remote', host: 'hermes-host.example-tailnet.ts.net' } })
run({ do: 'editTarget' })   // the top bar's Connection button
run({ do: 'openChat' })     // the saved screen's Open chat button

// a unit test: a full remote dial, no network, no real ssh
const host = await fakeHost('ok', gateway)
const route = remoteRoute(FAKE_HOST, { sshBin: host.ssh })
const hermes = openHermes({ dial: route.dial, client })
```

```
$H run --fake-host host-not-found --saved none \
  wait setup  type "Hermes machine" hermes-host.example-tailnet.ts.net  click button Connect \
  wait setup-failed  shot setup-host-not-found
```

## Shape

### Saved settings (the first state on disk)

```ts
// packages/hermes/src/domain/reach.ts
type SshHost = string & { readonly [sshHost]: true }   // only parseSshHost makes one
type Target =
  | { readonly kind: 'local' }
  | { readonly kind: 'remote'; readonly host: SshHost }   // "[user@]name", never starts with "-"
```

On disk, `connection.json` in Electron's `userData` directory, mode 0600. That is `~/.config/Highwing/` once `productName` is `Highwing`, or the directory a `--user-data-dir` flag names:

```json
{"version": 1, "target": {"kind": "remote", "host": "hermes-host.example-tailnet.ts.net"}}
```

- One field. User, port and key come from `~/.ssh/config`, because Highwing runs the system `ssh`. A different login name goes in the field as `user@hermes-host`. ssh gets the whole value. The Tailscale `peer` step matches only the part after `@`. The hermes path on the far machine is found again on every run, so it is never saved and cannot go stale.
- `parseSettings(text)` is pure and the only code that knows the shape. It returns `none | saved | unreadable | newer`. The same `targetOf` parser guards the IPC command, so the file and the window cannot disagree on what a valid target is.
- An unreadable or newer file opens setup with a notice and stays untouched. The first save renames it to `connection.<reason>-<ms>.json`, then writes a temp file, fsyncs it and renames it over `connection.json`. A crash leaves the old file or the new one, and a file from a newer Highwing is never lost.
- `settings.ts` takes the directory as an argument and imports nothing from Electron.

### Remote route

`remoteRoute(host)` returns a `Route`, `{ dial: Dialer; dispose(): void }`. Its `dial` is `dialWith(remoteMint(host))`. `dialWith` (including its `error` listener from #9), `connect`, `cliMint` and `liveDialer` do not change, so the handshake, heartbeat, backoff, the no-`Origin` dial and the protocol check run the code the local route runs today. The local route is `{ dial: liveDialer(), dispose: () => {} }`.

One dial:

1. **Probe (first dial only, memoised).** `ssh <host> <locate> gateway tickets --probe --json`. This honours client rule 1. If it reports `windows_service_session: true`, Highwing never passes `--start` (client rule 2).
2. **Attach.** `ssh <host> <locate> gateway attach --json`, with `--start --timeout 75` when the dial asks to start the gateway and `--timeout 20` otherwise. This gives a fresh ticket and the gateway's current loopback port.
3. **Relay.** Highwing listens on `127.0.0.1:0`, accepts one connection, closes the listener and pipes the connection through `ssh <host> -W 127.0.0.1:<port>`. The mint returns `ws://127.0.0.1:<relay port>/api/ws` with attach's `protocols`. If no byte comes back from the far side within `UPGRADE_MS` (10 s, the same as `HANDSHAKE_MS`), the relay destroys the socket and kills the ssh. `dialWith` then sees a close before open and rejects with `dropped`, so a stalled upgrade cannot hold a dial open.
4. **Dial.** `dialWith` dials it with Node's `WebSocket`, which sends no `Origin`. The ticket travels from attach's stdout to `protocols` to the upgrade and nowhere else.

`<locate>` is a fixed `sh -c` script that copies Hermes's own locator (`hermes_cli/gateway_connections_ssh_remote.py:201-224`). It tries `bash -lc 'command -v hermes'`, then `~/.local/bin/hermes`, `/usr/local/bin/hermes` and `~/.hermes/hermes-agent/venv/bin/hermes`, and exits 127 when none is there. Remote commands are literal tuples (`HermesArgs`), so no typed value is ever put into a remote shell string. ssh options copy Hermes's transport: `BatchMode=yes`, `StrictHostKeyChecking=accept-new`, `ConnectTimeout=10`, `ServerAliveInterval=15`, `ServerAliveCountMax=3`.

Process ownership. Nothing runs between dials and there is no ControlMaster. The route keeps every child and every open relay in one set, and `dispose()` kills them all and refuses later dials with `dropped`. The connection owner calls `dispose()` when it closes that route's `Hermes`. This covers a switch or a quit while a dial is still pending: `connect().close()` closes a socket only after the dial resolves (`wire/link.ts:310`), so without `dispose()` a pending attach or a stalled upgrade could keep the old host's ssh alive for up to 90 s.

| Child | Owner | Ends when |
|---|---|---|
| probe | the route's memo | it exits, 20 s, or `dispose()` |
| attach | that dial's mint | it exits, 35 s (90 s with `--start`), or `dispose()` |
| `ssh -W` | the relay's one socket | the socket closes, no reply within `UPGRADE_MS`, or `dispose()`. Its own exit destroys the socket. |
| check commands | the running check | the check is replaced or cancelled (`AbortSignal`), or its deadline |

A gateway that restarts on another port needs no handling, because the next attach names the new port. A Highwing that crashes leaves no ssh behind, because `ssh -W` exits when its stdin closes.

`start` keeps Highwing's rule on both routes. `--start` is passed on the first dial after launch and when the user presses Start, and never on an automatic retry. This departs from the contract's rule 3 ("`attach --start` on every reconnect") on purpose, so that both routes follow one rule.

### Failures

The `DialError` kinds grow by five. Each needs a row in `WORDS` and `RETRIES`, which are `Record`s over the union, so a missing row fails to compile.

| Cause | Kind | Retries |
|---|---|---|
| ssh exit 255 with no match, DNS failure, refused, deadline | `unreachable` (new) | yes |
| `ssh` not installed (`ENOENT`) | `ssh-missing` (new) | no |
| Permission denied, publickey | `ssh-denied` (new) | no |
| Tailscale SSH check mode ("To authenticate, visit") | `ssh-check` (new) | no |
| Host key changed | `host-changed` (new) | no |
| Locator exit 127 | `hermes-missing`, reworded to name the far machine | no |
| attach exits 2 to 7 | the existing `EXIT_KINDS` | as today |
| `-W` fails, or a close before open | `dropped` (the existing default, which covers the likely 4401 for a stale ticket) | yes |

ssh's own failures are classified by one ordered table, `SSH_STDERR`, in the order Hermes's `classify_ssh_error` uses. A deadline classifies the stderr captured so far before it falls back to `unreachable`. This matters because Tailscale's check mode waits for a browser instead of failing. Stderr is read only to classify and is never logged.

### Setup check

`checkTarget(target, { signal, onStep })` lives in `wire/check.ts` and runs in main. It starts nothing.

| Step | Command | Failures |
|---|---|---|
| `tailscale` | `tailscale status --json` on this computer | `tailscale-missing`, `tailscale-off` (`BackendState` is not `Running`), `tailscale-signed-out` (`NeedsLogin`) |
| `peer` | the same JSON | `host-not-found` (no `Peer` matches the host part after any `user@`, by `DNSName` with any trailing dot dropped, by `HostName`, or by `TailscaleIPs`), `host-offline` (`Online: false`) |
| `ssh` | one ssh run of `<locate> gateway tickets --probe --json` | `unreachable`, `ssh-missing`, `ssh-denied`, `ssh-check`, `host-changed` |
| `hermes` | the exit code of that same run | `hermes-not-found` (127), `hermes-too-old` (any other exit, or no JSON) |

"This computer" runs the `hermes` step only, with the probe run locally. The `tailscale status --json` key names were measured on Tailscale 1.104 (keys only, no values read). `CHECK_FAILURES` in `domain/reach.ts` is `Record<CheckFailure, { step, words, fix }>`. It is the whole taxonomy, read by main and the renderer alike. Example rows: "Tailscale isn't running on this computer.", "No machine called hermes-host is on your tailnet.", "Hermes isn't installed on hermes-host.", each with a one-line fix.

### Who owns setup

`main/connection.ts` exports `ownConnection(deps)`. It is the single owner of the `Setup` value, the saved target and the live `Hermes`. It imports nothing from Electron, so a test drives it with a temp directory, a fake check and scripted dialers.

```ts
type Setup =
  | { at: 'chat'; live: Live }                                                  // the normal state
  | { at: 'form'; live: Live | null; notice: 'unreadable' | 'newer' | null }    // live !== null: editing
  | { at: 'checking'; live: Live | null; target: Target; step: CheckStep }
  | { at: 'failed'; live: Live | null; target: Target; failure: CheckFailure }
  | { at: 'saved'; live: Live }                                                 // confirmation
  | { at: 'pinned' }                                                            // HIGHWING_FIXTURE: no setup
type Live = { target: Target; epoch: number }
```

`nextSetup(setup, event)` is a pure transition table. A command that does not apply in the current state is refused. A step from a superseded check is dropped by a generation guard.

| From | Event | To |
|---|---|---|
| (launch) | settings `saved` | `chat` |
| (launch) | settings `none`, `unreadable` or `newer` | `form` with `live: null` and the notice |
| `chat` | `editTarget` | `form` with the same `live` |
| `form`, `failed` | `checkTarget(t)` | `checking` at the first step |
| `checking` | a step finishes | `checking` at the next step |
| `checking` | a step fails | `failed` |
| `checking` | the check passes and the save succeeds | `saved` with the new `live` |
| `checking` | the check passes and the save fails | `failed` with `cant-save` |
| `form`, `checking`, `failed` with `live` | `keepTarget` (Cancel) | `chat` with that `live`. A running check is aborted. |
| `saved` | `openChat` | `chat` |

The Bridge keeps its two methods, `watch` and `run`. `Topic` gains `'setup'`. `Command` gains `checkTarget`, `editTarget`, `keepTarget` and `openChat`, each with a row in `validators`.

Saving a target goes in this order:

1. The check passes.
2. The owner saves the target.
3. It opens a new `Hermes` with `routeFor(target).dial` and bumps `epoch`.
4. It closes the old `Hermes` and calls the old route's `dispose()`. That kills its relay's ssh and any attach still running.

A failed check never touches the live connection. Re-checking the live target does not switch.

### Renderer

`App.tsx` reads the `setup` topic:

- `chat` draws the chat, keyed by `live.epoch`.
- `form`, `checking` and `failed` draw `Setup.tsx`.
- `saved` draws the saved screen with an Open chat button.
- `pinned` draws the chat, as fixture runs do today.

The renderer decides nothing from `live`. Each state names its own screen. While `live` is not null, the chat subtree stays mounted under the setup screen with the `hidden` attribute, so an unsent draft survives Connection and Cancel. Only a new `epoch` remounts it, and a switch to another host is the one action that drops a draft. The top bar gets a Connection button that sends `editTarget`. Cancel shows only when `live` is not null.

A switch remounts the chat subtree with the new epoch. Its `watch` calls then unsubscribe and subscribe again through the normal path, so `main/ipc.ts` needs no rebind logic. A window reload was rejected because `serveWindows` drops a window's subscriptions only on `destroyed`, which a reload does not fire. The old subscriptions would leak.

### Testability

- **Pure tables.** `parseSshHost`, `sshFailureOf`, the Tailscale verdicts, `parseSettings` and `nextSetup` are tested from literal inputs.
- **Fake host (`packages/hermes/src/testing/fake-host.ts`).** It writes fake `ssh`, `tailscale` and `hermes` executables (Node scripts) into a temp bin directory. They ask a 127.0.0.1 control server what to do. Fake `attach` mints from the existing `loopback()` scripted gateway, which already refuses an `Origin` header or a reused ticket. It prints a port that only the fake `ssh -W` resolves, so a client that skips the tunnel fails. `SCENARIOS` is keyed by `CheckFailure | 'ok' | 'slow'`, so a new failure kind does not compile without a scenario. `holdAt` pauses a scenario at a step, which pins the checking state for a screenshot without a sleep.
- **Remote dial tests.** The errand fixture plays through `remoteRoute` with Origin-free, single-use upgrades. A restarted gateway on a new port is followed by the next dial. `--start` appears only on launch and on Start. No ssh child is alive after `close()` and `dispose()`, including when they run while an attach is pending and while the upgrade stalls.
- **Verify skill.** It gains `--fake-host <scenario>`, which sets `PATH` to the fake bin directory alone so `*-missing` is a real `ENOENT`. It also gains `--saved none|local|remote`, which writes `connection.json` into the run's `--user-data-dir` (the helper already passes one, `highwing-verify.mjs:211`). It shoots empty, checking, every failure, saved, and a remote chat that goes live, and checks that `--saved remote` starts on the chat.

### Packaging

The route is a `PKGBUILD` that bundles the pinned Electron 45.4.1 release zip, checksummed in `source`, into `/usr/lib/highwing`. It ships a `/usr/bin/highwing` launcher, `highwing.desktop` and a hicolor icon. `scripts/package-linux.mjs` stages `resources/app`: the electron-vite `out/` folder plus a generated `package.json` with `name`, `version`, `type: "module"` and `main: "out/main/index.js"`, because Electron reads `main` from that manifest to start. The script fails if the bundle still imports a workspace package by bare name.

`depends` lists Electron's own runtime libraries, copied from Arch's `electron44` package (`gtk3`, `nss`, `alsa-lib` and the rest), plus `openssh`. `tailscale` is optional. The launch proof installs only the declared dependencies and the display tools (Xvfb, the screenshot tool), so a missing library fails it.

Why bundled. Arch's `extra` repository ships `electron39` to `electron44` and no `electron45` (measured in `archlinux:latest`). A dependency on `electron44` would run a major version that no test and no verify run has seen. An AppImage needs FUSE 2 and gives no pacman integration.

The proof is `makepkg -si` as a non-root user in a clean `archlinux:latest` container. Then `highwing` starts from the shell, and `gtk-launch highwing` starts it from the desktop entry, both under Xvfb.

## Module map

| Path | Status | Holds |
|---|---|---|
| `packages/hermes/src/domain/reach.ts` | new | `Target`, `SshHost`, `parseSshHost`, `CheckStep`, `CheckFailure`, `CHECK_FAILURES`, `STEP_WORDS` |
| `packages/hermes/src/domain/session.ts` | changed | five new `Why` kinds |
| `packages/hermes/src/wire/link.ts` | changed | `WORDS` and `RETRIES` rows; exports `EXIT_KINDS` and `endpointOf` to `remote.ts` |
| `packages/hermes/src/wire/ssh.ts` | new, private | `SSH_OPTIONS`, `HermesArgs`, `remoteHermes`, `sshExec`, `SSH_STDERR`, `relay` |
| `packages/hermes/src/wire/remote.ts` | new, private | `remoteRoute`, `Route`, the probe memo |
| `packages/hermes/src/wire/check.ts` | new, private | `checkTarget` |
| `packages/hermes/src/hub.ts` | changed | exports `remoteRoute`, `Route`, `checkTarget` |
| `packages/hermes/src/testing/fake-host.ts` | new | `fakeHost`, `SCENARIOS` |
| `apps/desktop/src/main/settings.ts` | new | `parseSettings`, `loadSettings`, `saveSettings` |
| `apps/desktop/src/main/connection.ts` | new | `ownConnection`, `nextSetup`, `pinnedConnection` |
| `apps/desktop/src/main/index.ts`, `ipc.ts` | changed | compose the owner; serve the `setup` topic |
| `apps/desktop/src/ipc-contract.ts` | changed | `Setup`, three commands and their validators |
| `apps/desktop/src/renderer/setup/Setup.tsx`, `App.tsx`, `chrome/Chrome.tsx` | new, changed | the screen, routing by `setup`, the Connection button |
| `packaging/arch/`, `scripts/package-linux.mjs`, `apps/desktop/build/icon.svg` | new | the Arch package |
| `.claude/skills/verify/` | changed | `--fake-host`, `--saved`, setup states |
| `README.md` | changed | "Install on Arch" and "Connect over Tailscale" |
| `docs/compatibility.md` | changed | the remote route's Hermes commands (`attach --json`, `tickets --probe --json`) and what an older Hermes shows |

`@highwing/hermes` gains two exported functions, the `Route` type and the domain tables. The ssh options, the locator, the stderr table, the relay and the Tailscale JSON stay inside `wire/`. No file in `packages/hermes` imports Electron.

## Synthesis decision

Four runners (Opus, Fable, Sonnet, Haiku) designed this independently. A Fable judge scored them against a six-point rubric. Opus and Fable tied at 28 of 30. Sonnet scored 21 and Haiku 16. The base is Opus's design. It leaves `dialWith` unedited, so the local route is unchanged by construction. It keeps all setup state in main behind one pure table, and it honours client rules 1 and 2 through the probe.

Grafted:

- **From Fable.** The chat remount keyed on an epoch, in place of a window reload, for the subscription leak described under Renderer. The explicit `saved` state with Open chat, which the issue's screenshot list needs. The fake host's private port and `holdAt`. The staging script's guard against bare imports.
- **From Sonnet.** A timestamped set-aside for a corrupt or newer settings file.
- **From the judge.** Classifying stderr when an ssh deadline hits, so Tailscale's check mode reads as `ssh-check` rather than a silent retry.

Rejected:

- **Sonnet's ControlMaster with `-O forward`.** A supervised background master, stale control sockets, forward replacement when the port moves, and a free-port race. It buys faster redials only.
- **Haiku's `--serve` channel.** It needs a port that is unknown until attach, and it adds a second lifecycle.
- **Haiku's pin to Electron 44.** It downgrades the runtime every test runs on.

## Tradeoffs accepted

- We accept two ssh handshakes per dial in exchange for no state between dials: no master, no forward to keep in step, no orphan process. A user's own `ControlMaster` in `~/.ssh/config` still applies and makes them cheap.
- We accept a login shell on the Hermes machine on every run in exchange for never saving a path that can go stale.
- We accept that a `-W` refused by the far machine shows as "Reconnecting" with backoff, rather than as its own blocked error, in exchange for leaving `dialWith` untouched.
- We accept a package of roughly 100 MB (estimated) in exchange for running the Electron the tests ran.
- We accept that a remote target requires Tailscale on this computer. A plain ssh alias outside the tailnet fails the `peer` step.

## Open questions and risks

1. Does Tailscale SSH allow the `direct-tcpip` channel that `ssh -W` opens? It is the same channel `-L` uses, which Hermes's own transport relies on (inferred, not tried). If it does not, `relay` swaps to a per-socket `ssh -L` behind the same signature.
2. Should the setup check also prove forwarding works, so the risk in 1 shows on the setup screen instead of as endless reconnects? That needs a running gateway, so it is left to the first live dial.
3. Should setup accept a target that is not on the tailnet (plain ssh) by skipping the Tailscale steps? This design says no, to keep one path.
4. Should the package go to the AUR? That needs a public source URL. This work ships the `PKGBUILD` in the repo and builds it locally.
5. The Wayland flag in the launcher (`--ozone-platform-hint=auto`) is unverified on Electron 45. The container proof runs under Xvfb and cannot settle it.

## Implementation reconciliation

Where the code differs from the text above. The text above is unchanged, so each row says what it replaces.

### Remote route and setup check (`packages/hermes`)

| The design said | The code does | Why |
|---|---|---|
| `CheckStep` is `tailscale`, `peer`, `ssh`, `hermes`. `cant-save` is a `failed` state. | `CheckStep` has a fifth member, `save`. `cant-save` is a `CheckFailure` whose step is `save`. `checkTarget` never returns it. | `Setup.failed` holds a `CheckFailure`, and every row of `CHECK_FAILURES` needs a step. The save belongs to the connection owner and runs after the check, so it is its own step. |
| `SCENARIOS` is keyed by `CheckFailure`, `ok` and `slow`. | The same. Each row also carries a `verdict`, the result `checkTarget` gives. The `cant-save` row is a host that passes, with `verdict: null`. | The fake host cannot fail a save. The owner of the settings file fails it. The key still makes a new failure kind fail to compile without a row. |
| The fake `ssh` is one of three executables that "ask a control server what to do". | The same. The fake `ssh` does not run the locator script in a shell. It checks that the command has the shape `sh -c '<script>' hermes <args>` and answers for the far Hermes. `test/ssh.test.ts` runs the real script in `sh` against stand-in paths. | The locator tries `/usr/local/bin/hermes` and the login shell's `hermes`. Run for real on a developer machine, it can start the real Hermes. The locator takes its paths as an argument so the test can point it at temp files. |
| `slow` is a scenario. `holdAt` pauses a scenario at a step. | `slow` is a far machine that never answers, so ssh is killed at its deadline and the result is `unreachable`. `holdAt` takes `tailscale`, `ssh`, `attach` or `relay`. | A check needs only the first two hold points. The route tests need a pending attach and a stalled upgrade. |
| A peer matches by `DNSName`, `HostName` or `TailscaleIPs`. | A peer also matches by the first label of its `DNSName`. | That label is the MagicDNS short name ssh resolves. It differs from `HostName` when a machine was renamed in the Tailscale admin console. |
| `SSH_STDERR` is one ordered table in the order of `classify_ssh_error`. | The table has Hermes's first three rows. Hermes's fourth row, the unreachable patterns, is the fallback. | An unmatched stderr and a matched unreachable pattern give the same kind, so the row would decide nothing. |
| `domain/reach.ts` holds `Target`, `SshHost`, `parseSshHost`, `CheckStep`, `CheckFailure`, `CHECK_FAILURES`, `STEP_WORDS`. | It also holds `targetOf`, `machineOf`, `hostPart` and `SshFailure`. The words in both tables are functions of the machine's name. | `targetOf` must be importable by the renderer's contract. The example rows name the machine, so a row is a function, and `machineOf` gives it "this computer" or the short name. |
| `wire/ssh.ts` holds `SSH_OPTIONS`, `HermesArgs`, `remoteHermes`, `sshExec`, `SSH_STDERR`, `relay`. | It also holds `runTool` (one child process with a deadline and an `AbortSignal`), `probeOf` and `probeHermes`. | The check and the route read the probe the same way, and `tailscale status` and the local probe need the same child-process handling as ssh. |
| The probe is memoised on the first dial. | Only an answer is memoised. A probe that failed runs again on the next dial. | A machine that was unreachable at launch must not stay unreachable. |
| The relay ends when the socket closes, on no reply within `UPGRADE_MS`, or on `dispose()`. | The relay's listener also closes when nothing dials it within `UPGRADE_MS`. | A dial that is replaced between the mint and the dial would otherwise leave a listening port. |
| The route's errors use `WORDS`. | A remote dial passes the sentence from `CHECK_FAILURES`, which names the machine. `WORDS` gets a row per new kind, built from the same table. A Windows service session that finds no gateway says to start Hermes from that machine's desktop (client rule 2). | One table holds the words, and the banner names the machine it could not reach. |
| Tests play the errand "through `remoteRoute`". | `scriptedDialer` takes a function as `transport`, and `play` takes `ended`. | The errand had to play through a dialer the test builds. Over a relay the last frames arrive after the story ends, so the test names the session it waits for. |

### Saved connection and setup screen (`apps/desktop`)

| The design said | The code does | Why |
|---|---|---|
| `Command` gains `checkTarget`, `editTarget`, `keepTarget` and `openChat`. | `Command` is unchanged. `ipc-contract.ts` adds `SetupCommand` and `AppCommand = Command \| SetupCommand`. `validators` has a row per verb of both. | `Command` is what `Hermes.run` accepts. The setup verbs are answered by the connection owner, which has no gateway behind it on a first run. |
| `serveWindows(owner, ...)` and a `Hermes` behind it. | `ConnectionOwner` is `setup`, `hermes` and one `run` for every command. `run` sends a setup verb through `nextSetup` and any other verb to the live `Hermes`, or refuses it as `offline` when none is live. | The window has one `run`. One place decides which side a verb belongs to. |
| `checking` with `keepTarget` goes to `chat`. | The same, except at step `save`, where `keepTarget` is refused. | A Cancel between the save and the switch would leave the file and the chat on different machines. |
| A check that passes saves and opens a new `Hermes`. "Re-checking the live target does not switch." | When the checked target equals the live one, the owner goes to `saved` with the same `live`. It does not save, open or bump `epoch`. | The file already holds that target, and a new epoch would drop the user's draft for nothing. |
| `saveSettings(dir, target)` renames an unreadable or newer file "on the first save". | `saveSettings` reads the file itself and sets it aside when it is `unreadable` or `newer`. The temp file has one fixed name, `connection.json.tmp`. | The save needs no memory of what the load found, so it is correct after a crash too. A fixed temp name is overwritten by the next save and never piles up. |
| The chat subtree is "keyed by `live.epoch`", and its `watch` calls subscribe again. | The same, and `renderer/store.ts` keys each topic copy by epoch through an `Epoch` context. | Without it the first render of a new connection read the old connection's copies, and watched the old session id on the new gateway. |
| The owner closes the old `Hermes`, then calls `dispose()`. | The same order, with both done before `close()` returns its promise. `main/index.ts` also closes the owner on `will-quit`. | Electron does not emit `window-all-closed` when the app quits from `app.quit()`. A verify run showed a check's ssh still running after such a quit. |
| The top bar gets a Connection button. | The top bar also says which machine the chat is on. A fixture run shows neither. | The button changes that machine, so the bar names it. A `pinned` run has no connection to name or change. |
| The verify helper gains `--fake-host` and `--saved none\|local\|remote`. | It also gains `--saved unreadable\|newer`, `--hold-at` and a `value` step, and loses `--no-fixture`. A `--fake-host` run fails at teardown when the app left a fake tool running. `scripts/fake-host.ts` runs the fake machine. | `--no-fixture` now opens the setup screen with the real `ssh` and `tailscale` on `PATH`. Every run without a fixture must use the fake host. The teardown check keeps the quit defect above from coming back. |
| Nothing about a second Highwing. | `main/index.ts` takes Electron's single-instance lock, which lives in the user-data directory. A second launch exits, and the first window gets the focus. A close while a save runs ends the check, so nothing opens after it, and setup commands are refused after close. | Two instances shared `connection.json.tmp`, and saves at the same moment wrote malformed JSON (sol-loop round 1 on #43). One instance also keeps the design's one socket per gateway. |
