# Module map

## Stack

| Choice | Why here |
|---|---|
| Electron, TypeScript `strict` everywhere | The design was tuned and reviewed in Chromium. Electron main is Node, so the socket needs no Origin trick. The prototype's `main.js:60` already dials this gateway with main's built-in `WebSocket`. Tray, extra windows and a single-instance lock exist in Electron today. |
| pnpm workspace, two packages and one app | A package's `exports` map makes its internals unimportable, so an import that crosses a boundary fails the build. |
| electron-vite (Vite for main, preload, renderer) | One config, hot reload for the renderer, and it bundles the workspace packages from source. |
| React in the renderer, no state library | Windows hold a read-only copy fed by `useSyncExternalStore`. There is nothing for a store library to own. |
| Plain CSS with custom properties | The tokens and the 175-line prototype stylesheet are the spec. Fonts ship as local files. |
| vitest | Runs the fixture tests in Node with no window. |

## Directories

```
highwing-2.0/
  packages/
    hermes/                      @highwing/hermes        Node. No Electron, no DOM.
      src/
        hub.ts                   public entry "."         openHermes, Hermes, Command, Feed, liveDialer, remoteRoute, Route, checkTarget
        actor.ts                 private                  one session: owns its Tracked state, makes the calls a state asks for (attach, resubmit, the facts a watched chat needs), lends commands a SessionPort
        session-commands.ts      private                  one row per command about one chat, over that chat's SessionPort. `versions` stays in hub.ts: it must not attach the chat
        sidebar.ts               private                  stored rows, the running set, deriveSidebar
        roster.ts                private                  botList: what Highwing knows about the bots and their Bot Chats, and when it asks Hermes
        open.ts                  private                  chatDesk: which chat is open, the lookups and the create a change asks for
        domain/                  public entry "./domain"  browser-safe, imports nothing
          session.ts                                      Session, Run, Turn, Item, Link, Sidebar
          reduce.ts                                       SessionEvent, Gate, SessionInput, reduce, syncOf, activityOf
          command.ts                                      Command, ResultOf, Outcome, Refusal: data the renderer sends and gets back
          slash.ts                                        SlashEntry, SlashCatalog, slashLineOf: the slash menu's rows
          bots.ts                                         Bots, Roster, Bot, BotFacts, rosterOf: the sidebar's bots, grouped and painted
          open.ts                                         OpenChat, Shown, ChatRef, nextDesk, launchChat: the open chat and every move it can make
          reach.ts                                        Target, SshHost, CheckStep, CheckFailure, CHECK_FAILURES: where Hermes runs and what can stop Highwing reaching it
          index.ts                                        exports the session, command, slash, bots, open and reach types, activityOf, rosterOf and the reach tables
        wire/                    private                  the only code that knows gateway shapes
          contract.generated.ts                           copied from Hermes by `pnpm sync:contract`
          contract.openrpc.json                           copied with it; read only by testing/ for key sets
          link.ts                                         dial, handshake, heartbeat, JSON-RPC, backoff, and `as(bot)`, which adds a bot's profile to a call
          tickets.ts                                      mintWith: probe, attach and the ticket that reaches every profile, for both routes; liveDialer
          ssh.ts                                          Hermes's SSH client contract: the locator, one hermes command over ssh, its replies, the stderr table, the relay
          remote.ts                                       remoteRoute: a Dialer to the gateway on another machine, and its processes
          check.ts                                        checkTarget: Tailscale, ssh and Hermes, one step at a time
          parse.ts                                        gateway shapes -> domain shapes
        testing/                 public entry "./testing" Node
          fixture.ts                                      fixture format, scriptedDialer, recordingDialer, play
          fake-host.ts                                    fake ssh, tailscale and hermes executables, and SCENARIOS (imported by path, not exported)
    thread/                      @highwing/thread         pure, browser-safe
      src/thread-view.ts                                  design C: threadView, outline, checkThread
      src/prose.ts                                        parseMarkdown and proseLeaves: the reply's block tree, drawn and searched
      src/find.ts                                         findInThread: matches across a view's text
      src/when.ts                                         the words and thresholds for turn times (internal)
  apps/desktop/
    src/ipc-contract.ts          shared by all three      AppTopics, Topic, Push, Bridge, applyPush, Setup, SetupCommand
    src/main/                    Electron main            index.ts (compose the owner), windows.ts, ipc.ts (serveWindows), files.ts (openablePath)
      settings.ts                no Electron              parseSettings, loadSettings, saveSettings: connection.json
      drafts.ts                  no Electron              readDraft, draftStore: drafts/, one file per chat's unsent draft
      attachments.ts             no Electron              attachmentStore: attachments/, the files staged for messages; desktopSources: the file dialog and clipboard, or HIGHWING_PICK_FILES
      connection.ts              no Electron              ownConnection, nextSetup, pinnedConnection: the setup state, the saved target, the live Hermes
    src/preload/index.ts         preload                  exposes Bridge: watch, run, file, image, drafts, keepDraft, attachPick, attachPaste and attachDropped
    src/renderer/                renderer                 store.ts (useTopic), setup/, bots/, chats/, chat/ (Attachments.tsx: chips and sent files; drawn.ts: what the window draws of the view), composer/ (drafts.ts: useDraft, useAttachments), chrome/, styles/
  fixtures/                                               *.jsonl, make_fixture.py (run with Hermes's interpreter), profiles/*.json (canned `profiles.list` replies), attach/ (files the attachment recipes stage, from make_attach_files.py)
  scripts/                                                sync-contract.ts, contract-drift.ts
```

`sketch/` mirrors these paths. `sketch/usage.ts` holds the call sites. `sketch/.typecheck/illegal-states.ts` lists the states the types must reject. Both pass `tsc --strict` against the contract of the installed Hermes 0.23.3.

## Who owns which state

| State | Single owner | Everyone else |
|---|---|---|
| The socket, pending calls, heartbeat, backoff, `Link` | `connect()` in `wire/link.ts`, in Electron main | read `Link` through `Hermes.link` |
| One session's content (`history`, `run`, `outbox`) | that session's `SessionActor`, changed only through `reduce` | read through `Hermes.watch`; change by `Hermes.run(command)` |
| Whether that session is attached, its stream cursor, its parked frames | the same actor, as the `Gate` value inside its `Tracked` state, changed only through `reduce` | nobody. `Session.sync` is derived from it by `syncOf` at publish time |
| Revision, text position, paging cursor | the same actor, as `Fence` | nobody |
| Running, asking, settled | derived from `Session.run` by `activityOf` | nobody stores it |
| What Hermes said while no turn ran (`interlude`) | the same actor, through `reduce`. The next turn's start seals it into `history` as one entry whose outcome is `interlude` | read through `Hermes.watch`. A rebuild drops it |
| Hermes's switches for a chat (`tuning`) | the same actor, through `reduce`: a `facts` input tagged with the attach it was read under, and `tuned` after this client's `config.set` | windows send `tune` |
| Which windows watch a chat | the hub, as a count per chat. A command waiting for an attach watches too and is not counted | the actor asks `watched()` before it reads facts |
| Stored list rows and the set of running sessions | `sidebar.ts` | `Sidebar` is derived from them plus each actor's session when published |
| What Highwing knows about the bots: loading, offline, unsupported, refused, or a roster | `roster.ts`, changed only through its `after` function | read through `Hermes.bots` and the `bots` topic. The hub says when to ask |
| Where each bot is drawn and its avatar tone | nobody; `rosterOf(facts)` in `domain/bots.ts` computes them from each answer | the renderer draws the roster as given and picks no colour |
| Which chat is open, the Bot Chat of each bot, and which bot owns a session | `open.ts`, changed only through `nextDesk` in `domain/open.ts` | windows read the `open` topic and send `open` and `start`. The hub reads `botOf` to build a session's actor |
| Which profile a call runs in | `Connection.as(bot)` in `wire/link.ts`, which adds `profile` to every call made through it | an actor calls only through the connection it was given |
| Where Hermes runs, which screen shows, and which `Hermes` is live | `ownConnection` in `main/connection.ts`, changed only through `nextSetup` | windows read the `setup` topic and send `checkTarget`, `editTarget`, `keepTarget`, `openChat` |
| The saved connection on disk | `main/settings.ts` | nobody. `ownConnection` gets `loaded` and `save` as arguments |
| A window's copy of a topic | `renderer/store.ts` in that window, written only by `applyPush` | components read with `useTopic` |
| A chat's unsent draft | `renderer/composer/drafts.ts` in that window, kept on disk by `main/drafts.ts` | the composer reads it with `useDraft`, the chat list with `useChatDrafts`; not Hermes's state |
| The files staged for a message | the bytes: `main/attachments.ts`, under userData `attachments/`; which ones and in what order: the chat's draft | the window holds ids and names only. The hub reads the bytes through its `uploads` option when the message is sent. A launch deletes files no draft names |
| Open rows | React state in that window | not shared; not Hermes's state |
| The bot search text and the last refusal of a click | React state in that window's sidebar. The selected bot is derived from the `open` topic and the roster on each render | not shared; not Hermes's state |
| The design C view | nobody; `threadView(session, clock)` recomputes it and memoises settled turns by reference | |
| When a turn began | `reduce`: the stored request row's time, or the clock reading the hub attaches to a live frame | nobody. The view derives every shown time from it |

Two windows on one session read the same actor through two IPC subscriptions. There is one socket and one reducer state no matter how many windows exist.

## Import rules

1. `domain/` imports nothing outside itself.
2. `@highwing/thread` imports `@highwing/hermes/domain` and nothing else.
3. `wire/contract.generated.ts` is imported only inside `packages/hermes/src/wire/` and `testing/`. No public entry exports a type from it.
4. `packages/hermes` never imports `electron`. It takes a `Dialer` and a `Clock` instead of reaching for globals.
5. The renderer imports `@highwing/hermes/domain`, `@highwing/thread` and `ipc-contract.ts`. It cannot import `@highwing/hermes` or `./testing`, which need Node.
6. Main imports `@highwing/hermes` and `ipc-contract.ts`. Only `main/index.ts` imports `./testing`, to honour `HIGHWING_FIXTURE` and `HIGHWING_RECORD`.
7. `main/settings.ts`, `main/drafts.ts`, `main/attachments.ts` and `main/connection.ts` never import `electron`. They take the settings directory, the drafts directory, the attachments directory, the dialog and clipboard, the check and the route as arguments.

Rules 2, 3 and 5 are enforced by `exports` maps and by the renderer's tsconfig having no Node types. Rules 1, 3 and 4 inside the package, and rule 7, are enforced by one ESLint `no-restricted-imports` block per folder. CI runs both.

## The path of one event

A `message.delta` frame becomes pixels in four steps.

1. `hub.ts` receives the frame from `link.ts`, calls `parseEvent` (`wire/parse.ts`) and hands the result to the actor.
2. `actor.ts` calls `reduce` (`domain/reduce.ts`). The gate inside the reducer applies, parks or drops the frame. The actor publishes the new `Session`.
3. `main/ipc.ts` sends a `Push` holding only the changed tail and the other fields whose reference changed. `renderer/store.ts` applies it.
4. `threadView` (`@highwing/thread`) derives the view, and the `Thread` component draws it.

## How it is tested

| What | How | Where |
|---|---|---|
| Design C | `outline(threadView(session, clock))` compared with a golden text, for each fixture | `@highwing/thread` tests |
| Soundness at every moment | `checkThread(threadView(session, clock))` on every step of every fixture | same |
| Find | `findInThread(threadView(session, clock), query)` on the settled errand, counted against `outline` with every row open | same |
| What Hermes says | `fixtures/says.jsonl`, from Hermes's own emitters: `playToEnd` equals the direct fold, a drop after every push ends in the same session and outline, and `checkThread` holds at every moment | `@highwing/hermes` and `@highwing/thread` tests |
| The attach order | `reduce` fed the `attached` cases by hand: a catch-up frame that ends the turn, a hole, a new epoch | `domain/` tests |
| Reconnect | `playToEnd(fixture, { drop })` for a drop after every push, compared with the undisturbed outline | `@highwing/hermes` tests |
| A gap | the same with `ringFrames` small, so replay answers `snapshot_required` | same |
| Protocol rules | the scripted gateway refuses a wrong key set, a verb on an unattached socket, and (on loopback) an `Origin` header or a reused ticket | every fixture test |
| The open chat | `nextDesk` fed a table of event sequences: the launch pick, a click that needs a lookup, two clicks, an answer for an earlier click, a refusal, a switch back | `domain/` tests |
| Bots and profiles | the scripted gateway routes each frame by its `profile` as Hermes's dispatcher does, plays a Bot Chat per bot and answers `<profile>: <text>`, so a hub test reads which bot a message ran as | `@highwing/hermes` tests |
| Attachments | `play(errand, { attach })` sends the first message with an image. The scripted gateway stages images and files as Hermes does and refuses a submit that names a path it did not stage, so `test/attach.test.ts` checks the attach call came first and the submit named its path | same |
| The ticket | `mintWith` fed scripted command replies, and both routes run against the fake `hermes`, which answers `--serve` | same |
| Contract drift | `pnpm contract:drift` compares the two vendored contract files with the installed Hermes and prints the methods and event types that changed | CI and after each `hermes update` |
| Illegal states | `tsc -p sketch/.typecheck/tsconfig.json` | CI |

## Build order, each unit ending in a check

1. Workspace, lint rules, `sync:contract`, `contract:drift`, and `make_fixture.py` emitting canonical envelopes and stored rows. Check: the errand fixture loads, every frame parses to a session frame, and `contract:drift` reports no difference.
2. `domain/` and `wire/parse.ts`. Check: reducer tests over the fixture's frames, including a duplicated frame, two tools running at once, and the three `attached` cases.
3. `@highwing/thread`. Check: `outline` of the settled errand matches the settled-C screenshot line for line, and `checkThread` passes on every step.
4. `wire/link.ts`, `actor.ts`, `sidebar.ts`, `hub.ts`, `testing/`. Check: `playToEnd` gives the same session as the direct fold of unit 2. A drop after every push ends in the same outline. A small ring ends in a rebuilt session. On loopback, the upgrade carries no `Origin` and each dial uses a new ticket.
5. Electron shell with `HIGHWING_FIXTURE`. Check: the app replays the errand and matches the three C screenshots, and "Run once" releases the story.
6. Live gateway. Check: connect, list, create and send on this machine, where the turn fails with `auth_permanent` and the thread says so in plain words. Record that run as the first real fixture, read the answers to the checks listed in the rationale from it, and time the first open of the largest stored session.

## Where later features land

| Feature | What it adds | What it does not touch |
|---|---|---|
| Quick-ask window | A Hyprland bind runs `highwing --quick-ask`. Electron's single-instance lock hands that to the running app through the `second-instance` event, which opens a second `BrowserWindow`. The window sends `create` then `send` and watches the session. The design does not rely on Electron's global shortcut API under Wayland. This route is not yet tried on the real compositor. | hub, socket |
| Tray | `hermes.sidebar.subscribe` in main | renderer |
| Per-session popouts | another window calling `watch('session:<id>')` | hub; no second attach |
| Model picker, settings | new `Command` members, `Session` fields fed by `meta` events | the reducer's turn logic |
| Attachments | a field on the `send` command and on `Request` | view grouping |
| Subagents, todos | new `Item` kinds, parse table rows moved from unshown to shown, new `ThreadNode` kinds | attach lifecycle |
| Sudo and secret prompts | new `Ask` kinds answered through the same `answer` command, and the hub's `refuse` stops declining those methods | card plumbing |
| Core in a `utilityProcess` | a new composition root in `apps/desktop/src/main/` that hosts `openHermes` there and serves windows over ports | `@highwing/hermes`, `@highwing/thread`, renderer |
