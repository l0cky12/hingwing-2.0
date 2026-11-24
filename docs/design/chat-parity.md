# Chat parity with Hermes's own clients

This design covers the backend work that lets Highwing's chat do what chat does in Hermes's terminal client and Hermes Desktop. `chat-gaps.md` lists every chat feature of those clients, what Highwing does today and what the `hermes-gateway-v1` contract offers for it. This page decides how `packages/hermes` and the IPC surface serve the 41 rows marked `backend missing` there. The frontend is decided separately.

## Problem

Highwing covers the core loop: send, stream, tools, approvals, Stop, history, the model and the slash menu. The rest of Hermes's chat is served by the same socket. Every call this design makes is in `AuthorityConnection.handlers()` of Hermes 0.23.3, so it needs no new server, no REST and no new protocol.

The rows are not 41 small additions. Each of these facts breaks one of the current model's assumptions:

- **Hermes says things while no turn runs.** A `/goal` verdict, a finished compression, a notice and a plugin command's question all arrive between turns. The reducer has nowhere to put them. Its one attempt, the `declined` notice, opens a running turn that no event ends (`reduce.ts`, the `declined` input calls `ensureRun`).
- **Hermes asks questions that no generation fences.** Sudo, secret, vault and question-batch prompts are JSON-RPC requests with a socket-level id (`gateway/session_server_requests.py`). They are answered by a result frame that gets no reply, closed by `request.cancel`, and listed again on each attach as `open_requests`. A `PromptItem` must have a generation, and a request has none.
- **The queue is Hermes's, not Highwing's.** `pending` on every `session.info` is the whole FIFO, other clients' rows included (`gateway/session_authority.py:478-496`). `admission()` drops a row that this client did not send. It would also claim a `started` row with `steering: true`, a queued message on its way into the running turn, as the turn's request.
- **Stored rows can shrink.** A rewind, compression or reset rewrites a chat's rows, from this window or any other client. Rewind needs an idle chat and bumps the generation. A rewind whose reply was lost must be sent again with the same `request_id`, payload and fences. Hermes compares a digest that covers all of them, and a fresh derive would take back one more turn (`persistence/sqlite/authority/_mutation.py:57-62`, `_runtime.py:192-200`).
- **Some calls are bound to the socket.** `image.attach_bytes`, `file.attach`, `prompt.btw` and `prompt.background` need the chat attached on this socket.
- **A chat is a bot's Bot Chat.** `ChatRef` can name nothing else, and the list feed has no query.
- **Declining is not neutral.** Today the hub answers every server request with -32601. Hermes reads any error frame as "skipped" for every viewer (`gateway/session_server_requests.py:89-96`), and the hub stays attached to every running chat. So Highwing cancels a sudo prompt that someone could be answering in Hermes's own terminal.

The constraints stay as `module-map.md` sets them: one writer per chat (`reduce`), one value per chat for a window, commands as data through one `run`, no wire type outside `wire/`, and no state on disk.

## Usage

A window reads one value per chat and sends one command per intent.

```ts
const session = useTopic(`session:${id}`)
session.interlude                      // what Hermes said while no turn ran
session.requests                       // what Hermes waits on outside the turn: sudo, secret, vault, batches, plugin choices
session.queue                          // Hermes's FIFO, every client's rows: { s: 'queued', can }, { s: 'steering' } or { s: 'lost' }
session.outbox                         // this client's messages Hermes has not listed yet, or refused
session.tuning                         // { busy, reasoning, effort, fast }, each null until Hermes says
session.panel                          // { usage, todos, subagents, processes, control, sides }

await run({ do: 'send', sessionId: id, text, attachments })        // queue, steer or redirect: the chat's busy mode decides
await run({ do: 'answer', sessionId: id, promptId, reply: { kind: 'deny', tell: 'use trash-put instead' } })
await run({ do: 'answer', sessionId: id, requestId, reply: { kind: 'secret', value } })    // the value is stored nowhere
await run({ do: 'queued', sessionId: id, admissionId, action: 'sendNow' })                 // or 'cancel', 'edit', 'release'
await run({ do: 'rewind', sessionId: id, turn: turnId, then: { kind: 'resend' } })         // retry
await run({ do: 'rewind', sessionId: id, turn: turnId, then: { kind: 'send', text } })     // edit and resend
const undone = await run({ do: 'rewind', sessionId: id, turn: turnId, then: { kind: 'hold' } })  // undo: answers the text
useTopic('chats')                                                    // { of, query, rows, more }
await run({ do: 'open', ref: { kind: 'chat', bot, sessionId } })
```

The hub side of a command about one chat is one row over a small port (`session-commands.ts`):

```ts
queued: async (port, { admissionId, action }) => {
  // by the row's state: queued + cancel -> prompt.cancel; queued + sendNow -> prompt.steer_queued;
  // queued + edit -> prompt.replace_queued; lost + release -> prompt.resolve_unknown with the row's own generation.
  // steering rows offer nothing: Hermes refuses prompt.cancel for a row in transfer.
}
```

No call site names a generation, a revision, a stored row id, an admission status, a request frame or a gateway method.

## Shape

### Data

`Session` stays one plain value. `SessionContent` gains these parts, each with one writer.

| Part | Written by | Holds |
|---|---|---|
| `interlude: Item[]` | `reduce`, from events that arrive while `run` is idle | Status lines, notices and verdicts between turns. When the next turn starts, its settled items move into `history` as one entry whose outcome is `interlude`. A turn's settle never touches it. |
| `requests: HermesRequest[]` | `reduce`, from live server requests, the snapshot's `open_requests` and `pending_connection`, `request.cancel`, and this client's answers | Sudo, secret, vault, question batches, plugin choices and the connector card. Their life is the socket request's, not the turn's. |
| `queue: QueuedMessage[]` | `reduce`, from each pending list, replaced whole | Hermes's FIFO. |
| `outbox: OutboxEntry[]` | `reduce`, from local actions. An entry leaves when a pending list or `message.start` names its input id. | `sending` and `failed` only. |
| `tuning` | `reduce`, from `session.info` and the reads below | Busy mode, the reasoning gate, effort and fast. |
| `panel` | `reduce`, from events and reads (U4) | Usage, todos, subagents, processes, goal and loop state, side answers. |

`Item` gains `reasoning`, `moa`, `steer` and `status`. A tool's `done` status gains `image`. `PromptItem` gains `deadline`. `SettledTurn` gains `anchors`, the stored rows of its request and reply, so a command can name a turn and never a row id.

`Activity` gains `answering`, derived from `requests`. The sidebar's badge table is `satisfies Record<Activity['kind'], …>`, so a missing badge fails the build.

### Invariants the types hold

- No state holds a request's answer. `RequestState` is `waiting | sending`, and the `answer` action takes a `RecordedReply`, a type with no `secret` member. The recording dialer masks result frames.
- `QueuedMessage.state` decides which actions a row offers. `lost` carries the generation that `prompt.resolve_unknown` needs.
- A rewind in flight lives in `Fence.rewind`: the request id, the target row and the two fences it was sent with. After a lost reply the actor sends exactly that again.
- `PromptItem.generation` stays required. Requests are not prompts.

### Flow

- **Events.** `wire/parse.ts` moves the shown types from `UNSHOWN` to `SHOWN`. It splits `status.update` by its `kind`, because compaction progress, goal verdicts and `kind: 'process'` are different things. An event that arrives while `run` is idle goes to `interlude`.
- **Requests.** `parseServerRequest` reads one table, `REQUESTS`, keyed by method. A method in it becomes a `request` input, upserted by id and parked in the gate during an attach. Each attach reconciles the held requests with the snapshot:
  - A held request the snapshot does not list closes as answered elsewhere.
  - A request this client answered that the snapshot still lists reopens with "Hermes didn't get your answer".
  - `Fence.closed` stops a late live copy of a closed request from reopening it.
- **Declining.** A request method with no card (the Hermes Desktop window bridges) is declined only while a Highwing window watches that chat. Otherwise it is left open for another client. A request with a card is never declined: the card waits.
- **Rewrites.** A `session.updated` with operation `rewind`, `compress` or `reset`, from any client, starts the rebuild that a replay gap already takes. The resend after this client's own rewind is a `sending` outbox entry, which the actor already submits when the gate goes live. An exact retry publishes no `session.updated` (`gateway/session_mutations.py:352`), so `rewind.done` on the receipt also starts the rebuild.
- **Reads Hermes does not push.** The busy mode, the reasoning gate and the panel's lists are read when a window watches the chat and after each attach. They enter as a `facts` input tagged with the attach they were read under, so a stale answer is dropped. A chat kept attached only for its badge reads nothing extra. `status.update {kind: 'process'}` says when to read the process list again, so nothing polls.
- **Commands.** `run` routes app-level commands in the hub, and the rest to one row of `session-commands.ts` over a `SessionPort` (`call`, `mutate`, `respond`, `act`, `anchor`, `whenLive`). The actor keeps only what follows from state: attach, resubmit, resume a rewind, read facts. Today's actor methods that only forward become rows.
- **Pushes.** `SessionPatch.rest` carries only the fields whose reference changed. The reducer already keeps identity, so a text delta pushes an empty `rest` however large `panel` is.
- **Attachments.** `ATTACH_LIMITS` and `attachmentProblem` live in `domain/`, so the composer, the IPC validator and the hub share one check. Images are staged with `image.attach_bytes` and submitted as `{path, mime}`. Files are staged with `file.attach`, and their `@file:` reference is added to the text. A resend after a reconnect sends the staged paths and uploads nothing again.
- **Chats.** The chat list is state of the connection, as the open chat is. It lists the chats of the shown chat's bot for the query that `browse` set, and only the latest query's answer is published. `ChatRef` gains `chat` (any session of a bot) and `new` (unstarted, with a folder). `start` takes the ref. `create`, `rename` and `archive` are replaced by `start` and `mark`, with their callers.
- **Slash commands Highwing runs itself** are one table, `OWN_COMMANDS` in `domain/slash.ts`, from a typed line to a `Command`. `/retry` and the Retry button make the same call. `parseCatalog` reads its keys, so the menu offers them.

## Unit plan

Each unit is one PR, stacked on the one before it. Each ends with:

- Reducer and parse tests over hand-built inputs.
- A new fixture generated by `fixtures/make_fixture.py` from Hermes's own gateway, replayed through `play` and `playToEnd`, including the drop-after-every-push check.
- A replay of that fixture in the built app with the verify skill, checking the gateway calls with `called` and that the existing recipes still pass.

`@highwing/thread` gets only what keeps it compiling and `checkThread` sound. New item kinds draw nothing until the frontend units.

| PR | Unit | Rows | Proves it |
|---|---|---|---|
| B0 | Groundwork, no behaviour change | none | `SessionPatch.rest` as changed fields, and the `SessionPort` and `session-commands.ts` with today's commands moved onto it. Every existing test passes unchanged, and `applyPush(a, sessionPatch(a, b))` equals `b` for each pair of consecutive sessions of every fixture. Each later unit adds the scripted gateway handlers its own calls need. |
| B1 | What Hermes says | #8, #9, #11, #12, #13, #16 | `says.jsonl`: reasoning, MoA, a tool image, status lines, a notice, an approval with `timeout_s`, and a goal verdict while idle. The `declined` phantom turn is gone. |
| B2 | What Hermes asks | #20, #21, #22 | `asks.jsonl`: sudo answered (the recorded result is masked), a secret skipped, a vault prompt closed by `request.cancel`, a two-question batch, a plugin choice while idle, a connector card, and a Desktop bridge declined only while watched. |
| B3 | Queue, steer and rewind | #3, #4, #6, #17, #23, #24, #25, #26 | `queue.jsonl` and `rewind.jsonl`: another client's queued row, cancel, send now, edit, a lost row released, steer, redirect, a rejected steer resubmitted, deny-and-tell, retry, undo, edit-and-resend, a drop before the rewind reply, and a compression from another window. |
| B4 | Attachments | #28, #29, #30 | `attach.jsonl`: an image and a file staged and submitted, a drop between staging and submit, and `complete.path`. |
| B5 | Chats | #27, #38, #45, #53, #54, #55, #56, #57 | `chats.jsonl`: list, search, open another chat, a new chat's first message, branch, pin, folder, compress, export and delete. |
| B6 | Session panels | #32, #33, #35, #36, #39, #40, #41, #42, #43, #44, #46 | `panels.jsonl`: `/btw`, `/bg`, todos, a subagent, usage, a goal card, processes, checkpoints, a reaction, effort and fast. |

## Frontend limits

Each limit comes from a backend choice or a gateway fact, and bounds what a window can do.

**Whole design**

1. One value per chat. A component selects from `Session` and cannot subscribe to the panel alone.
2. One open chat and one chat list per connection. Two windows show the same chat and the same list.
3. Nothing is sent while offline. Every new command answers `offline`.
4. `tuning` is Hermes's state for the chat. Setting a switch changes it for every client that has the chat open. Each switch is null, and its control should be absent, on a Hermes that does not answer the read.
5. Paths Hermes names (a folder, a tool image) are on the machine Hermes runs on. With a remote Hermes a native folder picker is of no use.

**B1, what Hermes says**

6. The interlude, MoA progress, notices, tool images, status lines and live reasoning detail are live only. A rebuild or a restart drops them.
7. A notice's time to live runs on this client's clock. A notice heard through replay after its time is dropped.
8. Reasoning arrives only when Hermes shows it for the chat. A chat launched from the CLI or a messaging platform streams none until `tune reasoning` turns it on, from the next turn.
9. A tool image can be read only when Hermes runs on this computer. Otherwise the window has the file's name and `reason: 'remote'`.
10. A countdown needs `deadline`, which is null for a prompt first heard through a snapshot or a replay. Secret and batch cards have no countdown, though Hermes withdraws them after its own wait.

**B2, what Hermes asks**

11. Requests are not placed in the turn. Draw waiting ones at the live end. A closed one leaves a notice in the interlude or the open turn.
12. A secret is sent once and kept nowhere. The card cannot show what was typed. Its answer has no receipt, so the card reads `sending` until Hermes's `request.cancel` closes it. Any client attached to the chat can answer first.
13. A batch is answered one question at a time, each answer visible to every client, and the last answer submits it. A "review, then submit" step has to hold the last answer in the window.
14. A plugin command's question appears while that command's `send` is still pending. The composer must let a card be answered while a send is in flight.

**B3, queue, steer and rewind**

15. A queued row can be edited or sent now only when its `can` says so. Editing moves it to the back. There is no reorder. A row handed to the turn may come back to the queue.
16. A lost row keeps the queue paused until someone releases it. Hermes never runs it again, so "send again" is a new `send`.
17. Busy mode is read when the chat is watched. A change made in another client shows at the next read. While it is unknown, a send queues.
18. Deny-and-tell is one call. If the running turn could not take the words, they go as the next message instead, and the window learns which from the outcome.
19. `rewind` is refused while a turn runs and for a request that a compression summarised. It never undoes file changes. Afterwards the chat is read again: the pane shows `rebuilding`, pages loaded with "Show earlier turns" are dropped, and the remaining turns lose live-only detail such as diffs and durations.
20. Only a turn with a known request row can be rewound or branched. A live turn whose receipt Hermes omitted cannot until the chat is read again.
21. A change from another client shows as the same rebuild, with no hint of what changed.
22. A steered message's place in a live turn is where Highwing learned of it. The stored position replaces it after a rebuild.

**B4, attachments**

23. Images: up to 25 MiB each, ten per message, png, jpeg, gif or webp. Files: one frame each, with no progress and no cancel.
24. Hermes returns no image bytes for history. A sent image shows as Hermes's text marker once the turn is read from stored rows.
25. `@` completion needs a started chat, is rooted at the chat's folder, and is empty for a remote or sandboxed terminal.

**B5, chats**

26. The list shows the chats of one bot, the bot of the open chat.
27. The list is fresh on connect, after this client's own changes, and when an attached chat starts or stops. Hermes sends no event when another client makes, renames or deletes a chat.
28. A new chat exists from its first message. Its folder is chosen before that, and afterwards a change of folder is refused while a turn runs.
29. `branch` cuts at the end of a turn and opens the branch at once. `delete` is for good and is refused while a turn runs. `compress` ends in a rebuild.
30. `export` is saved by main through a save dialog. The window gets a path, not the text.

**B6, session panels**

31. Side answers arrive whole, are not stored by Hermes, and cannot be cancelled. One running across a rebuild reads `lost`.
32. Effort set during a turn applies from the next. Fast is refused for a model without it.
33. Todos are the latest list only. A subagent's output and a process's output are snapshots read on demand.
34. A checkpoint's diff is patch text, not a parsed diff.
35. A reaction made in another client does not appear live. Hermes publishes none.

## Synthesis decision

Two runners sketched this design independently: candidate 1 on Opus and candidate 2 on Fable. Both type-checked against the vendored contract. They agreed on the core: no new protocol, a rebuild after every rewrite, `parse.ts` as the only boundary, and commands that name turns, not rows.

**Base: candidate 2.** A Fable cross-judge scored it 22 of 30 against 20, and an independent read agreed. Its rewind repeats the exact mutate after a lost reply, which is the only retry Hermes's digest accepts. Its command rows remove the actor's forwarding methods. Its decline policy stops cancelling other clients' prompts. The judge is the same model family as candidate 2's author.

Grafted from candidate 1:

| Graft | Why |
|---|---|
| Server requests in their own `requests` list, not as `Ask` kinds | A request's life is the socket request's. As a prompt kind it could be closed by a turn's settle while Hermes still holds it, and it needed the generation moved out of `PromptItem`. |
| `queue` separate from `outbox` | One writer each. A merged list allowed another client's row to be `failed`. |
| Request reconciliation on attach | A `sending` answer still listed reopens. `Fence.closed` stops a late copy. Requests are parked during an attach. |
| `ATTACH_LIMITS` and `attachmentProblem` in `domain/` | One check for the composer, the validator and the hub. |
| `LEGACY_KEYS` in the scripted gateway | Key checks for served methods that the canonical list leaves out. |

Fixed from the judge's findings:

- A `steering` row offers no cancel. Hermes refuses `prompt.cancel` for a row in transfer (`persistence/sqlite/authority/_admission_store.py:258-260`).
- Usage reads call `session.stats`. `session.usage` is not served on this route.
- Vault countdowns use each method's own wait. `vault.save_login` and `vault.code` wait 180 s, not 120 s (`gateway/session_vault_prompt.py:23-24`).
- Candidate 2 planned to split `reduce.ts` into three files in its groundwork. That split is dropped. New rules go in new files (`domain/queue.ts`, `domain/requests.ts`), and the existing file is not moved.
- Candidate 2's U1 is split into B0 to B3, as both it and the judge suggested.

Rejected:

- A second topic per chat for the panel, with its own reducer. The panel and the thread could show different moments.
- A thin pass-through `call` command, which is Hermes Desktop's shape.
- Cutting history locally after a rewind. Some live turns lack row receipts, and another client's change needs the rebuild anyway.
- A generic `{do: 'mutate', operation}` command, which puts wire names on the public surface.

## Open questions

1. Should Highwing set the busy mode at all, given every other client of the chat shares it? The plan reads it and offers `tune busy`, as Hermes Desktop does.
2. Retrying a skill-invocation turn resends the typed `/skill args`. Does `prompt.submit` expand it, or must the resend go through `command.dispatch`? B3's fixture settles it.
3. Do display rows carry reactions in `display_metadata.reactions` and image attachments? B6 and B4 settle these from Hermes's own generator.
