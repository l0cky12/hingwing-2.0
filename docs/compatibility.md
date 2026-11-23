# Hermes compatibility

Highwing talks to the Hermes gateway over a WebSocket. This page records which
Hermes versions Highwing works with, and what Highwing does when a Hermes
server doesn't support something.

## Supported Hermes

| Item | Value |
| --- | --- |
| Gateway contract vendored from | Hermes 0.23.3 (`caafe5389ae5`) |
| Gateway subprotocol | `hermes-gateway-v1` |
| Attach command | `hermes gateway attach --json` |
| Probe command | `hermes gateway tickets --probe --json` |
| SSH client contract | Hermes's `website/docs/developer-guide/gateway-ssh-clients.md` |

`packages/hermes/src/wire/contract.version.json` holds the vendored contract's
version. If this table and that file disagree, the file is right.

## Hermes on another machine

Highwing reaches a Hermes on another machine through the system `ssh`, as Hermes's
SSH client contract describes. It runs two Hermes commands on that machine and
forwards one port. The Hermes machine needs `hermes` and an SSH server. This
computer needs `ssh`.

| Step | What Highwing runs | When |
| --- | --- | --- |
| Probe | `hermes gateway tickets --probe --json` | In the setup check, and before the first dial of a connection |
| Attach | `hermes gateway attach --json --timeout 20` | Before every dial |
| Attach and start | `hermes gateway attach --json --start --timeout 75` | Before the first dial after launch, and when you press Start Hermes |
| Forward | `ssh -W 127.0.0.1:<port>` to the port that attach named | For each dial |

Highwing finds `hermes` on the far machine the way Hermes's own SSH client does. It
asks the login shell first, then tries `~/.local/bin/hermes`,
`/usr/local/bin/hermes` and `~/.hermes/hermes-agent/venv/bin/hermes`.

Highwing departs from the contract in one place. The contract's rule 3 runs
`attach --start` on every reconnect. Highwing passes `--start` only on the first
dial after launch and on Start Hermes, the rule the local route already follows.
See `docs/design/remote.md`.

Highwing does not use `hermes gateway tickets --serve`. It dials with the ticket
that attach returned, which serves the profile attach ran in.

## When Hermes is too old or too new

- If `hermes gateway attach` exits with code 2 or 3, or its reply can't be read,
  Highwing shows "This version of Hermes doesn't work with Highwing." It doesn't
  retry. See `packages/hermes/src/wire/link.ts`.
- If `hermes gateway tickets --probe --json` exits with a code other than 0, or
  prints no JSON, the Hermes on that machine predates the SSH client contract.
  The setup screen shows "The Hermes on <machine> is too old for Highwing." and
  saves nothing. A dial shows the same words and doesn't retry. See
  `packages/hermes/src/wire/ssh.ts`.
- If no `hermes` is found on the far machine, Highwing shows "Hermes isn't
  installed on <machine>."
- If the probe reports a Windows service session, Highwing never passes
  `--start`, as the contract's rule 2 requires.
- If Hermes can't start a chat from the desktop app, Highwing refuses the
  command and shows "This Hermes can't start a chat from Highwing." See
  `packages/hermes/src/hub.ts`.

## When a change needs a newer Hermes route

1. Install the newer Hermes, then run `pnpm contract:drift` to see which
   methods, requests and notifications changed. Run it before step 2: it
   compares the vendored contract with the installed one.
2. Run `pnpm sync:contract`. This copies the installed contract into the repo
   and updates `contract.version.json`.
3. Update the table above with the oldest Hermes version that has the route.
4. Make sure an older server shows a "not supported" note in the app, not an
   error.
