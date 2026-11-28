# Connect by URL

Design for issue #151. Status: proposed, waiting for review. No code is written against it yet.

The goal is a third choice on the setup screen. You type the address of a Hermes gateway, and Highwing checks it, signs in, saves it, reopens it after a restart, and chats through it. The local and SSH routes stay as they are.

## Problem

Both routes Highwing has today get a ticket by running `hermes gateway attach` on the gateway's machine. The gateway redeems that native ticket only from a loopback peer that sends no `Origin` header (`gateway/run_api.py:521-541` in Hermes 0.23.3, `be787439`). A URL route can run nothing on that machine, so it needs a ticket that Hermes issues over HTTP to a remote peer.

The issue sized this as a parser change and a radio button and put auth out of scope. Without auth, a URL route cannot connect at all. Most of this design is about the sign-in.

## What Hermes 0.23.3 offers a client that has only a URL

On a default install it offers nothing. The gateway's listener binds `127.0.0.1` on a random port (`gateway/webapp_listener.py:51-55`).

One route exists after the operator turns on the gateway's Webapp listener. The operator sets `webapp.enabled: true` in `~/.hermes/config.yaml`. Then the operator sets `webapp.host` to a wildcard, or to one address of the machine in builds newer than the host's `caafe5389ae5`, or keeps it on loopback and sets `webapp.public_url` behind a proxy (`webapp_listener.py:1-14`). A non-loopback or public listener is gated by sign-in and needs a provider, such as `dashboard.basic_auth` (`plugins/dashboard_auth/basic`). Hermes serves no TLS. Its docs send you to Tailscale Serve, a tunnel, or a reverse proxy for HTTPS (`website/docs/user-guide/desktop.md:136-143`).

The route has four steps. Each step is in Hermes's source.

1. `GET /api/status` is public (`hermes_cli/dashboard_auth/public_paths.py:15`). It reports `version`, `auth_required` and `auth_flows`.
2. The client signs in in the system browser with RFC 8252 PKCE. It opens `/auth/native/authorize` with a redirect to `http://127.0.0.1:<port>/callback`, then posts the code to `/auth/native/token`. The reply holds an access token and a refresh token (`hermes_cli/dashboard_auth/routes.py:307-355`, `:605-618`). A password provider shows Hermes's own `/login` form in the browser, so Highwing never sees the password.
3. Before each dial, the client sends `POST /api/auth/ws-ticket` with `Authorization: Bearer <access token>`. The reply is a ticket that works once, for 30 seconds (`routes.py:583-595`).
4. The client dials `<url>/api/ws` with the subprotocols `hermes-gateway-v1` and `hermes-gateway-ticket.<ticket>`. Those are the subprotocols `dialWith` already sends. For a remote peer, `run_api.py:524` passes the upgrade to the dashboard mount. That mount takes the ticket from the subprotocol, selects `hermes-gateway-v1` (`hermes_cli/web_server_chat.py:384-419`), and runs the chat with the gateway's session authority (`hermes_cli/web_routers/chat_ws.py:650-707`). An absent `Origin` is allowed (`hermes_cli/web_server_boundary.py:269-271`).

Hermes Desktop's "Remote gateway" option uses a different server. It targets the standalone `hermes dashboard` and dials `/api/ws?ticket=` with no subprotocol (`apps/desktop/src/api/canonical-protocol.ts:12-21`). That server's socket has no session authority (`tui_gateway/ws.py:378-401`), and Highwing refuses its `gateway.ready` (`packages/hermes/src/wire/link.ts:390`). Highwing must reach the gateway's Webapp, not the dashboard.

The real host `hermes` runs 0.23.3 (`caafe5389ae5`). Read-only checks found the following:

- Before 2026-11-25 the Webapp listener was off. `config.yaml` had no `webapp:` block, and the gateway listened on `127.0.0.1:8646`.
- `:9119` is `hermes dashboard --host 0.0.0.0`. Its `/api/status` answers `auth_required: true` and `auth_flows: ['cookie', 'native_pkce']`, its only provider is `basic`, and `POST /api/auth/ws-ticket` with no bearer answers 401.
- `:8787`, the port in the issue's example, is a third-party `hermes-webui` container.

A URL connection to this host works only after the operator turns on the Webapp.

### Proven on the real host, 2026-11-25

With the operator's approval, the Webapp was turned on at `127.0.0.1:9120` behind `tailscale serve --https=8480`, and the gateway restarted. The host runs 0.23.3 `caafe5389ae5`. Its `webapp_listener.py:106` accepts only `127.0.0.1`, `::1`, `localhost`, `0.0.0.0` or `::`, so a bind to the tailnet address alone is not possible there. A Python probe then ran every step of the route against the host's `https://<machine>.<tailnet>.ts.net:8480` address, and every step passed:

1. Signed out, `/api/status` answered 200 with exactly the 9 predicted keys. `:9119` answered 34 keys, including `config_version` and `gateway_mode`.
2. `/auth/native/authorize` redirected to `/login`. `POST /auth/password-login` sent the browser to the loopback callback with a code and a matching `state`. `/auth/native/token` returned an access token, a refresh token, `expires_at`, `provider: basic` and `user_id`. A replay of the code answered 400.
3. `/api/auth/ws-ticket` with the bearer answered `{ticket, ttl_seconds: 30}`.
4. The dial with `hermes-gateway-v1, hermes-gateway-ticket.<t>` and no Origin answered 101. The first frame was `gateway.ready` with `session_authority: true`. A replay of the used ticket answered 403.
5. `/auth/native/refresh` returned a new access token and rotated the refresh token. A ticket from the new token dialed again.

Three findings change the build:

- The refresh token rotates. `gateways.ts` must keep the new one each time, through the one login per URL.
- `auth_providers` in the status lists the operator's plugin `conduit-local-live`, which has no sign-in page. `/api/auth/providers` lists only `basic`. The `no-sign-in` decision reads `auth_flows` for `native_pkce`, not `auth_providers`.
- Hermes 0.23.3 has no password-free sign-in for an app when the Webapp is gated. The verify run signs in through the real `/login` page with the password from a one-use secret file, then deletes the file.

The Webapp's browser bundle is not built on the host (`hermes webapp --status`). Highwing needs only the API and the server-rendered `/login`, so it is unaffected.

`docs/design/remote.md` has two stale claims. Its citation `run_api.py:472-493` is now `:521-541`. Its "needs a `0.0.0.0` bind" is outdated, because `webapp.host` also takes `::`, one address of the machine, or loopback with `public_url`. The implementation fixes both.

## Usage

The setup screen offers **Another machine on my tailnet**, **A Hermes gateway at a web address**, and **This computer**. The address choice has one field, **Gateway address**, with the placeholder `https://hermes.example.com`.

1. You type `hermes.example.com` and click **Connect**. Highwing reads it as `https://hermes.example.com`.
2. The screen shows "Looking for Hermes on hermes.example.com".
3. Your browser opens Hermes's sign-in page. The screen shows "Waiting for you to sign in to hermes.example.com in your browser" and a **Stop waiting** button.
4. After you sign in, the screen shows "Opening the Hermes gateway on hermes.example.com", then "Saving this connection", then "Highwing now uses the Hermes on hermes.example.com."
5. After a restart, the chat opens with no browser. If Hermes ends the sign-in, the chat banner says so and offers **Sign in**.

Main process wiring:

```ts
const keep = signInStore(settingsDir, await sealFor(safeStorage))
const gateways = gatewaysByUrl({ keep, browse: opener.browse })

const routeFor = (target: Target): Route => byKind<Route>(target, {
	local: () => ({ dial: liveDialer(), dispose: () => {} }),
	remote: ({ host }) => remoteRoute(host),
	url: ({ url }) => gateways.route(url)
})

ownConnection({
	loaded,
	check: (target, options) => checkTarget(target, { ...options, gateways }),
	save: async target => { await saveSettings(settingsDir, target); await gateways.keepOnly(addressOf(target)) },
	routeFor: target => recordedRoute(routeFor(target)),
	open
})
```

A unit test against the fake Webapp:

```ts
const web = await fakeWebapp('ok', gateway, clock)
const gateways = gatewaysByUrl({ keep: memoryKeep(), browse: web.user.signIn })
const steps: CheckStep[] = []
expect(await checkTarget({ kind: 'url', url: web.url }, { signal, onStep: s => steps.push(s), gateways })).toEqual({ ok: true })
expect(steps).toEqual(['hermes', 'sign-in', 'gateway'])
for (const secret of web.secrets) expect(JSON.stringify(steps)).not.toContain(secret)
```

## Shape

### The target and its parser

```ts
type GatewayUrl = string & { readonly [gatewayUrl]: true }
type Target =
	| { readonly kind: 'local' }
	| { readonly kind: 'remote'; readonly host: SshHost }
	| { readonly kind: 'url'; readonly url: GatewayUrl }
```

`parseGatewayUrl` is the only function that makes a `GatewayUrl`, and `targetOf` calls it. The settings file, the IPC command, and the form use the same rule. The parser has these rules:

- It reads text with no scheme as `https://`. It accepts `https:` and `http:` to any host (decision 1). `isPlainHttp(url)` is true for `http:` to a host other than loopback, and the form warns about it.
- It refuses a username or password, a `?` part, and a `#` part. A one-use Webapp link carries its token after the `?`.
- It keeps a path as a proxy prefix, drops the default port and a trailing slash, and lowercases the host.

The output is canonical, so two addresses name the same gateway exactly when the strings are equal. `targetOf` refuses a spelling that is not canonical. The parser refuses credentials and query parts, so a `Target` cannot carry a secret (per type-system-discipline).

### Every branch on the kind

Today, tsc catches 3 of the 11 places that compare `kind`. The other 8 read a URL target as "the other kind". `sameTarget` (`apps/desktop/src/main/connection.ts:73`) and the first check step (`connection.ts:37`) are 2 of those 8. `byKind(target, { local, remote, url })` takes a full record, so a fourth kind fails tsc at every call. `sameTarget`, `firstStep`, `onThisComputer` and `machineOf` move into `reach.ts` on top of `byKind`. An ESLint rule refuses `x.kind === 'local' | 'remote' | 'url'` outside `reach.ts`, and its message names `byKind`. With `byKind`, `sameTarget` compares the URL, so two addresses are two targets.

### One module for everything behind a URL

`packages/hermes/src/wire/gateways.ts` exports `gatewaysByUrl({ keep, browse })` and three methods: `check(url, options)`, `route(url)`, and `keepOnly(url | null)`. The module hides the status read, PKCE, the loopback callback listener, the token exchange, the refresh, and the ticket mint. The credential type is not exported, and its `toString` and `toJSON` print `•••`.

`route(url)` is one more `Mint` for the unchanged `dialWith`. `Route`, `Dialer`, `remoteRoute` and `liveDialer` do not change. The route ignores `start` and never fails as `not-running`, so **Start Hermes** never shows for a URL target.

Refresh tokens rotate, so two refreshes at once leave one caller with a dead token. `gatewaysByUrl` keeps one login per `GatewayUrl`, and every refresh goes through that login's single promise. Main builds one `gateways` and gives it to both the check and the route (per separate-before-serializing-shared-state).

### Where the credential lives

`apps/desktop/src/main/sign-ins.ts` owns `sign-ins.json` beside `connection.json`. The file has mode 0600 and is written through a temp file and a rename. Its shape is `{"version":1,"signIns":{"<GatewayUrl>":"<base64 of safeStorage.encryptStringAsync(secret)>"}}`.

If `safeStorage` cannot encrypt, or its Linux backend is `basic_text`, nothing goes to disk. The login lives in memory for one run, and the next launch asks you to sign in again. Highwing never writes a token that anyone can read.

A login is deleted in these cases:

- Hermes refuses its refresh.
- The check that created it fails at the `gateway` step.
- `keepOnly` runs at launch and after each save. It keeps only the login of the saved target.

A token never enters `Target`, `connection.json`, IPC or a log. `GatewayUrl` refuses secrets, the credential type is not exported, `Setup` carries only string literals, and a test and the verify leak scan search every published state and file for the fake's tokens.

### Check steps

The step order becomes `tailscale, peer, ssh, hermes, sign-in, gateway, save`. The URL route runs `hermes`, `sign-in` and `gateway`, then the owner runs `save`.

- The `hermes` step reads `/api/status`. A gated Webapp gives a signed-out caller nine fixed keys (`hermes_cli/web_routers/status.py:533-535`). The standalone dashboard also returns `config_version` and `gateway_mode`, as the real host's `:9119` does. The check therefore says "dashboard" before any browser opens.
- The `sign-in` step reuses a kept login if Hermes still accepts it. Otherwise it opens the browser and waits up to 10 minutes, the life of Hermes's pending login (`native_flow.py:28`). **Stop waiting** sends the existing `keepTarget` command, which is now accepted at this step on a first run.
- The `gateway` step mints a ticket, dials one socket, and waits for `gateway.ready` with `session_authority`. This is the only sure test that the address serves the gateway's chat.

`CheckFailure` and `CHECK_FAILURES` stay as they are and stay paired with `testing/fake-host.ts`. The new `UrlFailure` and `URL_FAILURES` pair with `testing/fake-webapp.ts`, whose scenario table is a `Record` over `UrlFailure`. A new failure does not compile without a scenario. The screen looks up both tables through one function, `failureOf`.

### Settings stay at version 1

A URL target is a new value in the same shape. An older Highwing reads a URL file as unreadable, opens setup, and sets the file aside on its next save, so nothing is lost. A bump to version 2 would change `settings.test.ts:24` and `:66` and the verify skill's `--saved newer`.

## Failure words

`gw` is `machineOf(target)`, the host of the address. Hermes's own login page tells you about a wrong password, so Highwing has no failure for it.

The form shows these problems. Nothing is contacted.

| Kind | Words | Fix |
|---|---|---|
| `not-an-address` | That isn't a web address. | Type the address of the gateway's Webapp, such as https://hermes.example.com. |
| `credentials` | That address has a username or password in it. | Take them out. Highwing asks you to sign in on Hermes's own page instead. |
| `extras` | That address has a ? or # part, which can hold a sign-in secret. | Use the address up to the ? or #. |

When `isPlainHttp(url)` is true, the form shows this warning under the field and still lets you press Connect. Hermes marks its cookies `Secure` only when it sees https (`hermes_cli/dashboard_auth/middleware.py:153,230,358`), so its sign-in works over plain http.

> This address uses plain http, so your Hermes sign-in and your chats travel unencrypted. Anyone on the network between here and gw could read them. Use https if you can.

The check shows these failures.

| Step | Kind | Words | Fix |
|---|---|---|---|
| `hermes` | `url-unreachable` | Highwing can't reach gw. | Check the address, and that the machine and its Hermes gateway are on. |
| `hermes` | `url-certificate` | This computer doesn't trust the certificate of gw. | Give that address a certificate this computer trusts, such as one from Tailscale Serve or Let's Encrypt. |
| `hermes` | `not-hermes` | Something answers at gw, but it isn't Hermes. | Use the address of the gateway's Webapp. Add a path only if a proxy serves Hermes under one. |
| `hermes` | `hermes-too-old` (existing) | The Hermes on gw is too old for Highwing. | Update Hermes there, then try again. |
| `hermes` | `no-sign-in` | The Hermes on gw has no sign-in that Highwing can use. | On that machine, give the Webapp a sign-in, such as a username and password under dashboard.basic_auth, then restart the gateway. |
| `hermes` | `dashboard` | What answers at gw is the Hermes dashboard, which Highwing can't chat through. | Use the address of the gateway's Webapp instead. That is webapp.public_url in ~/.hermes/config.yaml on that machine, or, when it is empty, http:// with the machine's address and webapp.port, such as http://192.168.1.20:9120. If nothing answers there, set webapp.enabled, and set webapp.host to the machine's LAN address, then restart the gateway. |
| `sign-in` | `sign-in-cancelled` | You stopped the sign-in to gw. | Press Connect when you want to sign in. |
| `sign-in` | `sign-in-timed-out` | You didn't finish signing in to gw within 10 minutes. | Press Connect to open the sign-in page again. |
| `sign-in` | `sign-in-refused` | The Hermes on gw didn't accept the sign-in. | Press Connect to sign in again. |
| `gateway` | `url-no-socket` | You signed in to gw, but its chat connection didn't open. | If a proxy or tunnel serves this address, let it pass WebSocket connections through to Hermes. |
| `gateway` | `url-legacy` | You signed in to gw, but it answered with the dashboard's older chat, which Highwing can't use. | On that machine, turn on the gateway's Webapp and use its address. |
| `save` | `cant-save` (existing) | Highwing couldn't save this connection. | Check that Highwing's settings folder can be written to, then try again. |

The chat banner shows these after a connection is saved.

| Situation | Link state | Words |
|---|---|---|
| Hermes refused the refresh | blocked, new `signed-out` | Your sign-in to the Hermes on gw has ended. **Sign in** |
| No keyring, after a restart | blocked, `signed-out` | Sign in to the Hermes on gw. This computer has no keyring, so Highwing asks each time it starts. **Sign in** |
| Network or machine down | waiting, `unreachable` | Highwing can't reach gw. It retries. |

**Sign in** runs `editTarget`, then `checkTarget` for the live target, so the banner uses the same sign-in as the setup screen.

## Fake Webapp and verify

`testing/fake-webapp.ts` serves the Webapp's HTTP routes on the port of `loopback()`, which gains an optional `serve` handler and an `upgrades: 'gateway' | 'legacy' | 'refused'` option. The upgrade gate that the SSH tests trust also gates URL dials. The fake keeps Hermes's rules: S256 only, a loopback IP redirect, single-use codes, rotating refresh tokens, and 401 without a live bearer. It has one scenario per `UrlFailure`, plus `ok` and `signed-out-later`.

The verify skill gets these additions:

- `--fake-webapp <scenario>` starts the fake.
- `--keyring` makes an unpackaged build use a test keyring, so a restart proves the kept sign-in.
- `HIGHWING_SIGN_IN_MS` shortens the sign-in wait in an unpackaged build, so the timeout screenshot takes seconds.

## Synthesis decision

Two runners, Opus and Fable, designed this independently, and a Fable judge scored them. Both the judge and the review in this session picked the Fable design as the base, 23 to 22 of 30. That design changes fewer existing tests. It adds no new command, because it reuses `keepTarget`. It uses `byKind` plus a lint rule, which catches the 8 sites tsc misses.

Grafts from the Opus design:

- Bare text gets an `https://` scheme.
- The URL route has three steps, `hermes`, `sign-in` and `gateway`. The status read is one request, so it is one step.
- The `gateway` failure is split into `url-no-socket` (a proxy that drops WebSocket) and `url-legacy` (the dashboard after all), because they need different fixes.
- The sign-in wait is 10 minutes and can be shortened for verify.
- The credential prints as `•••`.
- `safeStorage` is called through its async API.

Rejected:

- The Opus `cancelSignIn` command, because it breaks `ipc.test.ts:328`.
- The Opus version-2 settings file, because it changes two settings fixtures.
- The Opus tailnet rule based on spelling. `100.64.0.0/10` is also carrier-grade NAT space, so a saved `http://100.x` target would send its bearer in the clear when Tailscale is off.

## Tradeoffs accepted

- We change one line in `reach.test.ts:60`, the step `ORDER` list, so that one step vocabulary serves every route. Every other existing test is unchanged.
- We keep two failure tables so that `check.test.ts` and `fake-host.ts` stay unchanged, and so that each table is tied to the fake that can produce its failures.
- `CheckOptions.gateways` is optional, and a URL check without it throws. This keeps the existing `checkTarget` calls in `check.test.ts` unchanged.
- The check signs in and opens one socket, unlike the host checks, which contact no gateway. In exchange, Highwing never saves a connection that cannot chat.
- A computer with no keyring asks for a sign-in at each launch. In exchange, Highwing never writes a token that anyone can read.
- There is no **Sign out** button and no revoke on the Hermes side. Switching to another target forgets the login on this computer.

## Alternatives considered

- **Sign in on the first dial, not in the check.** This keeps the check free of dependencies. It lost because Highwing would save a dashboard address, and every sign-in failure would land in a chat banner that has no room for a fix.
- **Keep the credential in the target, as Hermes Desktop does.** It lost because `Target` crosses IPC and sits in `connection.json`.
- **Use the static `HERMES_DASHBOARD_SESSION_TOKEN` (Hermes route B).** It lost because the token never expires, carries no identity, and Hermes steers internet setups away from it.

## Decisions

1. **Plain http.** Allowed to any host, with the warning above on the form. Text with no scheme still becomes `https://`. (Operator, 2026-11-25.)
2. **The `reach.test.ts` order line.** The step-order line gains `sign-in` and `gateway`. Every SSH and local test stays as it is. A new test proves that a URL target connects to the fake Webapp and chats.
3. **The real-host run.** Allowed. Verify enables the Webapp on `hermes`, gives it an address, and restarts the gateway. The PR records each change made to the host.
4. **Keyring on Linux.** Highwing keeps the sign-in in the system keyring when `safeStorage` has a real one. When the backend is `basic_text` or unavailable, it keeps the sign-in in memory and asks again at the next launch. Highwing passes `--password-store=gnome-libsecret` on Linux when a Secret Service answers on D-Bus. Verify checks both paths with `--keyring`.
5. **PR shape.** Three stacked PRs, each ending in a state that tests prove. The first adds `GatewayUrl`, `parseGatewayUrl`, `isPlainHttp`, `byKind` with its lint rule, and moves the existing `local` and `remote` branches onto `byKind`. It changes no behavior, and the existing tests pass unchanged. The second adds `wire/gateways.ts`, the fake Webapp, and the URL check in `packages/hermes`, tested against the fake. The third adds the `url` variant to `Target`, so every `byKind` site must handle it, and adds the sign-in store, the setup form, the banner, and verify against the real host. Adding the variant last means no build ever saves a URL target it cannot connect to.

## Next step

Write `GatewayUrl`, `parseGatewayUrl`, `byKind` and the lint rule in `reach.ts`, move the 11 kind comparisons onto `byKind`, and prove with tsc and `reach.test.ts` that a URL target round-trips.

The type sketch is at `/tmp/arena-issue151/candidate-2/sketch/`, with the grafts above still to fold in. The Opus candidate is at `/tmp/arena-issue151/candidate-1/`.
