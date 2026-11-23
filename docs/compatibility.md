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

`packages/hermes/src/wire/contract.version.json` holds the vendored contract's
version. If this table and that file disagree, the file is right.

## When Hermes is too old or too new

- If `hermes gateway attach` exits with code 2 or 3, or its reply can't be read,
  Highwing shows "This version of Hermes doesn't work with Highwing." It doesn't
  retry. See `packages/hermes/src/wire/link.ts`.
- If Hermes can't start a chat from the desktop app, Highwing refuses the
  command and shows "This Hermes can't start a chat from Highwing." See
  `packages/hermes/src/hub.ts`.
- If Hermes doesn't answer `commands.catalog`, Highwing shows no slash menu
  and no error, and sends a `/` line to the agent as text. See
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

## Slash commands and skills

This section records what the installed Hermes offers for a slash menu. It was
read from the source of Hermes 0.23.3 at `be787439` on 2026-11-22. For the four
methods below that the gateway serves, the vendored contract matches the
installed one.

### Methods the gateway serves

The canonical route answers a method only when
`AuthorityConnection.handlers` in `gateway/session_controls.py` names it. Any
other name gets `-32601 unknown_method`.

| Method | Served | Params | Notes |
| --- | --- | --- | --- |
| `commands.catalog` | Yes | `session_id`, `profile`, both optional | Needs `session:read`. |
| `complete.slash` | Yes | `text`, `session_id`, `profile` | Ranks matches on the gateway on each call and caps each kind at 30. |
| `command.dispatch` | Yes | `name` (required), `arg`, `session_id`, `profile` | Runs one command and answers a typed directive. |
| `slash.exec` | Yes | `session_id`, `command`, both required | The same runner as `command.dispatch`, given one typed line. |
| `command.resolve` | No | | Answers `-32601`. |

- Every one of these methods refuses an unknown key with `4001 invalid_params`
  (`gateway/session_discovery.py`, `gateway/session_commands.py`).
- No code under `gateway/` sends the `skills.changed` event. The canonical route
  never tells Highwing that the skill list changed, so a catalog fetched once
  per connection can go stale until the next connection.
- A chat's project skills appear only when the catalog call carries that
  chat's `session_id`. The gateway reads them from the chat's folder.

### What `commands.catalog` returns

| Field | Holds |
| --- | --- |
| `pairs` | `[name, description]` for every command and skill, in display order. A command's description includes its usage hint. |
| `skills` | One entry per skill, keyed by `/name`, with `usage` and `origin`. A `pairs` row is a skill when its name is a key here. |
| `commands` | One entry per command name and alias, with `argument_mode`, `desktop` and `desktop_subcommands`. |
| `categories` | Command rows grouped by category. Skills are not in it. |
| `canon` | Lowercase name or alias to the command's own name. |
| `warning`, `plugin_discovery_error` | Text when a source failed to load. The rest of the catalog still arrives. |

The `desktop` value says whether a desktop app should offer a command:

- `null`: offer it.
- `"hidden"`: the command runs, but stays out of the menu (`/model`).
- Any other value names why it is not offered: `terminal`, `advanced`,
  `settings` or `composer-voice`.

The catalog also lists four rows in the `TUI` category (`/density`, `/logs`,
`/mouse`, `/sessions`) that have no `commands` entry. They control a terminal
display.

### How a command runs

A command runs as its own call, not as a submitted prompt. `prompt.submit` does
not treat a leading `/` as a command, so a `/compress` line sent today reaches
the agent as plain text.

`command.dispatch` and `slash.exec` need a `session_id`. They run only the
commands that `command_verdict` in `gateway/session_commands.py` lists as `read`
or `control`, and refuse the rest with `4001 unsupported_command`. The answer's
`type` tells the client what to do next. The canonical route answers only these
three. The contract's `alias`, `plugin` and `prefill` come from other routes.

| `type` | Client does |
| --- | --- |
| `exec` | Shows `output`. A plugin command and a quick command answer this way too. |
| `send`, `skill` | Submits `message` with `prompt.submit` and its own input id, and shows `display` in the thread. The gateway never submits it. |

### Which commands Highwing can offer

Of the 66 listed commands whose `desktop` is `null`, the gateway runs 33:

`/title` `/goal` `/heartbeat` `/refine` `/review` `/loop` `/plan` `/moa`
`/subgoal` `/status` `/egress` `/context` `/whoami` `/profile`
`/codex-runtime` `/personality` `/diff` `/yolo` `/approvals` `/reasoning`
`/autoprune` `/skills` `/memory` `/bundles` `/learn` `/init` `/suggestions`
`/blueprint` `/help` `/usage` `/topup` `/version` `/debug`

The gateway refuses the other 33 offered commands, among them `/new`,
`/compress`, `/retry`, `/undo`, `/resume` and `/stop`. A client runs these as
its own actions. The Hermes `/stop` stops background processes, not the
current turn, so it is not Highwing's Stop.

`GATEWAY_RUNS` in `packages/hermes/src/wire/parse.ts` holds every command that
`command_verdict` runs, 48 in all, because the catalog has no field for it. The
menu lists the 33 of them that the catalog also offers to a desktop app. Update
`GATEWAY_RUNS` when Hermes changes `command_verdict`.

Hermes generates the full per-command table at
`website/docs/developer-guide/gateway-command-parity.md` in its install
directory. Read the install directory from `hermes --version`.
