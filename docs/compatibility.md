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

A server saved with several ways in adds no Hermes command and no Hermes route.
Before each dial Highwing times every way: one `ssh <destination> exit` for a way
over ssh, which logs in and runs nothing of Hermes, and one `HEAD` request for a
gateway address, where any HTTP status counts as an answer. It then runs the
commands above through the way it picked, and through the next way if that dial
fails. A server with one way is not timed. See `packages/hermes/src/wire/pick.ts`.

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

## Hermes at a web address

Highwing reaches a gateway by its address through the gateway's Webapp listener
(Hermes's `gateway/webapp_listener.py`). The operator turns the listener on with
`webapp.enabled: true` in `~/.hermes/config.yaml`, gives it an address other
machines can reach, and gives it a sign-in such as `dashboard.basic_auth`.
Highwing runs no command on that machine. A default Hermes install serves none
of these routes to another machine.

| Step | What Highwing sends | When |
| --- | --- | --- |
| Status | `GET /api/status`, with no sign-in | At the start of every setup check |
| Sign-in | The browser opens `/auth/native/authorize` with an S256 PKCE challenge and a redirect to `http://127.0.0.1:<port>/callback` | In the setup check, when Highwing holds no sign-in that Hermes still takes |
| Token | `POST /auth/native/token` with the code and the verifier | After the browser reaches the callback |
| Refresh | `POST /auth/native/refresh` with the refresh token | When Hermes answers 401 to the access token, and before the first dial after launch |
| Ticket | `POST /api/auth/ws-ticket` with `Authorization: Bearer <access token>` | Before every dial |
| Socket | `<address>/api/ws` with the subprotocols `hermes-gateway-v1` and `hermes-gateway-ticket.<ticket>`, and no `Origin` | For each dial |

Hermes shows its own `/login` page in the browser, so Highwing never sees the
password. Hermes rotates the refresh token on each refresh, and Highwing keeps
the new one. See `packages/hermes/src/wire/gateways.ts`.

What Highwing does with each answer to the status:

| What the status holds | What Highwing does |
| --- | --- |
| No `version` text, no `gateway_running` flag, or a reply that is not JSON | The setup check fails with "Something answers at <host>, but it isn't Hermes." |
| No `auth_flows` list | The Hermes predates the sign-in for apps. The setup check fails with "The Hermes on <host> is too old for Highwing." |
| An `auth_flows` list without `native_pkce` | The setup check fails with "The Hermes on <host> has no sign-in that Highwing can use." |
| `auth_required: true` with `config_version` or `gateway_mode` | The address is the standalone `hermes dashboard`, whose socket Highwing can't chat through. The setup check fails and names the dashboard. |

Highwing does not read `auth_providers`. The status lists a provider there
whether or not the provider has a sign-in page.

After the sign-in, the setup check opens one socket and waits for `gateway.ready`
with `session_authority: true`. A socket that does not open fails the check as a
proxy that passes no WebSocket. A `gateway.ready` without the session authority
fails the check as the dashboard's older chat. Highwing saves an address only
after this check passes.

A dial through a saved address never opens the browser. When Hermes refuses the
refresh token, the banner says "Your sign-in to the Hermes on <host> has ended."
and offers **Sign in**, which runs the setup check again. A gateway by address is
never started from Highwing, so its banner never offers **Start Hermes**.

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
- If the `/api/status` of a gateway address holds no `auth_flows` list, the
  Hermes there predates the sign-in for apps. The setup screen shows "The Hermes
  on <host> is too old for Highwing." and saves nothing. See
  `packages/hermes/src/wire/gateways.ts`.
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
- If Hermes answers `bot_relay.deliver` with an unknown-method error, `@`
  opens no list of bots, and a message that names a bot goes to the chat's own
  bot as text. Highwing asks once per connection, with no params, which Hermes
  refuses before it admits anything. See `packages/hermes/src/relay.ts`.
- If Hermes answers `groups.capabilities` with an unknown-method error, the
  plus menu's New group chat… row says "This Hermes has no group chats. Update
  Hermes on that machine, then reconnect.", the Bots column draws no Group chats
  section, and Highwing asks nothing more until the next connection. See
  `packages/hermes/src/groups.ts`.
- If Hermes answers `complete.path` with an unknown-method error or any other
  refusal, the `@` list holds bots alone. Highwing sends only `session_id` and
  `word`, because Hermes refuses a null value, and keeps the rows that start
  `@file:` or `@folder:`. Profile rows, directive hints and plugin rows are
  left out. Hermes roots the listing in the chat's own folder and lists nothing
  for a chat on a remote or sandboxed terminal backend
  (`gateway/session_complete_path.py:15-40`).
- If Hermes answers `model.options` with an unknown-method error, Highwing
  shows no model readout under the message box and the chat works as before.
  The model is switched with `session.mutate` operation `model`, never with
  `config.set`, which Hermes refuses for the model. See
  `packages/hermes/src/actor.ts`.
- If Hermes answers `session.stats` with an unknown-method error, or any
  refusal, Highwing shows no error. The context meter then appears only once a
  turn end or a `session.usage` event carries the context figures, and a reply
  shows its token counts only from the second turn that carries usage. If
  Hermes sends no usage at all, Highwing shows no meter and no token line.
- If Hermes refuses `session.context_breakdown`, the meter's panel shows the
  refusal in one line and the meter keeps working.
- Highwing finds the versions of a message with `projects.tree`, which says
  which chat was branched from which, and `session.transcript`, which says where
  each branch parts from its parent. `projects.tree` is no canonical method. It
  reaches its legacy handler only on a socket with the interactive grant. If
  Hermes refuses either call, the chat shows no version switcher and no error,
  and opens as before. Highwing asks again each time a chat opens. See
  `packages/hermes/src/versions.ts`.
- If Hermes refuses `config.get` for `show_reasoning`, for any reason,
  `Session.tuning.reasoning` stays null, so a window shows no reasoning switch.
  `tune` then answers Hermes's refusal. Reasoning that Hermes streams anyway is
  still shown. Highwing reads again after the next attach. See "What Hermes
  says" below.
- If Hermes refuses `config.get` for `busy`, for any reason,
  `Session.tuning.busy` stays null. A message sent while a turn runs is then
  submitted and queues, as it did before Highwing read the mode. `tune` then
  answers Hermes's refusal. See "Hermes's queue" below.
- Rename with AI asks `llm.oneshot` for a title, with the chat's `session_id` so
  Hermes lends the chat's own model (`tui_gateway/methods_session.py:1249-1276`),
  then saves it with `session.mutate` operation `rename`. `llm.oneshot` is no
  canonical method, so it reaches its legacy handler only on a socket with the
  interactive grant. If Hermes answers it with an unknown-method error, the row
  says "This Hermes can't suggest a title." and nothing is renamed. See
  `packages/hermes/src/session-commands.ts`.
- If a pending row carries no `controls`, as on a Hermes older than the
  queued-row verbs, the row offers only cancel, and `queued` refuses a send-now
  or an edit before any call. If Hermes refuses `prompt.steer_queued`,
  `prompt.replace_queued`, `prompt.resolve_unknown`, `session.steer` or
  `session.redirect` as an unknown method, the command answers that refusal and
  the queue stays as Hermes lists it.

## Tokens and the context window

Highwing reads token counts and the context fill from three places. It reads
no cache, plan, rate-limit or money field from any of them.

| Source | What Highwing takes |
| --- | --- |
| `usage` on `message.complete` | The session's token totals and the context fill at the turn's end. Hermes attaches it only for a local viewer's turn (`gateway/session_settlement_recovery.py:84-88`). |
| The `session.usage` event | The context fill, after each model call of a turn. |
| The `session.stats` method | The totals and the fill, read when a chat opens and after each turn. |

- The canonical route has no `session.usage` method, although the contract
  lists one for the legacy route. `session.stats` returns the same counters
  (`gateway/session_usage.py:265-274`). Highwing builds the context fill from
  them the way Hermes's `tui_usage` does: `last_prompt_tokens` over
  `context_length`, estimated unless `context_source` is `provider_usage`.
- The token counts are running totals of the session's agent, not one reply's
  count. Highwing shows a reply the difference between the totals at its end
  and the totals before it. Hermes starts the totals again when it builds a new
  agent for the session. Highwing then takes the new totals as the reply's own
  when any of them is lower than before. It cannot tell a restart whose first
  reply uses more than the whole session did before.
- `session.context_breakdown` is served on the canonical route
  (`gateway/session_tui_ops.py:33`). Highwing ignores each category's `color`.

- The bot's approval mode, `manual`, `smart` or `off`, is read with
  `config.get {session_id, key: "approval_mode"}` when a watched chat goes
  live, beside `show_reasoning` and `busy` (`gateway/session_config.py:87-108`).
  A new bot starts on `smart` (`hermes_cli/config_defaults.py:1624`). The
  composer's approval menu sends `tune approvals <mode>`:
  `config.set {session_id, key: "approval_mode", value}`, which writes the
  profile's `approvals.mode` as `/approvals <mode>` does and sends no
  `session.info` (`gateway/session_tui_config.py:202-203,337-350`). A Hermes
  that refuses the read shows no menu, and the chat works as before.
- A chat's own YOLO comes as `info.yolo`, which on the canonical route is that
  flag alone (`gateway/session_local.py:576-578`). Highwing has no switch for
  it: the menu reads Off while it is on. Picking Manual or Smart then sends
  `tune yolo off` too, after the mode when the bot is on another one. That call
  writes only the open chat's setting: it names the chat and the key `yolo`,
  sends no `scope`, and says "off" outright. Hermes refuses any scope but
  "global", which would flip every chat of the profile, and takes a missing
  value to mean "toggle". See `SWITCHES` in
  `packages/hermes/src/session-commands.ts`.

## Attachments

A message can carry files. Highwing stages each one with Hermes before it
submits the message, in the order the chips show, and sends nothing if Hermes
refuses one.

| Method | Sent for | Params | Hermes answers |
| --- | --- | --- | --- |
| `image.attach_bytes` | A PNG, JPEG, GIF or WebP, by its bytes | `session_id`, `content_base64`, `filename` | The staged `path` and `mime`. It queues nothing (`gateway/session_images.py`). |
| `file.attach` | Any other file, a PDF included | `session_id`, `data_url`, `name` | `ref_text`, an `@file:` reference to the staged copy (`gateway/session_ancillary.py:139-180`). |
| `prompt.submit` | The message | `attachments: [{path, mime}]` for the staged images; `api_text` is the text, a blank line, and each `ref_text` on its own line | The usual receipt. |

- Both attach calls need a socket subscribed to the session. A socket that is
  not gets `permission_denied`.
- Hermes takes at most 10 images on one submit, and refuses an image over
  25 MiB or of another type with `invalid_params`. A file sent inline may be up
  to 256 MiB (`_ATTACHMENT_MAX_BYTES` in `tui_gateway/prompt_attachments.py`).
  Highwing checks the same limits when you attach a file, so the refusal names
  the file and the limit before anything reaches Hermes.
- `file.attach` is not in the vendored contract's canonical list. An older
  Hermes may answer it with an unknown-method error or refuse it. Highwing then
  shows "Hermes refused <name>: This Hermes doesn't support that." and sends
  nothing.
- `text` stays the words you typed, so the thread and Hermes's history show
  them alone. The model reads `api_text`.
- Hermes keeps no record of a message's attachments in its history. A request
  shows its attachments only in the run of Highwing that sent it.

## What Hermes says

Hermes 0.23.3 publishes these events to a local viewer's chat beside the
reply. Highwing reads each one into the chat's session. A line Hermes says while
no turn runs goes into `Session.interlude`, and never opens a turn.

| Event | Read as | Source |
| --- | --- | --- |
| `reasoning.delta`, `reasoning.available` | One reasoning item per model call, streamed or sent whole. A whole block that starts the streamed one is that block | `gateway/local_viewer_events.py:50-55`, `agent/turn_response_intake.py:139-165` |
| `moa.progress`, `moa.reference`, `moa.phase`, `moa.aggregating` | One MoA item per round, updated in place | `gateway/local_viewer_events.py:129-161` |
| `status.update` | A status line, by `kind`: `compacting`, `compacted`, `goal`, `warn`, else other. `process` is not shown yet | `gateway/run_turn_progress.py:1215-1219`, `gateway/run_goals.py:238-246` |
| `agent.print` | A status line | `gateway/local_viewer_events.py:40-42` |
| `notification.show`, `notification.clear` | A keyed notice, replaced by a later one with its key, marked cleared by `clear` | `gateway/run_turn_progress.py:1119-1133` |
| `tool.complete` `image_path` | The image a finished tool names | `gateway/local_viewer_events.py:227-228` |
| `approval.request`, `clarify.request` `timeout_s` | A prompt's deadline on this client's clock | `gateway/local_viewer_events.py:248-263` |

- Reasoning and MoA progress arrive only while Hermes shows reasoning for the
  chat. Highwing reads that switch with
  `config.get {session_id, key: "show_reasoning"}`, which answers `"1"` or `"0"`
  (`gateway/session_busy_controls.py:90-108`). It reads it when a window starts
  to watch the chat and after each attach, and sets it with
  `config.set {session_id, key: "show_reasoning", value: "on" | "off"}`. A
  change applies from the next turn. A chat launched from the CLI or a
  messaging platform shows none until it is turned on.
- A stored reply keeps its reasoning in the display row's `reasoning` key
  (`tui_gateway/session_history.py:275-281,365`). A rebuild reads it from there. MoA
  progress, status lines, notices and tool images are not stored, so a rebuild
  drops them.
- `todo.updated` carries the whole to-do list at a revision. Hermes keeps the
  newest one and answers it as the attach reply's `todo_state`
  (`tui_gateway/tool_progress.py:117-162`). A chat read from a snapshot shows
  it as the plan of the newest turn that called the todo tool, right after
  that turn's newest todo call, or of the running turn when no loaded turn
  called it. An older turn's plan lived only on the stream, so a rebuild drops
  it. Hermes's unused store, an empty list at revision 0, is no plan.
- A notice with a time to live (`kind: "ttl"`) that Highwing hears through
  replay is dropped, because its time runs on this client's clock.
- No gateway method returns a tool image's bytes. Main's one image loader,
  `apps/desktop/src/main/images.ts`, reads the file only when Hermes runs on
  this computer, and only for a path a finished tool of the watched chat named.

## What Hermes asks

Hermes 0.23.3 asks a local viewer for some things outside the turn's own
prompts. Each is a JSON-RPC request with a string id (`srq-…`), written to
every socket attached to the chat (`gateway/session_server_requests.py`). The
first client to answer settles it for all of them. Highwing holds each one it
has a card for in `Session.requests`, whether or not a turn runs.

| Request | Held as | Hermes waits | Answered with |
| --- | --- | --- | --- |
| `sudo` | A masked prompt for the sudo password, with the command | 120 s (`gateway/session_sudo_prompt.py:19`) | A result frame `{value}` |
| `secret` | A masked prompt for a named variable of the bot's `.env` | 120 s (`gateway/session_secret_prompt.py:19`) | A result frame `{value}` |
| `vault.unlock_prompt` | A masked prompt for a password manager's master password | 120 s (`gateway/session_vault_prompt.py:22`) | A result frame `{value}` |
| `vault.save_login` | A login to save for a site | 180 s (`:23`) | A result frame whose `value` is the JSON `{identifier, password}` |
| `vault.code` | A one-time code | 180 s (`:24`) | A result frame `{value}` |
| `clarify` | One to five questions asked together, or a plugin command's one choice (`gateway/session_clarify_batch.py`, `gateway/plugin_command_choice.py`) | Hermes's `clarify_timeout`, 90 s unless configured. No frame carries it | `clarify.lock {request_id, question_id, answer}` once per question. The last lock submits. A result frame `{}` ends the batch early and keeps the locks |
| `connection.request` event, `connection.update` events, the snapshot's `pending_connection` | The connector card: its targets, each with its state and sign-in link | The card's own `timeout_seconds` | `connection.respond {owner: {type: "session", session_id}, op_id, result}` |

- A result frame gets no reply. An empty `value` means skipped. The request
  reads as sending until Hermes publishes `request.cancel {id, method, reason}`,
  which closes it. The reasons are `resolved` (some client settled it),
  `timeout`, `interrupted`, `shutdown` and `session_closed`
  (`tui_gateway/contracts/server_requests.py:366-378`). Any other reason reads
  as withdrawn.
- A typed value goes to Hermes once. No session, no push to a window and no
  recording holds it: `RecordedReply` has no member for one, and
  `recordingDialer` writes `•••` in its place.
- Several picks for one question go as a JSON array of labels in one string,
  the form Hermes decodes (`tools/clarify_tool.py:36-47`).
- Hermes sends the clarify tool's questions as one request only to a client
  that asks, with `clarify_batch: true` on `prompt.submit`
  (`gateway/session_cli_turn.py:54-61`). Highwing asks when
  `client.capabilities` answered `canonical_clarify_batch: true`. Without it
  each question comes as a `clarify.request` prompt of the turn, as before.
- A request frame has no place in the event stream. Each `session.resume`
  lists the ones still open as `open_requests`, with a batch's locks so far
  (`gateway/session_server_requests.py:125-135`). After each attach Highwing
  closes a held request the list leaves out, and opens one it lists. A
  request this client answered that is still listed opens again with "Hermes
  didn't get your answer."
- Another client's lock of a batch question is published nowhere. Highwing
  learns of it at its next attach.

### Requests Highwing has no card for

`preview.read`, `preview.act`, `window.read`, `terminal.read`, `theme.apply`,
`theme.pick`, `tour` and `setup_beat` ask for parts of Hermes Desktop's
window (`gateway/local_desktop_ui.py`). Highwing has none of them, and treats
a method it does not know the same way.

- While a Highwing window shows the chat, Highwing answers such a request
  with JSON-RPC error `-32601`, so the tool stops waiting, and the thread says
  so. Hermes reads any error frame as "skipped" for every viewer
  (`gateway/session_server_requests.py:89-96`).
- While no window shows the chat, Highwing leaves the request open. The hub
  stays attached to every running chat, and a refusal from it would cancel a
  request that Hermes Desktop, attached to the same chat, could answer.
- A request Highwing has a card for is never refused. Until the window draws
  the cards, such a request waits for another client or for Hermes's own
  timeout.

Before this, Highwing refused every request, in every chat it was attached
to. That cancelled a sudo prompt someone could have answered in Hermes's own
terminal.

## Hermes's queue

Hermes keeps one queue of messages per chat, for every client. Each
`session.info` and each attach reply carries the whole of it as `pending`
(`gateway/session_authority.py:479-496`, `gateway/session_queued_controls.py:62-72`).
`Session.queue` is that list, replaced whole from each one.

| A pending row | Is in Highwing | Hermes source |
|---|---|---|
| `status: "queued"`, with `controls` | A queued row. `steer` in `controls` allows send-now, `replace` allows an edit. Cancel is always offered | `gateway/session_queued_controls.py:49-59` |
| `status: "started"` with `steering: true` | A row on its way into the running turn. It offers nothing, and it is never the turn's request | `gateway/session_authority.py:461-477`, `persistence/sqlite/authority/_admission_store.py:258-260` |
| `status: "unknown"` | A lost row: Hermes restarted while it ran. It carries the generation its release needs | `persistence/sqlite/authority/_admission_store.py:372-382,418-419` |
| `status: "started"` | The running turn's request, not a queue row | `gateway/session_authority.py:461-465` |

| A window's command | Highwing calls | Hermes source |
|---|---|---|
| `queued` cancel | `prompt.cancel {session_id, admission_id}` | `gateway/session_authority.py:831-841` |
| `queued` sendNow | `prompt.steer_queued {session_id, admission_id}` | `gateway/session_queued_controls.py:128-181` |
| `queued` edit | `prompt.replace_queued {session_id, admission_id, submission_id, text}`, with a new `submission_id` | `gateway/session_queued_controls.py:213-242` |
| `queued` release | `prompt.resolve_unknown {session_id, admission_id, execution_generation}`, with the lost row's own generation | `gateway/session_authority.py:907-914` |
| `send` while a turn runs, busy mode `steer` | `session.steer {session_id, text, execution_generation}` | `gateway/session_busy_controls.py:181-221` |
| `send` while a turn runs, busy mode `interrupt` | `session.redirect`, with the same params | the same |
| `answer` with `{kind: "deny", tell}` | `session.steer` with the prompt's generation, then `approval.respond` with `choice: "deny"` | `ui-tui/src/app/useApprovalAnswers.ts:63-84` |
| `tune` busy | `config.set {session_id, key: "busy", value}` | `gateway/session_busy_controls.py:30-72` |

- The busy mode is the chat's, shared by every client that has it open. Highwing
  reads it with `config.get {session_id, key: "busy"}` when a window starts to
  watch the chat and after each attach, with the reasoning switch. A change
  made in another client shows at the next read.
- `sendPlan` in `packages/hermes/src/domain/queue.ts` decides where a message
  goes. A message is submitted, and so queues, when no turn runs, when the mode
  is `queue` or unknown, when the turn waits on an approval, a question or a
  request, and when it is stopping. A line that runs a slash command is never
  steered. A message with attachments always queues whole: a steer or a
  redirect carries words only, so Hermes Desktop queues the whole payload
  (`apps/desktop/src/app/chat/composer/use-composer-submit.ts`) and the TUI
  queues any turn with an image.
- A queued row of this client keeps the attachments it was sent with, and its
  request takes them when its turn starts. Hermes's pending list names no
  attachments, so another client's row shows none. Hermes lists `steer` and
  `replace` only for a row whose payload is text alone
  (`gateway/session_queued_controls.py:51-60`), so a row with attachments
  offers only cancel.
- Hermes answers a steer or a redirect with a verdict
  (`tui_gateway/contracts/canonical_sessions.py:306-321`). `queued` and
  `redirected` mean the turn has the words, and Highwing files them in the
  turn. `rejected` with `delivered: false` means no agent saw them, so Highwing
  submits them as a message. A `stale_generation` refusal means the turn has
  ended, and is handled the same way. A plain `rejected` may follow delivery,
  so Highwing never sends those words again and the command says so.
- A denial with words is two calls, and the socket can drop after Hermes took
  the first. `session.steer` carries no id
  (`gateway/session_busy_controls.py:181-221`), so Hermes would read a repeat
  as new words. Highwing remembers, by prompt, the words Hermes has or may
  have, and the same denial tried again sends only `approval.respond`. A steer
  whose answer the socket lost counts as words Hermes may have.
- Words that no agent saw go out as the next message once the denial is
  confirmed. If Hermes refuses that `prompt.submit`, or the chat is no longer
  attached by then, the `answer` command answers that refusal and the words
  stay in `Session.outbox` as a failed message. The denial is not undone.
- Hermes stores steered words as a user row with `display_kind: "steer"`
  (`agent/prompt_builder.py:585-592`, `tui_gateway/session_history.py:329-332`).
  Highwing reads that row as an item of the turn it sits in, not as a new turn.
  A page of older rows that begins at one therefore begins inside a turn, and
  "Show earlier turns" reads on to the page that holds that turn's request. A
  user row with `display_kind: "skill_invocation"` is a request, and opens a
  turn (`tui_gateway/session_history.py:360-363`).
- A queued message that Hermes hands to the turn leaves the list when the turn
  settles. It comes back as a queued row when the turn never read it
  (`gateway/session_queued_controls.py:104-116,184-200`).
- An edit whose reply the socket lost is sent again on the next socket as the
  same `prompt.replace_queued`, with the row and the `submission_id` of the
  first try. Hermes answers that repeat with the admission the first one made
  (`gateway/session_queued_controls.py:212-233`). A `prompt.submit` of the
  edit would queue it beside the row it replaces whenever Hermes had not taken
  the first try.
- A lost row pauses the queue behind it. Hermes releases it itself when the
  last viewer of the chat closes (`gateway/session_authority.py:916-919`), so
  Highwing does not stay attached to a chat only because its queue holds rows.
- A frame that ends a cancelled or steered queued message carries no
  generation (`gateway/session_authority.py:878-893`). Highwing does not read
  it as the end of the running turn.

## Chat commands

Hermes 0.23.3 serves each of these on the canonical route. `Session.tuning`
holds every switch Hermes keeps for the chat, for all its clients. Effort, fast
and YOLO come with each attach reply's `info` and with each `session.info`
(`gateway/session_local.py:486-503,520-560`), so Highwing reads none of them
with `config.get`. `Session.cwd` is the chat's folder, from the same places.

| A window's command | Highwing calls | Hermes source |
|---|---|---|
| `completePath`, for an `@` word in the composer | `complete.path {session_id, word}` | `gateway/session_complete_path.py:15-40` |
| `side` btw, or a typed `/btw <question>` | `prompt.btw {session_id, text}`, answered `{task_id}` | `gateway/session_tui_side.py:197-224` |
| `side` background, or a typed `/bg <prompt>` | `prompt.background {session_id, text}`, answered `{task_id}` | `gateway/session_tui_side.py:175-193` |
| `tune` effort | `session.mutate reasoning {effort}`, `null` for the model's own level, with `expected_generation` | `persistence/authority/runtime.py:299-316`, `gateway/session_mutation_policy.py` |
| `tune` fast | `config.set {session_id, key: "fast", value: "fast" \| "normal"}` | `gateway/session_tui_config.py:274-298` |
| `tune` yolo | `config.set {session_id, key: "yolo", value: "on" \| "off"}` | `gateway/session_tui_config.py:187-193,357-377` |
| `tune` approvals | `config.set {session_id, key: "approval_mode", value: "manual" \| "smart" \| "off"}`, a write for the whole bot | `gateway/session_tui_config.py:202-203,337-350` |
| `move` | `session.mutate workspace {cwd}`, with `expected_generation` | `gateway/session_mutation_policy.py:37-55` |
| `compress`, or a typed `/compress [focus]` | `session.mutate compress {focus?}`, with `expected_generation` | `gateway/session_mutation_compress.py:32-113` |
| `export` | `session.export {session_id, format}`, `md`, `json` or `html` | `gateway/session_tui_ops.py:89-122` |
| `pin` | `session.mutate sidebar {pinned}`. Each picker row of `session.list` says `pinned` | `persistence/authority/runtime.py:270-281,344-356`, `gateway/session_picker_fields.py:42` |
| `archive` | `session.mutate archive {archived}` | `persistence/authority/runtime.py:344-355` |
| `remove` | `session.mutate delete {}`, with `expected_generation`. Refused while a turn runs, and when Hermes can't retire the chat's route | `persistence/sqlite/authority/_mutation.py:53-72`, `persistence/sqlite/authority/_runtime_guards.py:51-59`, `gateway/session_mutations.py:217-221` |

- `btw.complete {task_id, question, text}` and `background.complete {task_id, text}`
  carry the answer on the chat's stream, with no generation. Each is one entry
  of `Session.sides`, by task, from any client. A failed side agent answers
  `error: ...` as its text (`gateway/session_tui_side.py:139-151`). Hermes
  stores neither answer, so one that was running when the chat was read again
  reads `lost`.
- Hermes takes a side prompt only from a socket that has the chat attached,
  and refuses any other with `permission_denied`.
- A committed effort or folder comes back in a `session.info` before the reply
  (`gateway/session_mutations.py:376-380`). An effort set during a turn is held
  for the next turn (`gateway/session_mutations.py:129-137`). A move is
  refused while a turn runs. Highwing refuses it before it sends anything.
  Hermes refuses a folder that is not on its machine with `invalid_params` and
  no field (`gateway/session_mutation_policy.py:45-49`).
- Hermes refuses a rewind of a row a compaction archived with `invalid_params`,
  field `target_message_id` and a detail that starts `compacted:`
  (`persistence/authority/runtime.py:68-69`). It refuses a branch through such
  a row with a bare `invalid_params`, as a Hermes without `branch` refuses any
  branch (`persistence/sqlite/authority/_mutation_publish.py:60-71`). Edit
  answers that Hermes compacted that part of the chat on the detail. The
  thread cannot tell the two branch refusals apart, because `session.resume`
  leaves the handoffs out of `display_messages`
  (`gateway/session_controls.py:122-129`). So after a bare
  refusal of a message the thread holds, Highwing reads `session.transcript`
  newest first, up to three pages. It answers that Hermes compacted that part
  of the chat when a `compaction` row comes before the message's row, and that
  this Hermes can't branch otherwise.
- `config.set` of `fast` answers the tier's word and pushes `{service_tier, fast}`
  in a `session.info` (`gateway/session_busy_controls.py:111-131`). Hermes
  refuses it with `fast_unavailable` for a model with no fast tier. A later
  `session.info` from a policy change (an effort, a folder or a model) reads the
  frozen policy's tier, not the chat's `/fast` pin, so it says fast is off
  while no agent is built (`gateway/session_local.py:467-477,543`).
- A compression is refused while a turn runs. Its receipt is a `session.updated`
  with `operation: "compress"` and Hermes's report in `summary`. The command
  answers the report's headline, size line and note. A compression that
  removes nothing answers `status: "noop"` and publishes nothing.
- A `session.updated` with operation `compress` or `reset`, from any client,
  starts the rebuild that a replay gap takes, because both rewrite the stored
  rows. A `rewind` receipt cuts the chat in place instead.
- `session.export` renders the chat and writes nothing on Hermes's machine.
  Main saves it through a save dialog, so the window gets the saved file's
  path and never the text. `HIGHWING_SAVE_DIR` names a folder to save into
  with no dialog, which a verify run sets.

## Session panels

Hermes 0.23.3 serves each of these on the canonical route, though the generated
contract lists them as legacy methods. `Session.processes` and
`Session.control` are Hermes's state for the chat, shared by every client.

| A window's command, or a read | Highwing calls | Hermes source |
|---|---|---|
| read when a window starts watching the chat, after each attach, and again when the list is old | `process.list {session_id}` | `gateway/session_ancillary.py:226-237,655-671` |
| `killProcess` | `process.kill {session_id, process_id}` | `gateway/session_ancillary.py:294-305`, `tools/process_registry.py:2120-2210` |
| `stopHelper` | `subagent.interrupt {session_id, subagent_id}` | `gateway/session_ancillary.py:24-55` |
| read when a window starts watching the chat, and after each attach | `session.control.read {session_id}` | `gateway/session_ancillary.py:474-500` |
| `control` | `session.control {session_id, action, args}` | `gateway/session_control_actions.py:141-164` |
| `checkpoints`, or a typed `/rollback [list]` | `rollback.list {session_id}` | `gateway/session_tui_ops.py:212-275` |
| `checkpointDiff`, or a typed `/rollback diff <n\|hash>` | `rollback.diff {session_id, hash}` | `gateway/session_tui_ops.py:282-299` |
| `restore`, or a typed `/rollback <n\|hash> [file] [--all]` | `rollback.restore {session_id, hash, file_path? \| all?}` | `gateway/session_tui_ops.py:300-312,350-375` |
| `react` | `message.react {session_id, row_id, emoji}` | `gateway/session_reactions.py:13-55` |

- A refused read leaves its part null, as for a Hermes without the method.
  Hermes refuses `process.list` with `unsupported_projection` for a chat a
  managed worker runs.
- The list is old after `status.update {kind: "process"}`, after a turn's end,
  and after this client's kill, and a watched chat reads it again. Hermes's
  canonical route never sends that `status.update`: only `tui_gateway` does
  (`tui_gateway/session_notifications.py:613,723`). Under the canonical route a
  process that exits while a viewer is attached starts a turn of its own
  (`gateway/session_completion_notes.py`), so its end is the signal.
- `process.kill` answers `killed` or `already_exited` for a process that ended,
  `error` with Hermes's words when the process outlived the kill, and refuses
  `process_not_found` for any id the chat does not own.
- `subagent.interrupt` answers `{found, subagent_id}`. `found: false` means
  the chat's agent runs no helper with that id, and the command is refused
  with "Hermes is no longer running that helper." A helper Hermes found ends
  with its own `subagent.complete` at status `interrupted`, which every
  viewer gets. Hermes stops any helper below the chat's agent
  (`subagent_records`, gateway/session_ancillary.py:532-548). Highwing offers
  Stop only on a helper the agent itself started, and does not offer
  `subagent.steer`.
- Hermes publishes `session.control.update {control}` to every viewer on every
  change: a control button, a slash command, a fired loop, a judged turn
  (`gateway/session_control_actions.py:76-138`). Highwing replaces `control`
  with it and never reads the button's reply. A read answer asked before an
  update leaves the update in place. A button answers `dispatch`, which is
  `exec` words or a `send` message that the client submits, as
  `command.dispatch` does. The actions are the 13 of
  `gateway/session_control_actions.py:15-22`. `subgoal.add` takes `text`, and
  `subgoal.remove` an `index` from 1.
- Hermes keeps no checkpoints unless the profile's `checkpoints.enabled` is on
  (`hermes_cli/config_defaults.py:486-487`). `rollback.list` then answers
  `enabled: false`. `rollback.diff` cuts the patch at 4000 characters.
- A restore of the whole folder keeps the files the user edited since the
  checkpoint unless `all` is sent. It is refused with `session_busy` while a
  turn runs, and Highwing refuses it before it sends anything. It also takes
  back the chat's last turn through the fenced `rewind` mutation, which
  publishes `session.updated` before the reply, and answers `history_removed`.
  Highwing then reads the chat again, and does so too when the socket drops
  before the answer. A restore of one file only touches the disk.
- A typed `/rollback` reads as Hermes Desktop reads it, and also takes the TUI's
  `--force` for `--all`. Its `<n|hash>` goes to Hermes as typed: Hermes reads a
  list number or a hash the same way on every surface (`agent/checkpoints/refs.py`),
  and answers a number out of range with `Invalid checkpoint number. Use 1-N.`
  The command answers its result in words under the composer, worded as
  Hermes Desktop and the CLI word it, and a list or diff with extra words
  answers the usage line.
- `message.react` keeps one reaction per author per row. The same emoji again
  clears it, another replaces it, and `emoji: null` clears it. It answers the
  row's reactions, which Highwing shows at once. Hermes publishes no
  `message.reaction` to other clients for a user's reaction, so another
  client's reaction shows at the next read of the stored rows. Display rows
  carry the reactions in `display_metadata.reactions`
  (`tui_gateway/session_history.py:370-371`). A reaction addresses the turn's
  answer: the last assistant row with text, or the receipt's
  `final_assistant_row_id` for a turn that settled live.

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
`/compress`, `/bg`, `/btw`, `/retry`, `/undo`, `/resume` and `/stop`. A client
runs these as its own actions. Highwing runs a bare `/new` itself: it opens a
new chat in the bot of the chat it was typed in. It also runs every name in
`OWN_COMMANDS` (`packages/hermes/src/domain/slash.ts`): `/title` with a title,
`/btw`, `/bg`, `/compress`, `/rollback` (see [Session panels](#session-panels)),
and the forms of `/busy`, `/fast` and `/reasoning` that set a switch Highwing
models. Hermes's own forms of `/compress` (`here [N]`,
`--preview`) go to the gateway, which refuses them. The menu lists `/new` and
those names with the 33 the gateway runs. It lists `/busy` and `/fast` too,
though Hermes marks them `terminal` and `advanced`.

The settings run `tune` for this chat, so `Session.tuning` takes the state Hermes
answers, and show the line Hermes's TUI shows (`busy input mode: steer`,
`fast mode: fast`, `reasoning: high`):

| Typed | `tune` |
| --- | --- |
| `/busy queue\|steer\|interrupt` | busy, that mode |
| `/fast fast\|on`, `/fast normal\|off` | fast on, fast off |
| `/reasoning <level>`, one of `EFFORTS` | effort, that level |
| `/reasoning reset` | effort, the model's own level |
| `/reasoning show\|on`, `/reasoning hide\|off` | reasoning shown, hidden |

The words are case-blind, and `/reasoning` takes the TUI's `--session` too. Every
other form goes to the gateway as before: a bare or `status` read, `--global`,
the tiers `auto`, `cold` and `ultrafast`, and the display words `full` and
`clamp`. The gateway's own `/busy` and `/reasoning show|hide` also save the
choice to `config.yaml`. `tune` sets only this chat, as Hermes's TUI does.
The Hermes `/stop` stops background processes, not the current turn, so it is
not Highwing's Stop.

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
connection, again when sessions change, and each time a Highwing window
regains focus. Hermes sends no "profiles changed" event, so a pin or a hide
made in Hermes desktop reaches Highwing when the user comes back to it.

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
- A bot whose `hidden` is `true` is kept and drawn under a collapsed
  "Hidden (N)" group at the bottom of the sidebar, as the plugin's
  `hidden-bots.ts` keeps it. Hiding changes only where a bot is drawn. A search
  in the sidebar or in Ctrl+K finds it, a typed `@` offers it, and a mention
  of it is still sent to it. The chat-mode bot picker, the Ctrl+K list with
  nothing typed and a bare `@` leave it out, unless it is the bot already
  chosen in the picker.
- A bot whose `pinned` is `true` is drawn under "Pinned", below the default
  bot. The default bot ignores `pinned` and is never drawn twice. A bot that
  is both pinned and hidden is under Hidden only.
- A flag that is not the boolean `true` is off.
- `color` is ignored. It is any CSS colour, and Highwing paints each avatar in
  one of its own five tones so that it reads in every theme. The tones are
  handed out over every bot, hidden ones included, so hiding, showing or
  pinning a bot never recolours another.
- `shape`, `description` and the rest are not read.

The default bot is the first row with `is_default`, hidden or not, and launch
opens its Bot Chat. The preview is of the chat
a click on the row opens: `canonical_session.preview` when Hermes reports a
Bot Chat, else `last_session.preview`, as the plugin's `bot-row.tsx:144`
picks it.

On a socket that reaches one profile, Hermes leaves the session fields out of
every other profile's row (`gateway/session_group_controls.py:366-384`). Those
bots then show "No messages yet". If Hermes refuses `profiles.list`, the sidebar
says "Hermes wouldn't list its bots." A recording made with `HIGHWING_RECORD`
keeps the real reply in its header under `profiles`.

Keeping hidden bots changes two things for an existing user. A default bot
hidden in Hermes used to be dropped from the roster, so launch opened the newest chat,
or a second `is_default` row took its place. Launch now opens the hidden
default bot's Bot Chat, as Hermes does, since hiding is display-only. And a
user who had hidden bots sees the avatar tones shift once, because the tones
are now handed out over the hidden bots too.

### Pinning and hiding a bot

A bot's menu in the sidebar writes the same two flags Hermes desktop's own
menu writes: Pin to top and Unpin set `pinned`, and Hide from list and Show in
list set `hidden`, in `ui_meta['hermes-bots']`. Each writes a fixed value,
`true` or `false`, never a flip of what Hermes holds, so a double click lands
in the same place.

- Hermes replaces the `hermes-bots` key whole, so Highwing reads the record
  afresh with `profiles.list {include_sessions: false}` and sends it back with
  the one flag changed and without `chat`, as Hermes desktop's
  `persistBotMetaPatch` does (`apps/desktop/src/plugins/hermes-bots/data.ts`).
  It sends `ui_meta_expected_revisions` with the revision that read gave, when
  the row carries `ui_meta_revisions`.
- A reply with `ui_meta_conflicts` wrote nothing. Highwing reads the record
  again and tries again, three times in all, as Hermes desktop does, and then
  says "Hermes didn't pin Researcher. Try again."
- The flag counts as saved only when the reply has `applied.ui_meta: true`.
  An `applied` object without it, such as a failed disk write or the 64 KB
  limit, gives the same words. A reply with no `applied` at all, or a
  `profiles.configure` that is an unknown method, says "This Hermes can't
  change bots from Highwing." Error 4064, or a read that no longer lists the
  bot, says "Hermes no longer has this bot."
- Hermes has no gateway method to delete a profile
  (`tui_gateway/methods_profiles.py:271-451` registers `profiles.list`,
  `create`, `describe`, `configure`, `set_asset` and `get_asset`), and no reply
  it sends says whether it could. `hermes profile delete` runs only on the
  Hermes machine, and never deletes the default profile. So Delete… in a bot's
  menu is shown unavailable, and its title and screen-reader description say
  "This Hermes can't delete bots from Highwing. To delete Editor, run hermes
  profile delete editor on the Hermes machine." On the default bot they say
  "The default bot can't be deleted." Choosing it shows the same words in the
  column's alert line and sends nothing. `DELETES_BOTS` in `packages/hermes/src/domain/bots.ts` holds this,
  false for every Hermes so far.
- The missing call is `profiles.delete {name}`, beside `profiles.create` in
  `tui_gateway/methods_profiles.py`. It would run
  `delete_profile(name, yes=True)` (`hermes_cli/profiles.py:1700`) and, like
  the dashboard's `DELETE /api/profiles/{name}`
  (`hermes_cli/web_routers/profiles.py:906-924`), answer `ok` with
  `settlement_pending` and the retry command when the profile's directory is
  gone but its identity is not settled. Highwing does not run
  `hermes profile delete` through `cli.exec` instead: the dialog would delete
  by a name that a rename could hand to another bot while it is open, and
  `cli.exec`'s 60 second limit can stop a delete halfway.
- Once saved, Highwing shows the flag at once and reads the roster again. If
  that read fails, the flag stays shown until the next one.

Hide changes only where the bot is drawn, here as in Hermes desktop. Its chat,
its mentions and its default-bot status are unchanged, and it keeps its pin.

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
every bot's chat. `commands.catalog` is read once per connection, and again
when Hermes pushes `skills.changed`. A command still runs in the chat's own
profile.

### A bot's skills

The Connectors screen's Skills tab lists the skills of the bot the window has
open. Hermes keeps skills per profile, and Highwing reads them only while the
screen is open.

- `profiles.describe {name}` lists every installed skill with `enabled`. Its
  description is the one `commands.catalog` gives for that profile, which lists
  enabled skills only. A turned-off skill of the bot the gateway runs as takes
  the `description:` of its SKILL.md.
- A switch sends `profiles.configure {name, disabled_skills}` with the whole off
  list, since Hermes replaces it, and Highwing sends one at a time. Highwing
  reads the skill back after, because Hermes keeps an essential skill such as
  `hermes-agent` on and still answers `applied.skills: true`
  (`hermes_cli/skills_config.py:43-47`). It then says "Hermes kept
  hermes-agent on."
- Highwing reads a SKILL.md with `learning.detail {id}`, which reaches its
  legacy handler with the interactive grant and names no profile, so it reads
  the gateway's own. Hermes refuses a `profile` key on it with 4000. Highwing
  finds the bot the gateway runs as by matching `runtime.describe`'s
  `profile_id` (`gateway/session_controls.py:582`) to a `profiles.list` row's
  `path`, which need not be the default bot. On any other bot, a turned-off
  skill has no description.
- `skills.changed` makes Highwing read the list and the slash catalog again.
- On a socket with no interactive grant, the tab says "This Hermes can't list
  skills from Highwing."

A message that names another bot (`@Rae`) is handed to that bot with
`bot_relay.deliver`, sent with the bot's `profile` and no `author`, because the
message is the user's own. Hermes puts it in the bot's Bot Chat and answers
with a receipt when that turn ends, so Highwing waits up to 25 minutes for the
one reply. The relay outbox (`bot_relay.outbox.drain`, `bot_relay.reply`)
carries messages between bots on different connections only, and Highwing
lists the bots of one Hermes, so it calls neither. The handed message and its
reply live in Highwing while it is connected. They are not in the history of
the chat they were sent from.

### A bot's memory

The details panel's Memory tab shows what Hermes remembers for the open bot:
the entries of its MEMORY.md and USER.md, and how full each file is. Hermes has
no socket method that reads memory for a named bot, so Highwing reads three of
the gateway's HTTP routes, each with `?profile=<bot>`. It reads them each time
the tab opens, and it never writes memory there.

| Route | What Highwing takes from it |
| --- | --- |
| `GET /api/learning/graph?profile=<bot>` | The `memory` list. Each card's `source` names its file: `memory` is MEMORY.md and `profile` is USER.md. Its `body` is the entry's text and its `fingerprint` identifies the whole entry (`agent/learning_graph.py:143-185`) |
| `GET /api/config?profile=<bot>` | `memory.memory_char_limit` and `memory.user_char_limit`. The route merges Hermes's defaults into the bot's config.yaml, so each cap is there even when config.yaml leaves it out |
| `GET /api/learning/node?id=<node id>&profile=<bot>` | The whole entry, only for a card whose `body` is cut short. The graph cuts a long entry's body. Highwing knows a body is cut when the first 12 hex digits of the SHA-256 of its text, trimmed as Python's `str.strip()` trims it, differ from the card's `fingerprint`. The node id is the `id` of the graph's matching `kind: "memory"` node, which comes in the same order as the cards. Highwing never reads anything out of the id |

Each read sends the credential the [task board](#task-board) does. For this
computer and another machine, the line Highwing writes to `--serve` also names
the bot: `{"id":1,"purpose":"native-http","profile":"<bot>"}`. Hermes refuses
a ticket on a route whose `?profile=` names another bot, with
`403 profile_scope_mismatch` (`hermes_cli/dashboard_auth/native_http.py`), and
mints a ticket for another bot of the same gateway when the line names it
(`hermes_cli/gateway_runtime_tickets.py`).

Hermes takes `?profile=current` to mean the profile it runs as
(`hermes_cli/web_server_profiles.py`), yet `current` is a valid profile name.
Over a web address, Highwing sends no read that names `current`, so the tab of
a bot named `current` says "Highwing couldn't read this bot's memory from
Hermes." A ticket read has no such doubt, because the ticket's own profile
decides, so that bot's tab works on this computer and over SSH.

Each meter counts a file the way Hermes's memory tool does
(`tools/memory_tool_store.py:314-315`): the entries joined by Hermes's
three-character separator, a newline, `§` and a newline, counted in
characters. Highwing holds that separator, not the caps.

On an older Hermes:

- If the graph route answers 404, the tab says "This Hermes can't show memory
  yet."
- A cap of 0 shows the size as words, with no meter.
- If the config route gives no cap for a file, or does not answer, the tab
  shows that file's entries and its size with no meter, and says Highwing
  couldn't read how much the file may hold.
- If no ticket can be had, the read gets no answer, or Hermes refuses it, the
  tab says "Highwing couldn't read this bot's memory from Hermes." A Hermes
  whose `--serve` does not take `profile` gets this answer too.
- If a reply is not shaped as above, the tab says "Hermes answered with memory
  Highwing can't read."

Tested against Hermes v0.23.4 (`8fc0374447`).

### A bot's models

Settings' Models page sets two models for each bot: the default, which new
chats start on, and the backup, which Hermes tries when the default fails.
Highwing reads both only while the page is shown, and again each time the
window regains focus.

- The page reads the default and the model list with
  `model.options {explicit_only: true}` and no session, on the bot's profile.
  Hermes then reads the profile's own config. The answer's `model` and
  `provider` are the default.
- A pick of a default sends `profiles.configure {name, model, provider}`. For a
  costly model Hermes writes nothing and answers `confirm_required` with its
  `confirm_message` (`tui_gateway/methods_profiles.py:582-604`). Highwing shows
  the words under the row. Use anyway sends the same call with
  `confirm_expensive_model: true`. The default counts as saved only when the
  answer has `applied.model: true`.
- Hermes keeps the backups in the profile's `config.yaml` as
  `fallback_providers`, a list, and the older `fallback_model`. Hermes tries
  `fallback_providers` first, then `fallback_model`, and skips a repeat
  (`hermes_cli/fallback_config.py:139-156`). The page shows the first one.
- No gateway method reads or writes them, so Highwing runs `hermes` through
  `cli.exec`, on the bot's profile and with `-p <profile>` first. Without `-p`
  the command can follow the sticky `active_profile` and change another bot
  (`hermes_cli/main.py:431-460`). It runs
  `config get fallback_providers --json` and `config get fallback_model --json`
  to read. "Config key not set" means the key is absent.
- A pick of a backup reads both keys again. Highwing then writes the pick
  first, followed by the backups that came after the old first one, with
  `config set --force fallback_providers <JSON list>`. `--force` lets the list
  replace a `fallback_providers` written as one mapping, which Hermes otherwise
  refuses (`hermes_cli/config_section_guard.py:45-61`). It then runs
  `config unset fallback_model` if that key was set, as `hermes fallback` does
  (`hermes_cli/fallback_cmd.py:27-30`). No backup writes `[]` and removes every
  backup.
- `config get` masks a key that an entry holds, so writing that entry back
  would save the mask. If any backup the write would keep holds its own key,
  Highwing writes nothing and says to change the backups with
  `hermes fallback` on the Hermes machine.
- Hermes picks up a changed chain at the start of the next turn, in open chats
  too (`tui_gateway/agent_callbacks.py:380-395`).
- If `cli.exec` is an unknown method, the page still sets the default and says
  "This Hermes can't change backup models from Highwing." in place of the
  backup's list.

### Group chats

A group chat is one of Hermes's hosted rooms: 2 to 6 bots of one Hermes on one
conversation, seated when the group is made and never changed
(`gateway/hosted_room_discussion.py:30-31`, `validate_roster`). The generated
contract lists only `groups.create` as canonical, yet the canonical route serves
every `groups.*` method (`GROUP_METHODS`,
`gateway/session_group_controls.py:15-35`).

- A group belongs to the profile Highwing connected through. Every `groups.*`
  call goes out with no `profile` key: Hermes refuses a frame that names
  another profile `profile_mismatch` (`gateway/session_group_controls.py:67-80`).
  Each method takes a closed key set (`_FIELDS`, `:36-59`), and one key more is
  `invalid_params`.
- Highwing asks `groups.capabilities {}`, then `groups.list {}`, on every new
  connection and again when sessions change. One page holds every live group:
  Hermes keeps at most 256 (`MAX_ACTIVE_ROOMS`) and pages 500 by default
  (`gateway/hosted_rooms.py:46-47`).
- `groups.changed` carries no session id, so Highwing routes it apart from
  session frames. It reads each group the event's `room_ids` names. An event
  with no `room_ids`, or one naming a group Highwing has not listed, asks for
  the list first. On every new connection Highwing reads every listed group,
  because the events sent while it was away are gone.
- Reading a group is `groups.state {room_id}`, then, for the group on screen
  only, `groups.log {room_id, since_seq, limit: 500}` from the last cursor.
  The first read of a group starts 400 lines before `latest_seq`, and the
  thread says older messages aren't shown. A log read in another
  `authority.epoch`, or past where `latest_seq` now ends, starts again from
  that window. `driver_status.member_activity` says who is answering: the
  sidebar row and the thread's live end read "Sam is thinking".
- A group on screen, and a group with a member answering, are read again every
  15 s when `groups.state` says `change_events: true`, and every 2 s when it
  does not, Hermes Desktop's own two rates. With neither, Highwing does not
  poll.
- `groups.log` lines Highwing draws: `message.user`, `message.member`,
  `turn.failed` ("Juno couldn't answer: …"), and `turn.cancelled`. A
  cancellation with reason `superseded_by_newer_user_event` reads "Ada's reply
  wasn't posted, because a newer message came first."; any other reads "Ada
  was stopped." Every other kind moves the cursor and draws nothing. A member's
  line sits under the message its `discussion_event_id` names.
- `groups.send` sends `room_id`, `event_id` and `payload: {text, thread_id}`,
  with `thread_id` always `main`. Hermes drops a member's late reply only when
  a newer message reached the same thread (`plan_publication`,
  `gateway/hosted_room_discussion.py:1012-1034`), which the busy line under
  the box says: "Sam is still answering. If you send now, Sam's reply won't be
  posted." Highwing refuses text over 64 KB (`MAX_USER_TEXT_BYTES`) before it
  sends, so a send's `invalid_params` means Hermes no longer has the group.
  A send whose answer is lost to a dropped connection is not sent again on
  its own. The text stays in the box, and the same text sent to the same
  group reuses its `event_id`, so Hermes keeps one message.
- A bare `invalid_params` on `groups.state` is Hermes's word for a room it
  does not have (`gateway/session_group_controls.py:97-102`), since
  Highwing's params are a closed set. The open group then reads "This group
  chat isn't on this Hermes any more." and Highwing asks for the list again.
- Stop sends `groups.stop {room_id, cancel_id}` with a fresh `cancel_id`.
  `room_stop_pending` reads "Hermes is already stopping this group chat."
- With `driver: false`, or a send or stop refused
  `runtime_coordination_required`, the group's box says "Hermes isn't running
  group chats right now." and Send is off.
- A group chat takes text only. Highwing sends no attachments to it, and its
  replies raise no desktop notification. Groups are not in the command
  palette.
- New group chat offers only the bots `seatable_profiles` names, the roster
  `groups.create` accepts from this connection. A Hermes that sends no
  `seatable_profiles` gets every listed bot offered.
- `driver: false` means Hermes is not running its group chats now. It still
  makes one (`create` in `gateway/session_group_controls.py` falls through to
  `rooms.create_room`), so New group chat stays offered.
- `groups.create` sends `room_id`, `name` and `members`. Each member is
  `{member_id, profile, handle}` with the bot's profile as both id and profile,
  as Hermes Desktop seats a local bot (`hermes-bots/canonical-groups.ts:228`),
  and no `target` or `display_name`. The handle is the name the sidebar shows,
  lower case, accents dropped, every run of other characters one `-`, so `@ada`
  reaches the bot shown as Ada. A handle that is empty, taken, `all` or
  `everyone` falls back to the profile, then to the profile with a number.
  Hermes Desktop uses the profile as the handle, so a group made there keeps
  its own handles.
- The dialog mints `room_id`. Hermes answers a repeated id with the group it
  made when the name and members match (`idempotent: true`), and refuses it
  with a bare `invalid_params` when they differ. So a create whose answer was
  lost goes out again under the same id, and the next try after a refusal goes
  out under a new one.
- Hermes refuses a bot it would not seat, or a roster `validate_roster`
  rejects, as `invalid_params` with `field: "members"` and its own words in
  `detail`, which the dialog shows under its list. A bare `invalid_params`
  reads "Hermes didn't accept this group chat. Try again.", and
  `permission_denied` or `profile_mismatch` reads "Hermes won't let this
  connection make group chats."
- Edit… in a group's menu renames it with `groups.rename {room_id, event_id,
  name}`, a fresh `event_id` each time and the name trimmed to 1 to 200
  characters, as `_validate_room_name` takes it
  (`gateway/hosted_rooms.py:855-863`). Hermes logs a `room.renamed` line,
  which the thread does not draw, and lists the group first. Hermes never
  changes who is in a group, so the dialog shows the members and offers no
  way to change them.
- Delete… sends `groups.disband {room_id}` after a confirmation. Hermes stops
  the group's running turns, then deletes it and its log for good and retires
  its id (`_disband`, `gateway/session_group_controls.py:266-302`). A group
  already deleted answers its tombstone again, so a second delete is no error.
  A window showing the group moves to the bot it was opened over.
  `peer_unreachable` reads "A member's machine couldn't be reached. Try
  Delete again when it's back.", `room_stop_pending` reads "Hermes is still
  stopping this group chat. Try Delete again in a moment.", and
  `room_disbanding_retry` reads "Hermes couldn't finish deleting this group
  chat. Try Delete again."
- A bare `invalid_params` on a rename or a delete means the group is gone
  (`RoomNotFoundError`), since Highwing checks the name as Hermes does. It
  reads "Hermes no longer has this group chat." and the row leaves the list.
  An unknown-method error reads "This Hermes can't rename group chats." or
  "This Hermes can't delete group chats.", then "Update Hermes on that machine,
  then reconnect."
- A recording made with `HIGHWING_RECORD` keeps the group calls out of its
  story and its header, so it plays back as a Hermes without group chats.

Highwing can't create a bot. `profiles.create` is not a canonical method, so
New bot is shown as unavailable. Avatar images are not shown either, because
`profiles.get_asset` is not canonical.

### A new bot's face

New bot gives the bot a face, which Create stores with
`profiles.set_asset {name, asset: "avatar", data}` right after
`profiles.create`. Hermes takes a PNG, JPEG or WebP of 2 MB or less. If it
refuses the picture, the bot is made all the same and the sidebar shows the
reason as a warning. The picker reads three more calls:

| Method | Params | What Highwing does with the answer |
| --- | --- | --- |
| `image.generate` | `{probe: true}`, then `{prompt, aspect_ratio: "square", max_bytes: 8000000}` | Draws `image_data`, the data URL, onto a 512 px square. A missing `image_data` is refused in words. Highwing never fetches `image` itself, since Hermes has already tried its own guarded download (`tui_gateway/methods_images.py`). |
| `pet.gallery` | `{}` | Lists the pets, curated ones first. A pet whose slug isn't one plain path segment is left out. |
| `pet.thumb` | `{slug}`, plus `url` for a pet Hermes fetches | Shows the idle frame. Hermes answers `{ok: false}` alike for a pet with no picture and for a fetch that failed (`agent/pet/store.py:224-253`), so an empty answer is asked again the next time the tile shows. |

Highwing sends `pet.thumb` only a slug with no `/`, `\`, `:`, `.` or `..`.
Hermes builds the thumb's cache path from the raw slug (`agent/pet/store.py:68-70`).

A new bot left on its default look, and a bot made from a template, also gets
a pet picture. Once the bot is made, Highwing calls `image.generate {prompt,
aspect_ratio: "square", max_bytes: 8000000}` in the background, draws the
answer onto a 512 px square, and stores it with `profiles.set_asset {name,
asset: "avatar", data}`.
The bot shows its face until the pet arrives. A look the person picked is never
replaced. The same two calls run when someone presses Generate pet picture in a
bot's Edit dialog, for any bot, including the default one. On a Hermes without
`image.generate`, or with no image model, a new bot keeps its face and shows no
message, and the button shows the words Hermes or Highwing gave for the refusal.

On an older Hermes:

- Without `image.generate`, the Generate tab says "This Hermes has no image
  model. Turn one on with `hermes tools`."
- Without `pet.gallery` or `pet.thumb`, the Pet tab says "This Hermes can't list
  pets."
- The Shape and Upload tabs need no new call.

### A bot's tool servers

The Connectors tab of the Connectors screen lists, adds and removes a bot's
MCP servers, for the same bot the screen lists apps for. Each call names that
bot's profile when the screen has one. None is canonical, so each reaches its legacy handler
only on a socket with the interactive grant (`tui_gateway/methods_tools.py:1470-1612`).

| Method | Params | What Highwing does with the answer |
| --- | --- | --- |
| `mcp.servers.list` | `{}` | Lists each server with its address, or its command and arguments. An address is shown without its query or fragment. |
| `mcp.servers.status` | `{}` | Gives each listed server its state and tool count. Hermes reports a state only for the launch profile, so another bot's servers read "Starts when a chat needs it". |
| `mcp.servers.add` | `{name, config: {url, headers?}}` or `{name, config: {command, args?}}` | Adds the server. Hermes keeps header values in the profile's config and never sends them back, so Highwing never shows one again. |
| `mcp.servers.test` | `{name}` | Says whether the server answered, and names its tools. Hermes tests only a saved server, so a server that fails is removed again and nothing stays saved. |
| `mcp.servers.remove` | `{name}` | Removes the server. Hermes refuses a server a plugin provides, and its card says "MCP · Plugin" and has no Remove. |

Highwing does not sign in to a server that asks for OAuth. Its test fails with
"needs a sign-in, which Highwing can't do yet", and nothing is saved.

On an older Hermes, or a socket bound to one profile, the tab says "This
Hermes can't manage tool servers from Highwing."

### A bot's plugins and Hermes's toolsets

The Connectors screen's Plugins tab lists the bot's plugins with a switch on
each card, installs a plugin from Hermes's catalog, and its Tools tab lists
Hermes's toolsets read-only. None of these calls is canonical, so each reaches
its legacy handler only on a socket with the interactive grant.

| Method | Params | What Highwing does with the answer |
| --- | --- | --- |
| `plugins.manage` | `{action: "list"}`, with the bot's `profile` when the screen has one | Lists each plugin with its version, where Hermes found it (`bundled`, `user` or `entrypoint`), its description, and On when its `status` is `enabled`. `disabled` and `not enabled` read Off (`hermes_cli/plugins_cmd.py:933-946`). |
| `plugins.manage` | `{action: "toggle", key, enable}`, with the bot's `profile` when the screen has one | Turns the plugin on or off by its canonical `key`, since a bare name can match a plugin of another category. Highwing then lists the plugins again and refuses the change, "Hermes kept <name> on.", when the list still shows the old state. When the reply says `restart_required`, the card says the change waits for Hermes to restart. A failure is 5026 in Hermes's words (`tui_gateway/methods_tools.py:1743-1762`). |
| `plugins.manage` | `{action: "install", catalog_name, enable: true}`, with the bot's `profile` when the screen has one | Installs and turns on the catalog entry of that name. Hermes resolves the repository and the pinned commit from its own catalog and kill list, so Highwing sends no repository (`tui_gateway/methods_tools.py:1772-1786`). The answer's `plugin_name`, `restart_required` and `missing_env` say what is left to do. A failed install is error 5026 with Hermes's words, which Highwing shows as they are. Highwing lists the plugins again after every install, a failed one too: Hermes places the plugin before it turns it on, so an enable it refuses leaves the plugin installed and off (`hermes_cli/plugins_cmd_install.py:892-938`). |
| `tools.list` | `{session_id}` of the open chat, or `{}` when the chat has no session yet | Lists each toolset with its description, its tools and whether it is on. Hermes reads the toolsets of the chat it holds by that id, and the launch profile's otherwise (`tui_gateway/methods_tools.py:220-247`). |

On an older Hermes, or a socket bound to one profile, the Plugins tab says
"This Hermes can't list its plugins." and the Tools tab says "This Hermes can't
list its tools." An older Hermes that lists plugins answers a toggle as an
unknown action (4017), and the Plugins tab then says "This Hermes can't turn
plugins on or off." with every switch disabled. An install there is refused
with "This Hermes can't install plugins."

The gateway has no call that lists the catalog itself. `plugins.catalog.lookup`
reads one entry by name. So Highwing's main process reads the same public
snapshot Hermes desktop browses,
`https://nousresearch.github.io/hermes-agent/docs/api/plugins.json`, through
Electron's `net.fetch` with no credentials. It keeps the snapshot 30 minutes, as
Hermes desktop does (`apps/desktop/src/app/capabilities/catalog/catalog-data.ts`).
This read needs no connection to Hermes. A row with no name or an unknown
`tier` is dropped.

### A bot made from a template

The Connectors screen's Templates tab makes a bot in four steps, one call each.
The first is `profiles.create`, which New bot also uses. The rest run for the
new bot, in this order, and each is safe to send again.

| Method | Params | What Highwing does with the answer |
| --- | --- | --- |
| `profiles.create` | `{name, description, soul}`, with the template's summary as `description` and its persona as `soul` | Refused as it is for New bot, so a name Hermes refuses is shown at the Bot name field and nothing else is sent. A bare `-32601` reads "This Hermes can't create bots from Highwing." |
| `profiles.configure` | `{name, enabled_toolsets}` | Hermes replaces the profile's toolset list. The answer's `applied.toolsets` must be true (`tui_gateway/methods_profiles.py:724-746`). |
| `config.set` | `{key: "approval_mode", value}`, with the new bot's `profile` and no `session_id` | On the per-profile route, `@_profile_scoped` binds the frame's `profile` before the write, so it sets the bot's approval mode (`tui_gateway/methods_config_set.py:342`, `:589`). The shared gateway refuses a `profile` other than its own connection's with `profile_mismatch` (`gateway/session_config.py:16-28`). That refusal is a warning, and no other bot's setting changes. |
| `cron.manage` | `{action: "list", include_disabled: true}`, then `{action: "add", name, schedule, prompt, deliver: "bot-chat"}`, both with the new bot's `profile` | Adds the nightly job only when the list holds no job of that name. `schedule` is a cron line such as `0 2 * * *`. `deliver: "bot-chat"` puts the report in the bot's own chat. A `success: false` answer is refused in its `error` words (`tui_gateway/methods_tools.py:1311-1325`). |

Once the bot exists, a step that fails does not stop the ones after it. The bot
opens, and the Bots column shows one warning for each failed step, such as "the
nightly job wasn't added." with the reason after it. A bare `-32601` on a step
reads "This Hermes can't turn on a bot's tools from Highwing.", "This Hermes
can't set a bot's approval mode from Highwing." or "This Hermes can't schedule
jobs from Highwing." Hermes takes only lowercase letters, numbers, `-` and `_`
for a profile's name, so the dialog's Bot name starts as the template's id, such
as `nightly-repo-auditor`.

### A routine's past runs

Hermes has no socket method that lists a routine's runs. The Routines tab of a
bot's details reads one route of the gateway's HTTP API, on the same listener as
the socket (`hermes_cli/web_routers/cron.py`). It sends the credential that the
[Task board](#task-board) section describes.

| Route | When |
| --- | --- |
| `GET /api/cron/jobs/<job_id>/runs?profile=<bot>&limit=20` | Each time a routine's Past runs opens. Highwing shows the first 20 rows of the reply's `runs`, newest first, and drops a row it cannot read |

Hermes answers a job it does not know with `200` and an empty list, so "No runs
yet." can also mean the job is gone.

A row is one of two kinds, named by its `source`. Highwing reads only the fields
in the table, and passes on none of the rest (a session row also holds a chat id,
a user id, the origin, the system prompt and the model's settings).

| Row | Fields read | How it shows |
| --- | --- | --- |
| `source: "cron"`, an agent run's session | `id`, `started_at`, `ended_at`, `end_reason`, `is_active`, `title` | A `title` that starts `CANCELLED · ` is Cancelled, with the words after it as the reason. Otherwise `is_active` is Running, `end_reason: "cron_complete"` is Succeeded, and `cron_incomplete_no_output` is Failed, "It ended without a final reply." Any other `end_reason`, or none, is No result. The length is `ended_at` less `started_at`. Its `id` opens the run's chat |
| `source: "cron_output"`, a run with no session | `id`, `started_at`, `title` | The word before ` · ` in `title` sets the state: `COMPLETED` or `OK` is Succeeded, `FAILED` or `ERROR` is Failed, `CANCELLED` is Cancelled, and `MISSED` is Missed. The words after it are the reason, or "Hermes gave no reason." for a Failed row with none. A `title` with no such word is No result. Hermes stamps `started_at` and `ended_at` alike, so the row shows no length. It has no chat to open |

A run's chat opens in the bot's profile as a read-only chat: Highwing shows no
composer and no edit, regenerate, branch or reaction, because Hermes takes no
message there. When Hermes has no reason for a stopped run, it puts the run's own
title after `CANCELLED · `, and Highwing cannot tell that from a reason, so the
title shows as one.

On an older Hermes, or one without the route:

- If the route answers 404, the tab says "This Hermes can't show a routine's past
  runs to Highwing."
- If no ticket can be had, or the read gets no answer or any other status, the
  tab says "Highwing couldn't reach Hermes for this routine's runs."
- If the reply has no `runs` list, the tab says "Hermes answered with runs
  Highwing can't read."

## Task board

Hermes has no socket method that reads its kanban board. The Tasks view reads
the kanban plugin's routes over the gateway's HTTP API. That API is on the same
listener as the socket (`plugins/kanban/dashboard/plugin_api.py`).

| Route | When |
| --- | --- |
| `GET /api/plugins/kanban/board` | When the Tasks view opens, and on Refresh |
| `GET /api/plugins/kanban/tasks/<id>` | When a card is clicked. The card's chat is the `session_id` of its newest `owner_admitted` event, in the bot that its run's `profile` names |

Each read sends one credential:

| Connection | Credential |
| --- | --- |
| This computer, or another machine | A new ticket for each read. Highwing runs `hermes gateway tickets --serve --json`, writes the one line `{"id":1,"purpose":"native-http"}`, and sends the reply's ticket as `x-hermes-gateway-ticket` to the hello's `endpoint.api_origin`, with no `Origin`. For another machine, that origin goes through its own `ssh -W` relay. A ticket works once and expires after 30 s (the SSH client contract, rule 3) |
| A web address | `Authorization: Bearer <access token>`, refreshed once on a 401, as for the socket's ticket |

Hermes lists a kanban worker's chat in no `session.list`. So a card names the bot
that the chat opens in, and Highwing does not search for it.

On an older Hermes, or one without the kanban plugin:

- If the board route answers 404, the view says "This Hermes has no task board."
- If no ticket can be had (for example, `--serve` answers `unsupported_purpose`),
  or the read gets no answer, the view says "Highwing couldn't reach Hermes's
  task board."
- If the reply isn't Hermes's board, the view says "Hermes answered with a task
  board Highwing can't read."

## Command rules

Settings → Permissions lists what a bot's Hermes always allows and always
denies, and adds and removes a rule. Hermes has no socket method for either
list, and no list of commands to ask about first, so the page offers allow and
deny. Highwing reads and writes the bot's config over the gateway's HTTP API
(`hermes_cli/web_routers/config_env.py`).

| Call | When |
| --- | --- |
| `GET /api/config`, naming the bot's profile | When the page opens, when the token below has moved, when the window comes back to the front, and after each change. This is the config Hermes runs by, with its defaults and any managed settings |
| `GET /api/config?include_defaults=false`, naming the bot's profile | At the start of each change, for the file as it is, with each `${VAR}` template as written and a list the file lacks left out |
| `PUT /api/config` with `{"config": {…}, "profile": "<bot>"}` | On Add and on Remove, once, with only the list that changes |
| `config.get {key: "mtime"}` on the socket, for the bot's profile | Every 4 s while the page is open, and when the window comes back to the front. It answers a token that changes with `config.yaml` (`gateway/session_config.py:96`) |

- `command_allowlist` is the Always allowed list and `approvals.deny` the
  Denied list. Both read as Hermes reads them: each entry trimmed, blanks left
  out (`tools/approval_floors.py`). An allow entry is a command, a pattern such
  as `podman *`, or the name of a kind of command Hermes flagged when you chose
  Always allow, such as `delete in root path`. A deny entry is a
  case-insensitive pattern.
- A PUT deep-merges its `config` over the file: dicts merge and lists replace
  (`hermes_cli/config.py:1353-1368`). A change sends the list as Highwing just
  read it from the file, with the one rule added or dropped, and no other key,
  so `approvals.mode` stays as it is and a `${VAR}` template in another rule is
  not written back expanded. A list the file holds as text, which Hermes still
  honors, is not one Highwing can read, so it changes nothing rather than
  replace it. Highwing then reads the config again and
  as Hermes runs by it and checks the change is there, because `save_config` drops the keys a managed
  install holds and still answers `{"ok": true}`.
- Hermes reads the file again at each check (`_sync_permanent_from_disk` for
  the allow list, a cache keyed on the file's signature for the deny list), so
  a change applies to open chats without a restart. `save_permanent_allowlist`
  can only add an entry, which is why a removal is this write.
- A rule is one line of text. Highwing trims it, and refuses an empty rule or a
  second line before it calls Hermes. Adding a rule a list holds, and removing
  one it lacks, write nothing. A Remove takes a rule as the page lists it, of
  any length. Highwing sends one change at a time for a connection, so two never
  read the same list. A change goes to the server it began on, even if the
  window moves to another meanwhile.

Each call sends one credential:

| Connection | Credential |
| --- | --- |
| This computer, or another machine | A new ticket for each call, as for the task board. For a bot, the line written to `hermes gateway tickets --serve --json` is `{"id":1,"purpose":"native-http","profile":"<bot>"}`, which binds the ticket to that profile's home (`hermes_cli/gateway_runtime_tickets.py:77-120`). A launch-profile ticket with `?profile=<other>` is refused 403 `profile_scope_mismatch`, so each bot needs its own. The profile also goes in the query of a GET and the body of a PUT. The ticket goes with no `Origin`, so the request goes through `node:http` |
| A web address | `Authorization: Bearer <access token>`, refreshed once on a 401, and `profile` in the query of a GET and the body of a PUT. Hermes's dashboard reads `profile=current` as its own profile, so for a bot named `current` Highwing sends nothing, and the page says it can't reach Hermes |

On an older Hermes, or one that keeps the rules out of reach:

- If the route answers 404, 405 or 403, or `--serve` answers
  `unsupported_purpose` or `invalid_request` to a ticket for a profile, the page
  says "This Hermes can't show its command rules to Highwing. Update Hermes,
  then try again."
- If no ticket can be had for any other reason (no gateway, `unknown_profile`,
  `profile_not_served`), or the call gets no answer, it says "Highwing couldn't
  reach Hermes to read its command rules." A change says "Highwing couldn't
  reach Hermes, so it didn't change the rule." and the rule stays as it was.
- If the reply isn't a config, it says "Hermes answered with command rules
  Highwing can't read."
- If a save is refused, or the config read afterwards lacks the change, it says
  "Hermes didn't save that change. An administrator may manage this setting."
- If a save gets no answer, or the config can't be read after Hermes answered
  it, it says "Highwing couldn't tell whether Hermes saved that change." The
  page reads again on the next look.
- A Hermes that gives no `mtime` has the page read on open, after each change
  and when the window comes back to the front, and not on a timer.

After Always allow on an approval card, Hermes writes the flagged kind of
command to `command_allowlist` itself, and gives no word of whether that save
landed. The answered card says "See or remove it in Permissions.", and Open
Permissions opens Settings on this page, which lists what Hermes holds.
