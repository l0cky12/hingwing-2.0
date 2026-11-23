# Highwing architecture

This is the design to review before any code is written. `module-map.md` lists the modules, the owner of each piece of state, the tests and the build order. `sketch/` holds the types and signatures. It type-checks against the contract of the Hermes installed on this machine (0.23.3).

## Problem

Highwing is a viewer and controller for a gateway that owns every session. The chat view is a client-side fold of stored history plus a live event stream, drawn in design C. The gateway's rules make the shape non-obvious. The WebSocket upgrade is refused if it carries an `Origin` header, and every dial needs a fresh 30-second single-use ticket. A socket may act on a session only after it attached to it, and attachment is lost on reconnect. Canonical params are closed key sets. The reply to `prompt.submit` is a receipt, and the turn ends only on `message.complete`. Replay after a drop is bounded, so a client must be able to rebuild a session from a snapshot at any time. Stored rows carry no diffs, and a snapshot carries no partial text for a running turn. An approval reaches only an attached socket, so a chat nobody has open can be waiting for a yes. No AI provider exists on this machine, so the client has to be built and tested from event logs. Hermes Desktop shows the failure to avoid. It keeps session state in several holders that drifted apart, and "running" as several flags plus watchdogs.

## Usage (caller's view)

Three call sites define the design. They are `sketch/usage.ts`, which type-checks against the sketch.

Electron main holds all of the gateway wiring in the app.

```ts
const dial = env.HIGHWING_FIXTURE
  ? scriptedDialer(loadFixture(env.HIGHWING_FIXTURE), { timing: 'recorded' })
  : env.HIGHWING_RECORD ? recordingDialer(liveDialer(), env.HIGHWING_RECORD) : liveDialer()
const hermes = openHermes({ dial, client: { name: 'highwing', version } })
serveWindows(hermes)
hermes.sidebar.subscribe(sidebar => setTrayIcon(sidebar.rows.some(r => r.badge === 'asking') ? 'asking' : 'idle')) // later
```

A window reads one value per session and sends commands as data.

```ts
const session = useTopic(`session:${id}`)             // Session | undefined
const thread = threadView(session)                     // design C, the same call the tests make
const showStop = activityOf(session).kind !== 'idle'   // idle | thinking | writing | working | asking | ...
highwing.run({ do: 'send', sessionId: id, text })
highwing.run({ do: 'answer', sessionId: id, promptId, reply: { kind: 'choice', value: 'once' } })
highwing.run({ do: 'reconnect', start: true })         // the Start Hermes button
```

A test derives design C from an event log with no provider, no socket and no DOM.

```ts
const fixture = loadFixture('fixtures/errand.jsonl')
const pushes = fixture.steps.filter(step => 'push' in step).length
const want = outline(threadView(await playToEnd(fixture)))
expect(want).toMatchInlineSnapshot()                   // "■ Created and edited `notes.md` · 2 steps" ...
for await (const { session, step } of play(fixture))   // every moment of the turn
  expect(checkThread(threadView(session)), `step ${step}`).toEqual([])
for (let afterPush = 1; afterPush <= pushes; afterPush++)   // a socket drop after any frame
  expect(outline(threadView(await playToEnd(fixture, { drop: { afterPush, missed: 3 } })))).toBe(want)
```

No call site mentions a ticket, a socket, a seq, an epoch, a generation, a revision or an idempotency key.

## Shape

**Data first.** `Session` is plain JSON. Its content has three parts that change: `history: SettledTurn[]`, `run` and `outbox`. `Run` is `{state: 'idle'} | {state: 'running', generation, turn: OpenTurn, stop}`. An open turn has no outcome field and a settled turn requires one. `Item<'settled'>` excludes a running tool and a waiting prompt, so those exist only inside `run.turn`. Waiting for approval is not stored. It is a prompt item in the open turn, and `activityOf(session)` derives it along with thinking, writing and working (per model-the-domain, type-system-discipline).

**One writer per session, attach included.** A `SessionActor` in Electron main owns one `Tracked` value: the content that windows see, a `Gate`, and a `Fence` of revision and paging tokens. Every change is a `reduce(state, input)`. Gateway events, attach replies, a lost link and this client's own actions are all inputs. `Gate` is the attach lifecycle as one union: `detached` (with the cursor to replay from), `attaching` (with an attempt number, a plan and the frames parked so far) or `live` (with the cursor and the subscription id). It decides whether a frame is applied, parked or dropped. `Session.sync` is not stored. `syncOf(gate, link)` derives it each time the actor publishes, so the banner in a window cannot disagree with what the socket is doing. The actor itself is a thin shell that makes the gateway calls a state asks for and feeds the replies back in.

**One boundary.** `wire/parse.ts` alone turns gateway shapes into domain shapes. It parses `inline_diff` into `FileDiff` and tool results into `ToolResult`, strips ANSI and caps size (per boundary-discipline). No public entry exports a wire type.

### The five questions

**1. Where does the socket live, and how are tickets minted?** In Electron main, inside the headless package `@highwing/hermes` (`wire/link.ts`). One socket serves every session and window. `liveDialer` runs `hermes gateway attach --json` before every dial and passes the returned `protocols` to Node's built-in `WebSocket`, which sends no `Origin`. The prototype's `main.js:60` dials this gateway the same way. The ticket never leaves `wire/link.ts`. `--start` is passed on the first dial after launch and when you press Start Hermes, and never on an automatic retry. Exit codes 5 (not running) and 6 (draining) retry with backoff. Exit codes 3, 4 and 7 stop with plain words and a Retry button.

**2. `@hermes/shared` or our own client?** A small canonical-only client, plus two files vendored by `pnpm sync:contract` with the Hermes version they came from. `gateway-contract.generated.ts` types every call through `Connection.call`, so a stray `all` key on `approval.respond` is a compile error. `gateway-contract.openrpc.json` gives the fake gateway its key sets. Neither shared client owns the whole reconnect sequence. `JsonRpcGatewayClient` replays with `events.since` and leaves the resume to the app, and the Node `GatewayClient` settles the attach and does no seq replay. The rule that `since` must reach the gateway before `resume` would be split between a library and the app. Both carry the legacy dialect, and a `link:` to the installed tree changes under every `hermes update`. The generated contract leaves out two methods (`client.capabilities`, `gateway.ping`) and six event types (the approval and clarify events, `session.updated`, `session.replay_gap`), measured against 0.23.3. Those are typed by hand in `wire/` and nowhere else.

**3. Who owns a session's state, and how can running, asking and settled not disagree?** The session's `SessionActor`, through `reduce`. The states are one union plus a derivation, as above. `sketch/.typecheck/illegal-states.ts` lists thirteen states that must not compile, and `tsc` confirms that each one fails. Among them are a settled turn with a running tool, a settled turn without an outcome, an idle run carrying a turn, and a live gate with no cursor. Fencing tokens stay with the actor. `answer(promptId, reply)` reads the generation from the prompt it answers, and that generation comes from the prompt's own payload, not from the event envelope.

**4. Reconnect, replay, replay_gap, re-attach.** Each of these reaches the reducer as an input and ends in an `attaching` gate with a new attempt number. That number is the actor's only trigger to make attach calls, and a reply from an older attempt is ignored (per make-operations-idempotent). On a new socket, a session that holds a cursor attaches in this order.

1. The gate parks every live frame for the session.
2. The actor writes `session.events.since {session_id, last_seen, replay_epoch}` and `session.resume {omit_messages, defer_history}` back to back, with no await between them. The gateway handles calls in arrival order, so it records the replay cursor first and the resume joins the event stream from that point.
3. The reducer applies the replayed events.
4. It applies the parked frames whose seq is at or below the snapshot's `last_sequence`. These are the gateway's catch-up frames, published between its replay answer and the join. A turn that ended in that window settles here, with its real outcome.
5. It checks that the cursor now equals `last_sequence`. A smaller cursor means frames are missing, and the session rebuilds. The reconcile never moves the cursor, so it cannot skip a catch-up frame.
6. It reconciles with the snapshot: revision, queue, and prompts that were answered or opened elsewhere.
7. It applies the remaining parked frames, and the gate goes live.

A session with no cursor, and any session that must rebuild, sends one `session.resume {display_projection}` and replaces its content from that reply. History comes inline with the snapshot. The gateway reads the stored rows and the watermark under one lock (`gateway/session_authority.py:390-410`), so a stored turn cannot arrive a second time as events. Older, archived rows are paged later with `session.transcript` and dropped by row id when already shown. `session.replay_gap` is its own input. It carries no seq on its envelope, so it skips the seq check and forces a rebuild.

| Situation | What Highwing does | What you see |
|---|---|---|
| The socket drops | Keeps every session's content and cursor. Redials with a fresh ticket after 1 s, backing off to 30 s. Does not start the gateway. | A "Reconnecting to Hermes" banner. The thread stays. A running turn's end mark turns graphite and stops pulsing. Send, Stop and approval buttons are disabled. Your draft is kept. |
| The socket is back and replay covers the gap | Steps 1 to 7. | The banner goes and the missed steps appear. Nothing flashes. |
| Replay cannot cover it (`snapshot_required`, a new epoch, `session.replay_gap`, missing frames) | One resume with history replaces the content. | "Catching up". Old content stays until it is replaced. Rebuilt turns are plainer, with no diffs or durations. |
| A message was on its way when the socket dropped | Sends it again with its original `input_id`, the gateway's duplicate guard. | "Sending", then one turn, not two. |
| An approval is still open | The snapshot lists it, so the card stays or comes back. | The card is answerable again. |
| The approval was answered elsewhere | The snapshot no longer lists it. | "Answered from another window." No buttons. |
| A turn ended while disconnected | Replay delivers its end, or it settles as `lost`. | Done, failed or stopped as it happened. Otherwise "Ended while Highwing was disconnected", with no Done ring. |
| Hermes is not running or is restarting | Retries with backoff, without `--start`. | "Hermes isn't running" with a Start Hermes button, or "Hermes is restarting". |
| Hermes is missing, too old, or refuses the profile | No retry. | Plain words and a Retry button. |
| Hermes asks for a sudo password, a secret or a setup card | Refuses the request at once and adds a notice to the thread. | "Hermes asked for your sudo password. Highwing can't show that prompt yet, so it said no." |
| You open a chat whose turn is already running | The snapshot has the stored rows and no partial text. | The request, the stored steps and a live end. Text fills in from the next delta. |

**5. How is design C a pure derivation, and how is it tested?** `@highwing/thread` imports only domain types and exports three functions. `threadView(session)` is the one entry point. The renderer calls it on every session value, and the tests call it on every fixture step. It returns nodes (`prose`, `step`, `group`, `prompt`, `notice`) and one `end` field per turn, so a turn cannot have two live ends. Each spec rule is a private pure function there, and per-tool wording is one table. Components map the view to DOM and decide nothing.

A fixture is JSONL of wire frames, `await` steps that pause the story until the client makes a call, and `stored` steps that set the session's stored rows. Tests play fixtures through the real client and compare `outline(view)`, a text form of the thread with one glyph per kind of node. `checkThread` runs on every step of every fixture. The scripted gateway enforces the real gateway's rules, so a client protocol bug fails a fixture test (per test-behavior-not-implementation). It refuses a wrong key set, a session verb on an unattached socket, and, on a loopback socket where the real dial code runs, an `Origin` header or a reused ticket. It answers `events.since` and `resume` from the frames it has pushed, catch-up frames included. That makes "drop the socket after every frame and compare the outline" a real reconnect test. `module-map.md` lists each test.

### Requests the first build cannot show

Hermes sends sudo, secret and setup prompts as server-to-client requests, not as events. Highwing announces `client.capabilities {server_requests: true}`. Without it Hermes fails every such request itself, and you are never told. The hub has one function, `refuse`, for every such request, whether it arrives live or is listed as still open in an attach snapshot. It answers with JSON-RPC error -32601, the code Hermes's own client uses for a request it has no handler for, and adds a notice to the thread. The agent never waits on a prompt you cannot see.

### Sessions kept attached

The hub keeps a session attached while a window watches it, while its own run is open, while it has unsent messages, and while the gateway's live list reports it as running. The last rule turns a sidebar row to "asking" when a chat nobody has open needs an approval. The stored list cannot supply it, because its `running` field is always false (`gateway/session_listing.py:70`). The sidebar therefore reads both lists.

### Interface depth

`Hermes` is three feeds (`link`, `sidebar` and `slash`), `watch`, `run` and `close`. The preload `Bridge` is `watch` and `run`. Behind them sit ticket minting, the handshake, heartbeat, backoff, attach-before-act, parking, replay, gap recovery, generation and revision fencing, idempotency keys, declining requests and attach retention. A caller's one duty is to call the function `watch` returns. `Command` is a data union, so IPC adds no forwarding method per command.

The design has no timer that force-settles a quiet turn, no REST calls, no legacy dialect, no state on disk in the first build, and no sending while offline.

## Synthesis decision

Four runners sketched this design independently, and all four reached the same overall shape: Electron, one socket in a Node-side process dialed with Node's `WebSocket`, a ticket from `hermes gateway attach --json` per dial, a small canonical-only client, one reducer-owned state per session with running and asking derived, design C as a pure view function, and wire-log fixtures. They differed in how deep the public interface is and in protocol detail.

**Base: candidate 2.** A Fable cross-judge scored candidates 1 and 2 level at 28 of 30, candidate 3 at 23 and candidate 4 at 17. Candidate 2 became the base because its faults were local protocol errors, each fixable in one or two files. Candidate 1's extra weight was structural: a utility process, a port protocol and three touch points per command. Two cautions apply to the score. The judge is the same model family as candidate 2's author, and two of the runners saw the scoring rubric during the run. The orchestrator read the candidates independently and agreed with the choice of base.

Adapted from the others, each checked against the Hermes source:

| # | Change | From |
|---|---|---|
| 1 | Reconnect order: replayed events, catch-up frames, the snapshot reconcile, then the rest. The base reconciled first, which could send a finished turn into a rebuild. | candidate 1 |
| 2 | `session.replay_gap` is its own frame kind and skips the seq check. | judge finding. Candidates 1 and 3 had it. |
| 3 | A prompt stores the `execution_generation` from its own payload, not the nullable envelope stamp. | judge finding |
| 4 | `--start` only at launch and on the Start button. Exit codes 5 and 6 retry, and 3, 4 and 7 block. | candidates 1 and 4 |
| 5 | History on open and rebuild comes inline from the resume snapshot, consistent with the watermark. | candidate 3 |
| 6 | A request the build cannot show is declined at once and noted in the thread. | candidates 1 and 4 |
| 7 | A turn that ended while detached settles as `lost` on every path and is never drawn as Done. The base had `lost` and drew it as Done. | candidate 2, corrected |
| 8 | An event without a session id is dropped and counted. The first live recording checks whether any exist. | candidate 2, kept |
| 9 | The attach lifecycle is one `Gate` union inside the reducer. The base split it between `Session.sync` and three fields on the actor. | candidate 3 |
| 10 | Every session the gateway reports as running stays attached. | candidate 4 |
| 11 | Fake-gateway rules, the glyph outline (merged into the one `outline` function) and the drop-at-every-frame test. The contract drift check. | candidates 1 and 3 |
| 12 | The renderer and the tests share one view entry point, `threadView`. The base had two. | judge finding |
| 13 | Quick-ask through a Hyprland bind and Electron's `second-instance` event. | candidate 4 |
| 14 | `@highwing/hermes` stays free of Electron, so a later move into a utility process changes only the composition root. | candidate 1 |

Two changes go beyond that list. Both came from checking the grafts against the source. A frame that Highwing does not show still reaches the reducer, so the cursor moves. Without that, the check in step 5 would see a hole after every status event. And the sidebar reads the live list as well as the stored one, for the reason given under "Sessions kept attached".

Rejected:

- Candidate 1's utility process for the core now, and its three touch points per command. Nothing measured says main would stutter, and the `Command` union needs one touch point.
- Candidate 3's `server_requests: false`, which fails a prompt with no word to the user, and its pass-through command chain.
- Candidate 4's hand-written event fields that the wire does not send, its contract-hash check at the handshake (the app would stop after every `hermes update`), its gap item in place of a rebuild, and its outbox on disk.

## Tradeoffs accepted

- We accept owning a protocol client of a few hundred lines, in exchange for one owner of the attach sequence and no legacy dialect. Hermes's hold, settle and replay test cases get ported as fixtures.
- We accept a per-window copy of each watched session, in exchange for one socket and one reducer state in main. A `rev` on every push lets a window detect a missed patch.
- We accept that opening or rebuilding a session reads its whole history on the gateway's serial lane, in exchange for rows and a watermark that come from one lock. A long chat may take seconds to open (Hermes's own comment at `gateway/session_controls.py:722`), and during that read a Stop or an approval answer for another chat waits. Build unit 6 times the largest stored session on this machine.
- We accept that history turns are plainer than live ones. Stored rows carry no diff, so an old turn reads "Wrote notes.md" with no Changes section where the live turn read "Created notes.md".
- We accept no sending while offline, in exchange for never delivering a request minutes late to an agent that runs commands.
- We accept no client-side timer that force-settles a silent turn. A long tool run is silent too. A turn whose owner died stays running until a snapshot says otherwise.
- We accept dropping a session event that arrives without a session id, counted in diagnostics, in exchange for never guessing it into the wrong session.
- We accept that sudo, secret and setup prompts are refused in the first build. The agent is told no at once and the thread says why.
- We accept attaching every running session, in exchange for an "asking" badge on chats no window shows.
- We accept one extra `session.resume` after `session.create`, and a second one when replay answers `snapshot_required`, in exchange for a single attach path.
- We accept six event payloads typed by hand in `wire/parse.ts`, because Hermes's generated contract does not list them.
- We accept one `hermes` process start per dial, and Electron's size over Tauri's.
- `@highwing/hermes` imports nothing from Electron. That looks like ceremony for a one-process app. It lets the core move into a `utilityProcess` later by changing only the composition root in `apps/desktop/src/main/`.
- `activityOf` rescans the open turn's items on each call. That looks like a missing cache. A stored copy is the thing that could disagree.

## Alternatives considered

- **Socket in each renderer with `Origin` stripped (Hermes Desktop's shape).** The hook per session looks the same to a component. Each window then needs its own ticket flow and attach, two windows on one session need frame dedupe, a tray needs a hidden window, and state exists once per window.
- **Tauri with a Rust core.** It hides the socket as well as Electron main does and ships smaller. The generated contract is TypeScript, so Rust needs hand-written types. A Rust reducer under a TypeScript view splits the fixture test loop across two languages. WebKitGTK is not the engine the design was reviewed in.
- **Main forwards raw events and every window reduces them.** IPC becomes an append-only log. Each window then owns a reducer state that matches the others only if it saw the same inputs from the same start, and seeding and replay leak into every window.
- **A stored live-state value beside the items (the prototype's `live`).** Two tools running at once, or a prompt that settles while a tool runs, make the reducer keep that value in step by hand. The derived `activityOf` has nothing to keep in step.
- **Attach state as fields on the actor beside the reducer.** The interface is the same. Inside, the parked frames, the in-flight attach and `Session.sync` become three holders that have to agree, and the order in which frames meet the snapshot cannot be tested without a socket.
- **Transcript paging on open in place of inline history.** It opens long chats faster and keeps the read off the serial lane. A turn that persists between the resume and the page read then appears twice. The only dedupe key is the completion receipt's row ids, and the gateway omits that receipt for some turns (`agent/persisted_turn_receipt.py:34-42`).

## Implementation reconciliation

Units 1 to 4 found these differences between the design and Hermes 0.23.3. The code follows Hermes.

| Design said | Hermes does | Where the code handles it |
|---|---|---|
| Six event types are missing from the generated contract. | Seven are missing. `agent.step` arrives on every turn. | `wire/parse.ts`, unshown table |
| The approval arrives before its tool (question 10). | `tool.start` comes first, then `approval.request`. | `@highwing/thread` puts the approval above its tool and hides that tool until you answer. |
| The sidebar rows come from the stored list. | The stored list leaves out every session the gateway has mounted, idle or not (`gateway/session_listing.py:103-170`). | `sidebar.ts` merges the stored list and the live list. |
| Every session verb needs an attached socket. | Only `prompt.submit` and the two respond verbs check it. Interrupt and mutate only authorize (`gateway/session_authority.py:972-976`). | The scripted gateway refuses exactly those three. |
| Server requests wait for `client.capabilities`. | The canonical gateway writes them to every attached socket. Only the legacy sidecar checks the capability. | The client still sends the capability. The scripted gateway does not enforce the rule. |
| A refused ticket closes with 4403. | Node's `WebSocket` reports a refused upgrade as close 1006. | It reads as a dropped link and is retried with a fresh ticket. This is untested against the real gateway. |
| Canonical params are closed key sets. | Methods the sidecar also declares refuse unknown keys and wrong types, and leave missing keys to the handler (`tui_gateway/contracts/registry.py:154-166`). | `testing/params.ts` |
| Live text is plain markdown. | Text after a tool starts with blank lines. | `@highwing/thread` trims them. |

Still open: a failed Stop leaves the turn showing "Stopping", because the reducer has no input that undoes a requested stop. `liveDialer` has not dialed the real gateway yet, which is unit 6.

## Open questions and risks

Product calls for you:

1. "Always allow" approves the pattern Hermes flagged, not the one command. What should the button and the answered line say?
2. May Highwing start the Hermes gateway itself on launch? The sketch defaults to yes, once, and never on a retry. The alternative is to show "Hermes isn't running" and wait for your click.
3. Which folder should a new chat start in: your home folder, the last one you used, or a picker each time?
4. A message sent while a turn runs is queued by the gateway. Should the composer also offer steering, which hands your text to the running turn?
5. Should settled live turns be cached on disk, so that history keeps its diffs and durations after a restart? The first build keeps nothing on disk.
6. Is it acceptable for Highwing to stay attached to every running chat? The cost with many chats running at once is not measured. The alternative is an "asking" badge only for chats you have open.

Facts that need a live provider, or the first live recording:

7. When a chat is first opened while its turn runs, the snapshot has no partial text. Can `session.events.since` from 0 paint the earlier part? Until a provider exists to test with, the turn shows its stored rows and fills in from the next delta.
8. Does any canonical event arrive without a session id? The diagnostics counter answers this.
9. Do the gateway's catch-up frames always reach the socket before the resume reply? If they can arrive after it, step 5 sees a hole and rebuilds. That is safe, and slower than it needs to be.
10. Answered by the canonical fixture: `tool.start` arrives before `approval.request`. The view handles both orders.
11. Do stored rows carry tool arguments and results, and does any row say that a turn failed or was stopped? The sketch read the row type, not a real page.

One path is untried on this machine. The quick-ask route through a Hyprland bind and `second-instance` needs a run on the real compositor before quick-ask is built.

## Next implementation step

Port `make_fixture.py` to emit canonical event envelopes and stored rows in the fixture format, then write `wire/parse.ts` and `domain/reduce.ts` until a direct fold of the errand fixture produces the session that the settled-C screenshot shows.
