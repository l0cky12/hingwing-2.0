import { connect } from 'node:net'
import { inspect, isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { BOARD_PATH } from '../src/domain/tasks'
import { failureOf, URL_FAILURES, type CheckStep, type GatewayUrl, type UrlFailure } from '../src/domain/reach'
import type { Link } from '../src/domain/session'
import { DialError, gatewaysByUrl, memoryKeep, openHermes, type GatewayDeps, type Gateways, type Hermes, type Keep, type Route } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { WEBAPP_SCENARIOS, type FakeWebapp, type WebappScenarioName } from '../src/testing/fake-webapp'
import { playToEnd } from '../src/testing/fixture'
import type { Loopback } from '../src/testing/loopback'
import { Credential } from '../src/wire/gateways'
import { ERRAND } from './support/errand'
import { closing, errandGateway, listen, until } from './support/host'
import { errand, fold, ignoringStartTimes } from './support/story'
import { webapp } from './support/webapp'

const STEPS: readonly CheckStep[] = ['hermes', 'sign-in', 'gateway']
const ACCEPTED = (ticket: number) => ({ origin: null, ticket, refused: null })
const NO_BROWSER = async () => { throw new Error('the browser was opened') }

const gatewaysTo = (web: FakeWebapp, deps: Partial<GatewayDeps> = {}): Gateways => gatewaysByUrl({ keep: memoryKeep(), browse: web.browse, ...deps })

const check = (gateways: Gateways, url: GatewayUrl, life = new AbortController()) => {
  const steps: CheckStep[] = []
  return { steps, life, result: gateways.check(url, { signal: life.signal, onStep: step => steps.push(step) }) }
}

const signedIn = async (web: FakeWebapp, deps: Partial<GatewayDeps> = {}): Promise<Gateways> => {
  const gateways = gatewaysTo(web, deps)
  expect(await check(gateways, web.url).result).toEqual({ ok: true })
  return gateways
}

const routeOf = (gateways: Gateways, url: GatewayUrl): Route => closing(gateways.route(url), route => route.dispose())

const open = (route: Route): Hermes =>
  closing(openHermes({ dial: route.dial, client: { name: 'highwing-test', version: '0' } }), hermes => hermes.close())

const linkIs = (hermes: Hermes, state: Link['state']) => until(`the link to be ${state}`, () => hermes.link.get().state === state)

const dialFailure = (dial: Promise<unknown>) => dial.then(
  () => { throw new Error('the dial went through') },
  (error: unknown) => (error instanceof DialError ? { kind: error.kind, message: error.message } : { threw: String(error) })
)

const count = (web: FakeWebapp, request: string) => web.requests.filter(made => made === request).length
const callbackOf = (authorize: string) => new URL(authorize).searchParams.get('redirect_uri') as string
/** Sends `request` as written and resolves with everything the server sent before it closed the connection. */
const raw = (address: string, request: string) => new Promise<string>((resolve, reject) => {
  const { hostname, port } = new URL(address)
  let heard = ''
  const socket = connect(Number(port), hostname, () => socket.write(request))
  socket.on('data', chunk => { heard += chunk.toString() })
  socket.on('error', reject)
  socket.on('close', () => resolve(heard))
})
const listenerIsClosed = (authorize: string | undefined) => expect(fetch(callbackOf(authorize ?? ''))).rejects.toThrow('fetch failed')

describe('the scenarios of the fake Webapp', () => {
  it('give every failure only a check by address can find a scenario that ends in it', () => {
    for (const failure of Object.keys(URL_FAILURES) as UrlFailure[]) expect(WEBAPP_SCENARIOS[failure].verdict, failure).toBe(failure)
  })
})

describe('the check of a gateway address, against the fake Webapp', () => {
  const QUICK = (Object.keys(WEBAPP_SCENARIOS) as WebappScenarioName[]).filter(name => WEBAPP_SCENARIOS[name].user === 'signs-in')

  it.each(QUICK)('ends the %s scenario in its verdict, at the step that verdict names', async name => {
    const { verdict } = WEBAPP_SCENARIOS[name]
    const web = await webapp(name)
    const { result, steps } = check(gatewaysTo(web), web.url)
    expect(await result).toEqual(verdict === null ? { ok: true } : { ok: false, failure: verdict })
    expect(steps).toEqual(verdict === null ? STEPS : STEPS.slice(0, STEPS.indexOf(failureOf(verdict).step) + 1))
  })

  it('opens the browser only once the status says the address is the Webapp', async () => {
    for (const name of ['dashboard', 'no-sign-in', 'ungated', 'too-old', 'not-hermes'] as const) {
      const web = await webapp(name)
      await check(gatewaysTo(web), web.url).result
      expect(web.opened, name).toEqual([])
      expect(web.requests, name).toEqual(['GET /api/status'])
    }
  })

  it('sends the browser to sign in with an S256 challenge, a state and a redirect to a port on 127.0.0.1', async () => {
    const web = await webapp('ok')
    await signedIn(web)
    const [authorize] = web.opened.map(opened => new URL(opened))
    expect(`${authorize?.origin}${authorize?.pathname}`).toBe(`${web.url}/auth/native/authorize`)
    expect(Object.fromEntries(authorize?.searchParams ?? [])).toEqual({
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: 'S256',
      redirect_uri: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/callback$/),
      state: expect.stringMatching(/^[\w-]{43}$/)
    })
    expect(web.pages).toEqual([expect.stringContaining("You're signed in to Hermes.")])
    await listenerIsClosed(web.opened[0])
  })

  it('waits 10 minutes for the user to sign in, then gives up and stops listening', async () => {
    const clock = manualClock()
    const web = await webapp('sign-in-timed-out')
    let ended = false
    const { result, steps } = check(gatewaysTo(web, { clock }), web.url)
    void result.then(() => { ended = true })
    await until('the browser to open', () => web.opened.length === 1)
    await clock.advance(599_999)
    expect(ended).toBe(false)
    await clock.advance(1)
    expect(await result).toEqual({ ok: false, failure: 'sign-in-timed-out' })
    expect(steps).toEqual(['hermes', 'sign-in'])
    await listenerIsClosed(web.opened[0])
  })

  it('waits for as long as it is told to', async () => {
    const web = await webapp('sign-in-timed-out')
    expect(await check(gatewaysTo(web, { signInMs: 20 }), web.url).result).toEqual({ ok: false, failure: 'sign-in-timed-out' })
  })

  it('stops waiting when the check is cancelled, and stops listening', async () => {
    const web = await webapp('sign-in-cancelled')
    const { result, steps, life } = check(gatewaysTo(web), web.url)
    await until('the browser to open', () => web.opened.length === 1)
    life.abort()
    expect(await result).toEqual({ ok: false, failure: 'sign-in-cancelled' })
    expect(steps).toEqual(['hermes', 'sign-in'])
    await listenerIsClosed(web.opened[0])
  })

  it.each([
    ['a state that is not its own', (authorize: string) => `${callbackOf(authorize)}?code=a-code&state=someone-elses`],
    ['no code', (authorize: string) => `${callbackOf(authorize)}?state=${new URL(authorize).searchParams.get('state')}`]
  ])('refuses a redirect back with %s, and stops listening', async (_what, back) => {
    const web = await webapp('ok')
    const opened: string[] = []
    const landed: Promise<Response>[] = []
    const browse = async (authorize: string) => {
      opened.push(authorize)
      landed.push(fetch(back(authorize)))
    }
    expect(await check(gatewaysTo(web, { browse }), web.url).result).toEqual({ ok: false, failure: 'sign-in-refused' })
    expect((await landed[0])?.status).toBe(400)
    expect(count(web, 'POST /auth/native/token')).toBe(0)
    await listenerIsClosed(opened[0])
  })

  it('answers 404 to a request it cannot read as a URL, and goes on waiting', async () => {
    const web = await webapp('ok')
    const answers: string[] = []
    const browse = async (authorize: string) => {
      answers.push(await raw(callbackOf(authorize), 'GET //[ HTTP/1.1\r\nhost: x\r\n\r\n'))
      await web.browse(authorize)
    }
    expect(await check(gatewaysTo(web, { browse }), web.url).result).toEqual({ ok: true })
    expect(answers[0]).toMatch(/^HTTP\/1\.1 404 /)
  })

  it('closes a connection still sending its request when the check is cancelled', async () => {
    const web = await webapp('sign-in-cancelled')
    const { result, life } = check(gatewaysTo(web), web.url)
    await until('the browser to open', () => web.opened.length === 1)
    const hanging = raw(callbackOf(web.opened[0] ?? ''), 'GET /callback HTTP/1.1\r\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    life.abort()
    expect(await result).toEqual({ ok: false, failure: 'sign-in-cancelled' })
    expect(await hanging).toBe('')
  })

  it('answers 404 to any other request on its port, and goes on waiting', async () => {
    const web = await webapp('ok')
    const stray: number[] = []
    const browse = async (authorize: string) => {
      stray.push((await fetch(new URL('/favicon.ico', callbackOf(authorize)))).status)
      await web.browse(authorize)
    }
    expect(await check(gatewaysTo(web, { browse }), web.url).result).toEqual({ ok: true })
    expect(stray).toEqual([404])
  })

  it('ends at once when the browser cannot be opened', async () => {
    const web = await webapp('ok')
    expect(await check(gatewaysTo(web, { browse: NO_BROWSER }), web.url).result).toEqual({ ok: false, failure: 'sign-in-refused' })
  })

  it('uses the sign-in it holds on a second check, and opens the browser again only after Hermes ended it', async () => {
    const web = await webapp('ok')
    const gateways = await signedIn(web)
    const again = check(gateways, web.url)
    expect(await again.result).toEqual({ ok: true })
    expect(again.steps).toEqual(STEPS)
    expect(web.opened).toHaveLength(1)

    web.signOut()
    expect(await check(gateways, web.url).result).toEqual({ ok: true })
    expect(web.opened).toHaveLength(2)
  })

  it('keeps the sign-in of a check that passed, and forgets the one it made when the gateway step fails', async () => {
    const [passing, failing] = [await webapp('ok'), await webapp('url-legacy')]
    const keep = memoryKeep()
    await signedIn(passing, { keep })
    const kept = await keep.load(passing.url)
    expect(passing.secrets.some(secret => kept?.includes(secret))).toBe(true)

    const gateways = gatewaysTo(failing, { keep })
    expect(await check(gateways, failing.url).result).toEqual({ ok: false, failure: 'url-legacy' })
    expect(count(failing, 'POST /auth/native/token')).toBe(1)
    expect(await keep.load(failing.url)).toBeNull()
    expect(await dialFailure(gateways.route(failing.url).dial({ start: false }))).toMatchObject({ kind: 'signed-out' })
  })

  it('shows no token, code or ticket in what it reports', async () => {
    const web = await webapp('ok')
    const gateways = gatewaysTo(web)
    const { result, steps } = check(gateways, web.url)
    const route = routeOf(gateways, web.url)
    const reported = [inspect([await result, steps, gateways, route], { depth: null, showHidden: true })]
    web.signOut()
    reported.push(JSON.stringify(await dialFailure(route.dial({ start: false }))), ...web.opened)
    expect(web.secrets.length).toBeGreaterThan(4)
    for (const secret of web.secrets) expect(reported.join('\n')).not.toContain(secret)
  })
})

describe('speech to text through a gateway address, against the fake Webapp', () => {
  const RECORDING = { mime: 'audio/webm;codecs=opus', audio: new Uint8Array([1, 2, 3]) }

  it("posts the recording with the address's sign-in and answers what Hermes heard", async () => {
    const web = await webapp('ok')
    const route = routeOf(await signedIn(web), web.url)
    expect(await route.transcribe(RECORDING)).toEqual({ ok: true, value: 'heard 3 bytes' })
    expect(count(web, 'POST /api/audio/transcribe')).toBe(1)
  })

  it('says the sign-in ended, in plain words, once Hermes ends it', async () => {
    const web = await webapp('ok')
    const route = routeOf(await signedIn(web), web.url)
    web.signOut()
    expect(await route.transcribe(RECORDING)).toEqual({ ok: false, refusal: { kind: 'offline', message: 'Your sign-in to the Hermes on 127.0.0.1 has ended.' } })
  })
})

describe('the route to a gateway address, against the fake Webapp', () => {
  it('connects and plays the errand to the session the direct fold gives, on tickets minted with the sign-in', async () => {
    const want = { ...fold(errand()).content, sync: { state: 'live' } }
    let web: FakeWebapp | undefined
    let gateway: Loopback | undefined
    const last = await playToEnd(ERRAND, {
      ended: session => isDeepStrictEqual(ignoringStartTimes(session), want),
      transport: async listening => {
        gateway = listening
        web = await webapp('ok', { gateway: listening })
        const gateways = await signedIn(web)
        return routeOf(gateways, web.url).dial
      }
    })
    expect(ignoringStartTimes(last)).toEqual(want)
    expect(gateway?.upgrades, 'the socket of the check, then the socket of the chat, each on its own ticket and with no Origin').toEqual([ACCEPTED(0), ACCEPTED(1)])
    expect(web?.requests).toEqual([
      'GET /api/status', 'GET /auth/native/authorize', 'GET /login', 'POST /auth/native/token', 'POST /api/auth/ws-ticket', 'POST /api/auth/ws-ticket'
    ])
    expect(web?.opened).toHaveLength(1)
  })

  it('reaches every profile, and mints a new ticket for each dial', async () => {
    const gateway = await listen(errandGateway())
    const web = await webapp('ok', { gateway })
    const route = routeOf(await signedIn(web), web.url)
    const sockets = [await route.dial({ start: true }), await route.dial({ start: false })]
    expect(sockets.map(socket => socket.reach)).toEqual(['host', 'host'])
    expect(gateway.upgrades).toEqual([ACCEPTED(0), ACCEPTED(1), ACCEPTED(2)])
    sockets.forEach(socket => socket.close())
  })

  it('checks, signs in and chats under the path a proxy serves Hermes at', async () => {
    const gateway = await listen(errandGateway())
    const web = await webapp('ok', { gateway, prefix: '/proxied/hermes' })
    const hermes = open(routeOf(await signedIn(web), web.url))
    await linkIs(hermes, 'online')
    expect(gateway.upgrades).toEqual([ACCEPTED(0), ACCEPTED(1)])
    expect(web.requests.every(request => request.split(' ')[1]?.startsWith('/proxied/hermes/'))).toBe(true)
  })

  it('refreshes once when Hermes no longer takes the bearer, however many dials and checks find out at once', async () => {
    const web = await webapp('ok')
    const gateways = await signedIn(web)
    const route = routeOf(gateways, web.url)
    web.lapse()
    const [checked, ...sockets] = await Promise.all([check(gateways, web.url).result, route.dial({ start: false }), route.dial({ start: false }), route.dial({ start: false })])
    expect(checked).toEqual({ ok: true })
    expect(count(web, 'POST /auth/native/refresh')).toBe(1)
    expect(web.opened).toHaveLength(1)
    sockets.forEach(socket => socket.close())
  })

  it('reads the gateway\'s HTTP API with the sign-in\'s bearer, refreshing once when Hermes no longer takes it', async () => {
    const web = await webapp('ok')
    const route = routeOf(await signedIn(web), web.url)
    expect(await route.read(BOARD_PATH)).toEqual({ status: 200, body: { columns: [{ name: 'todo', tasks: [] }] } })
    expect(count(web, 'POST /auth/native/refresh')).toBe(0)

    web.lapse()
    expect(await route.read(BOARD_PATH)).toMatchObject({ status: 200 })
    expect(count(web, 'POST /auth/native/refresh')).toBe(1)
    expect(await route.read('/api/plugins/kanban/missing'), 'a status passes through for the caller to read').toEqual({ status: 404, body: { detail: 'Not Found' } })
  })

  it('rejects a read for a sign-in Hermes ended', async () => {
    const web = await webapp('ok')
    const route = routeOf(await signedIn(web), web.url)
    web.signOut()
    await expect(route.read(BOARD_PATH)).rejects.toMatchObject({ kind: 'signed-out' })
    expect(count(web, `GET ${BOARD_PATH}`), 'the refused bearer was tried once, and not again on a sign-in that is gone').toBe(1)
  })

  it('connects after a restart on the refresh token it kept, with no browser, and keeps the token Hermes rotated it to', async () => {
    const web = await webapp('ok')
    const keep = memoryKeep()
    await signedIn(web, { keep })
    const first = await keep.load(web.url)

    const restarted = routeOf(gatewaysByUrl({ keep, browse: NO_BROWSER }), web.url)
    const sockets = await Promise.all([restarted.dial({ start: true }), restarted.dial({ start: true })])
    expect(count(web, 'POST /auth/native/refresh')).toBe(1)
    const second = await keep.load(web.url)
    expect(second).not.toBe(first)
    sockets.forEach(socket => socket.close())

    const hermes = open(routeOf(gatewaysByUrl({ keep, browse: NO_BROWSER }), web.url))
    await linkIs(hermes, 'online')
    expect(await keep.load(web.url)).not.toBe(second)
    expect(web.opened).toHaveLength(1)
  })

  it('blocks the link as signed-out when Hermes refuses the refresh, forgets the sign-in and opens no browser', async () => {
    const web = await webapp('ok')
    const keep: Keep = { ...memoryKeep(), durable: true }
    const gateways = await signedIn(web, { keep })
    web.signOut()

    const hermes = open(routeOf(gateways, web.url))
    await linkIs(hermes, 'blocked')
    expect(hermes.link.get()).toEqual({ state: 'blocked', why: 'signed-out', message: 'Your sign-in to the Hermes on 127.0.0.1 has ended.' })
    expect(await keep.load(web.url)).toBeNull()
    expect(web.opened).toHaveLength(1)

    await hermes.run({ do: 'reconnect', start: true })
    await linkIs(hermes, 'blocked')
    expect(hermes.link.get()).toMatchObject({ why: 'signed-out', message: 'Your sign-in to the Hermes on 127.0.0.1 has ended.' })
    expect(count(web, 'POST /auth/native/refresh')).toBe(1)
  })

  it('says a computer with no keyring asks for the sign-in at each start', async () => {
    const web = await webapp('ok')
    expect(await dialFailure(routeOf(gatewaysTo(web), web.url).dial({ start: false }))).toEqual({
      kind: 'signed-out',
      message: 'Sign in to the Hermes on 127.0.0.1. This computer has no keyring, so Highwing asks each time it starts.'
    })
    expect(web.requests).toEqual([])
  })

  it('waits and retries as unreachable when nothing answers, and keeps the sign-in', async () => {
    const gateway = await listen(errandGateway())
    const web = await webapp('ok', { gateway })
    const keep = memoryKeep()
    const route = routeOf(await signedIn(web, { keep }), web.url)
    await gateway.close()

    expect(await dialFailure(route.dial({ start: false }))).toEqual({ kind: 'unreachable', message: "Highwing can't reach 127.0.0.1." })
    const hermes = open(route)
    await linkIs(hermes, 'waiting')
    expect(hermes.link.get()).toMatchObject({ why: 'unreachable', message: "Highwing can't reach 127.0.0.1." })
    expect(await keep.load(web.url)).not.toBeNull()
  })

  it.each([
    ['502 from a proxy whose Hermes is down', 502, { kind: 'unreachable', message: "Highwing can't reach 127.0.0.1." }, 'url-unreachable'],
    ['404 from a server with no ticket route', 404, { kind: 'incompatible', message: "This version of Hermes doesn't work with Highwing." }, 'not-hermes']
  ] as const)('reads a %s as %j, and keeps the sign-in', async (_what, status, failure, verdict) => {
    const web = await webapp('ok')
    const keep = memoryKeep()
    await signedIn(web, { keep })
    const answering: typeof fetch = async (input, init) => (String(input).endsWith('/api/auth/ws-ticket') ? new Response('', { status }) : fetch(input, init))
    const gateways = gatewaysByUrl({ keep, browse: NO_BROWSER, fetch: answering })

    expect(await dialFailure(routeOf(gateways, web.url).dial({ start: false }))).toEqual(failure)
    expect(await check(gateways, web.url).result).toEqual({ ok: false, failure: verdict })
    expect(await keep.load(web.url)).not.toBeNull()
  })

  it('refuses a dial after dispose as dropped', async () => {
    const web = await webapp('ok')
    const route = routeOf(await signedIn(web), web.url)
    route.dispose()
    expect(await dialFailure(route.dial({ start: true }))).toMatchObject({ kind: 'dropped' })
    expect(count(web, 'POST /api/auth/ws-ticket')).toBe(1)
  })
})

describe('keepOnly', () => {
  it('forgets every sign-in but that of the address it is given', async () => {
    const [saved, other] = [await webapp('ok'), await webapp('ok')]
    const keep = memoryKeep()
    const gateways = gatewaysByUrl({ keep, browse: async url => (url.startsWith(`${saved.url}/`) ? saved : other).browse(url) })
    for (const web of [saved, other]) expect(await check(gateways, web.url).result).toEqual({ ok: true })

    await gateways.keepOnly(saved.url)
    expect(await keep.load(other.url)).toBeNull()
    expect(await dialFailure(routeOf(gateways, other.url).dial({ start: false }))).toMatchObject({ kind: 'signed-out' })
    ;(await routeOf(gateways, saved.url).dial({ start: false })).close()

    await gateways.keepOnly(null)
    expect(await keep.load(saved.url)).toBeNull()
    expect(await dialFailure(routeOf(gateways, saved.url).dial({ start: false }))).toMatchObject({ kind: 'signed-out' })
  })

  it('is not undone by a refresh that was in flight', async () => {
    const web = await webapp('ok')
    const keep = memoryKeep()
    let release = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const slowRefresh: typeof fetch = async (input, init) => {
      const response = await fetch(input, init)
      if (String(input).endsWith('/auth/native/refresh')) await held
      return response
    }
    const gateways = await signedIn(web, { keep, fetch: slowRefresh })
    web.lapse()
    const dial = routeOf(gateways, web.url).dial({ start: false })
    await until('the refresh to be asked', () => count(web, 'POST /auth/native/refresh') === 1)

    await gateways.keepOnly(null)
    release()
    ;(await dial).close()
    expect(await keep.load(web.url)).toBeNull()
  })

  it('never rejects, whatever the keeper does', async () => {
    const web = await webapp('ok')
    const failing: Keep = { ...memoryKeep(), keepOnly: async () => { throw new Error('the disk is full') } }
    await expect(gatewaysTo(web, { keep: failing }).keepOnly(null)).resolves.toBeUndefined()
  })
})

describe('a keeper that cannot keep', () => {
  it('leaves the sign-in in memory for this run', async () => {
    const web = await webapp('ok')
    const failing: Keep = { ...memoryKeep(), save: async () => { throw new Error('the keyring is locked') } }
    const gateways = await signedIn(web, { keep: failing })
    ;(await routeOf(gateways, web.url).dial({ start: false })).close()
    expect(await dialFailure(routeOf(gatewaysTo(web, { keep: failing }), web.url).dial({ start: false }))).toMatchObject({ kind: 'signed-out' })
  })
})

describe('the credential', () => {
  it('prints as dots wherever it is written out', () => {
    const credential = new Credential('an-access-token', 'a-refresh-token', 'basic')
    const printed = [String(credential), `${credential}`, JSON.stringify({ credential }), inspect(credential), inspect({ held: [credential] }, { depth: null })]
    expect(printed).toEqual(['•••', '•••', '{"credential":"•••"}', '•••', '{ held: [ ••• ] }'])
  })
})
