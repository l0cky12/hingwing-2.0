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
| Ticket command | `hermes gateway tickets --serve --json` |
| SSH client contract | Hermes's `website/docs/developer-guide/gateway-ssh-clients.md` |

`packages/hermes/src/wire/contract.version.json` holds the vendored contract's
version. If this table and that file disagree, the file is right.

## Hermes on another machine

Highwing reaches a Hermes on another machine through the system `ssh`, as Hermes's
SSH client contract describes. It runs three Hermes commands on that machine and
forwards one port. The Hermes machine needs `hermes` and an SSH server. This
computer needs `ssh`.

| Step | What Highwing runs | When |
| --- | --- | --- |
| Probe | `hermes gateway tickets --probe --json` | In the setup check, and before the first dial of a connection |
| Attach | `hermes gateway attach --json --timeout 20` | Before every dial |
| Attach and start | `hermes gateway attach --json --start --timeout 75` | Before the first dial after launch, and when you press Start Hermes |
| Ticket | `hermes gateway tickets --serve --json` | After each attach, when the probe lists `interactive` |
| Forward | `ssh -W 127.0.0.1:<port>` to the port that attach named | For each dial |

Highwing runs the same probe, attach and ticket commands for the Hermes on this
computer, with no ssh and no forward. See `packages/hermes/src/wire/tickets.ts`.

Highwing finds `hermes` on the far machine the way Hermes's own SSH client does. It
asks the login shell first, then tries `~/.local/bin/hermes`,
`/usr/local/bin/hermes` and `~/.hermes/hermes-agent/venv/bin/hermes`.

Highwing departs from the contract in one place. The contract's rule 3 runs
`attach --start` on every reconnect. Highwing passes `--start` only on the first
dial after launch and on Start Hermes, the rule the local route already follows.
See `docs/design/remote.md`.

## The socket's ticket

The ticket that attach returns reaches one profile, the one attach ran in. On that
socket Hermes refuses every call that names another profile with
`profile_mismatch`. A bot is a profile, so Highwing asks for the ticket that
reaches every profile the gateway serves:

- After attach, Highwing runs `hermes gateway tickets --serve --json`, writes the
  one line `{"id":1,"purpose":"interactive"}` to it and closes its input. The
  command prints a hello line and one reply, then ends. Highwing keeps no
  `--serve` channel open between dials.
- Highwing dials the address attach named with the ticket from that reply.
- The hello names the gateway process. If it is not the one attach found, the
  gateway was replaced in between. The dial fails as a dropped link and the
  retry attaches again.

What Highwing does when it can't get that ticket:

| What happens | What Highwing does |
| --- | --- |
| The probe lists no `interactive` purpose | Dials with the ticket attach returned. Runs no `--serve`. |
| `--serve` answers `unsupported_purpose` | Dials with the ticket attach returned. |
| On this computer, the probe exits with a code other than 0 or prints no JSON | Dials with attach alone, as it did before it ran the probe. |
| On another machine, the probe gets no answer | The dial fails with the words the setup check shows. This is unchanged. |
| The first line of `--serve` is an error | The dial fails with that exit code's words, as a failed attach does. It retries when the gateway is absent or draining. |
| `--serve` answers `ticket_unavailable` or prints no reply | The dial fails as a dropped link and the retry attaches again. |

A socket dialed with the ticket attach returned reaches one profile. Highwing
then opens the newest chat of that profile at launch, as it did before it knew
bots, and highlights no bot. A click on a bot changes nothing and the sidebar
says "This Hermes can't switch bots from Highwing yet. Update Hermes on that
machine, then reconnect."

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
- If Hermes doesn't answer `profiles.list`, the sidebar says "This Hermes can't
  list its bots." and the chat works as before. Highwing asks again on the next
  connection.
- If Hermes doesn't answer `commands.catalog`, Highwing shows no slash menu
  and no error, and sends a `/` line to the agent as text. See
  `packages/hermes/src/hub.ts`.
- If Hermes answers `model.options` with an unknown-method error, Highwing
  shows no model readout under the message box and the chat works as before.
  The model is switched with `session.mutate` operation `model`, never with
  `config.set`, which Hermes refuses for the model. See
  `packages/hermes/src/actor.ts`.

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

## Bots

A bot in Highwing's sidebar is a Hermes profile. Highwing reads them with
`profiles.list`, a canonical method of the vendored contract, on every new
connection and again when sessions change. Hermes sends no "profiles changed"
event.

Highwing reads the reply in the shape `tui_gateway/methods_profiles.py:271-290`
sends. The contract types `ui_meta` as an open object. Hermes's own desktop
Bots plugin keeps a bot's metadata under one key of it, `ui_meta['hermes-bots']`,
typed as `BotMeta` in `apps/desktop/src/plugins/hermes-bots/types.ts`. Highwing
reads that key only when it is an object, and no other `ui_meta` key:

- The name shown is `title`, then `display_name`, then the profile `name`,
  whichever comes first and is not blank, as `displayName` in the plugin's
  `labels.ts` picks it. A title such as "Timothy · CEO" is the whole name.
  Hermes keeps no separate role.
- The bot's section is `sectionName`. A bot with none is under "Unassigned",
  which is always last. Hermes groups by `sectionId` against section records
  that only the desktop which made them stores, so Highwing groups by the name
  Hermes writes beside the id. Two sections with one name show as one.
- A bot whose `hidden` is `true` is left out, as the plugin's
  `hidden-bots.ts` hides it.
- `color` is ignored. It is any CSS colour, and Highwing paints each avatar in
  one of its own five tones so that it reads in every theme.
- `pinned`, `shape`, `description` and the rest are not read.

The default bot is the first row with `is_default`. The preview is of the chat
a click on the row opens: `canonical_session.preview` when Hermes reports a
Bot Chat, else `last_session.preview`, as the plugin's `bot-row.tsx:144`
picks it.

On a socket that reaches one profile, Hermes leaves the session fields out of
every other profile's row (`gateway/session_group_controls.py:366-384`). Those
bots then show "No messages yet". If Hermes refuses `profiles.list`, the sidebar
says "Hermes wouldn't list its bots." A recording made with `HIGHWING_RECORD`
keeps the real reply in its header under `profiles`.

### Opening a bot's chat

A click on a bot opens its Bot Chat, the session of that profile titled exactly
"Bot Chat". This is the chat Hermes's own desktop opens for a bot
(`apps/desktop/src/plugins/hermes-bots/canonical-chat.ts`).

- Highwing takes the session from the roster's `canonical_session`, as
  `resolved_id`, else `id`. `resolved_id` is the session the chat moved to
  after a compression.
- When the roster names none, Highwing asks
  `session.list {title: "Bot Chat", include_hidden: true}` for that profile.
- A click never creates a session. A bot with no Bot Chat gets an empty chat.
  Its first message creates one with
  `session.create {source: "gui", title: "Bot Chat", hidden: true, follow_profile_config: true}`.
  `hidden` is in no `runtime.describe`. The gateway takes it off before its
  field check (`gateway/session_controls.py:527`). A titled create answers the
  session that already has the title, if one does.
- Every call for a bot's session carries `profile`, the bot's profile name.
  Without it Hermes answers `not_found` or `permission_denied`, and
  `session.detach` answers `detached: false` with no error. `Connection.as` in
  `packages/hermes/src/wire/link.ts` adds the key to every call of that
  session.
- If Hermes answers `profile_mismatch` for a bot on a socket that reaches every
  profile, the gateway does not serve that profile. The sidebar says "Hermes
  isn't running that bot right now."

The slash menu lists the commands of the profile Highwing connected through, in
every bot's chat. `commands.catalog` is read once per connection. A command
still runs in the chat's own profile.

Highwing can't create a bot. `profiles.create` is not a canonical method, so
New bot is shown as unavailable. Avatar images are not shown either, because
`profiles.get_asset` is not canonical.
