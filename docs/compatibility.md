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
- If Hermes answers `bot_relay.deliver` with an unknown-method error, `@`
  opens no list of bots, and a message that names a bot goes to the chat's own
  bot as text. Highwing asks once per connection, with no params, which Hermes
  refuses before it admits anything. See `packages/hermes/src/relay.ts`.
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

- If Hermes doesn't send `yolo` with a chat's state, or answers `config.set`
  with an unknown-method error, Highwing shows no YOLO pill and the chat works
  as before. The pill sends `tune yolo`, which writes only the open chat's
  setting: it names the chat and the key `yolo`, sends no `scope`, and says
  "on" or "off" outright. Hermes refuses any scope but "global", which would
  flip every chat of the profile, and takes a missing value to mean "toggle".
  See `SWITCHES` in `packages/hermes/src/session-commands.ts`.

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
| `move` | `session.mutate workspace {cwd}`, with `expected_generation` | `gateway/session_mutation_policy.py:37-55` |
| `compress`, or a typed `/compress [focus]` | `session.mutate compress {focus?}`, with `expected_generation` | `gateway/session_mutation_compress.py:32-113` |
| `export` | `session.export {session_id, format}`, `md`, `json` or `html` | `gateway/session_tui_ops.py:89-122` |

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

A message that names another bot (`@Rae`) is handed to that bot with
`bot_relay.deliver`, sent with the bot's `profile` and no `author`, because the
message is the user's own. Hermes puts it in the bot's Bot Chat and answers
with a receipt when that turn ends, so Highwing waits up to 25 minutes for the
one reply. The relay outbox (`bot_relay.outbox.drain`, `bot_relay.reply`)
carries messages between bots on different connections only, and Highwing
lists the bots of one Hermes, so it calls neither. The handed message and its
reply live in Highwing while it is connected. They are not in the history of
the chat they were sent from.

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

On an older Hermes:

- Without `image.generate`, the Generate tab says "This Hermes has no image
  model. Turn one on with `hermes tools`."
- Without `pet.gallery` or `pet.thumb`, the Pet tab says "This Hermes can't list
  pets."
- The Shape and Upload tabs need no new call.
