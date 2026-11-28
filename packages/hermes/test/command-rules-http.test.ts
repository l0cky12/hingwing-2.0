import { request, type IncomingHttpHeaders } from 'node:http'
import { describe, expect, it } from 'vitest'
import { RULES_PATH } from '../src/domain/rules'
import { gatewaysByUrl, liveRoute, memoryKeep, remoteRoute, TicketRefused, type CallHermes, type Route } from '../src/hub'
import { FAKE_HOST, type FakeHost } from '../src/testing/fake-host'
import type { Loopback } from '../src/testing/loopback'
import { closing, errandGateway, host, listen, PATIENT_TEST_MS } from './support/host'
import { webapp } from './support/webapp'

const RULES = { allow: ['delete in root path'], deny: ['rm -rf /*'] }
type Config = { readonly command_allowlist: readonly string[]; readonly approvals: { readonly mode: string; readonly deny: readonly string[] } }

const get = (call: CallHermes, profile: string | null = null) => call({ method: 'GET', path: RULES_PATH, profile })
const put = (call: CallHermes, config: Record<string, unknown>, profile: string | null = null) => call({ method: 'PUT', path: RULES_PATH, profile, json: { config } })

/** One request to the listener with a ticket of its own making, as a client would send it, and what the listener answered. */
function sent(gateway: Loopback, ticket: string, { path = RULES_PATH, method = 'GET', headers = {} }: { path?: string; method?: string; headers?: IncomingHttpHeaders } = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const asked = request(new URL(path, gateway.http.origin), { method, headers: { 'x-hermes-gateway-ticket': ticket, ...headers } }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode ?? 0))
    })
    asked.on('error', reject)
    asked.end()
  })
}

describe('the listener of the loopback gateway', () => {
  it('lets a native-http ticket in once, and answers 401 to a ticket used before, one nobody minted, and one that comes with an Origin', async () => {
    const gateway = await listen(errandGateway(RULES))
    expect(await sent(gateway, gateway.http.mint(null))).toBe(200)
    const spent = gateway.http.mint(null)
    await sent(gateway, spent)
    expect(await sent(gateway, spent)).toBe(401)
    expect(await sent(gateway, 'invented')).toBe(401)
    expect(await sent(gateway, gateway.http.mint(null), { headers: { origin: 'http://127.0.0.1' } })).toBe(401)
  })

  it("answers 403 to a request that names a profile other than the ticket's own, and lets the launch profile's ticket name that profile", async () => {
    const gateway = await listen(errandGateway(RULES))
    expect(await sent(gateway, gateway.http.mint('ada'), { path: `${RULES_PATH}?profile=ada` })).toBe(200)
    expect(await sent(gateway, gateway.http.mint('ada'), { path: `${RULES_PATH}?profile=grace` })).toBe(403)
    expect(await sent(gateway, gateway.http.mint(null), { path: `${RULES_PATH}?profile=ada` }), 'a ticket of the launch profile is not for another bot').toBe(403)
    expect(await sent(gateway, gateway.http.mint(null), { path: `${RULES_PATH}?profile=default` })).toBe(200)
  })

  it('answers 404 for a path it does not serve, and for /api/config when the gateway holds no rules', async () => {
    const gateway = await listen(errandGateway(RULES))
    expect(await sent(gateway, gateway.http.mint(null), { path: '/api/status' })).toBe(404)
    const bare = await listen(errandGateway())
    expect(await sent(bare, bare.http.mint(null))).toBe(404)
  })
})

const ticketRoutes: readonly (readonly [string, (gateway: Loopback) => Promise<Route>])[] = [
  ['the Hermes on this computer', async gateway => {
    const here = await host('ok', gateway)
    return closing(liveRoute({ hermesBin: here.hermes }), route => route.dispose())
  }],
  ['a Hermes on another machine, through ssh', async gateway => {
    const far: FakeHost = await host('ok', gateway)
    return closing(remoteRoute(FAKE_HOST, { sshBin: far.ssh }), route => route.dispose())
  }]
]

describe.each(ticketRoutes)('the command rules over %s', (_, routeTo) => {
  it('reads the rules, replaces one list, and leaves the other list and approvals.mode as they were', { timeout: PATIENT_TEST_MS }, async () => {
    const gateway = await listen(errandGateway(RULES))
    const { call } = await routeTo(gateway)
    expect((await get(call)).body).toMatchObject({ command_allowlist: ['delete in root path'], approvals: { mode: 'manual', deny: ['rm -rf /*'] } })
    const before = gateway.rules?.stamp(null) ?? 0
    expect(await put(call, { approvals: { deny: ['rm -rf /*', 'git push --force*'] } })).toEqual({ status: 200, body: { ok: true } })
    expect((await get(call)).body).toMatchObject({ command_allowlist: ['delete in root path'], approvals: { mode: 'manual', deny: ['rm -rf /*', 'git push --force*'] } })
    expect(gateway.rules?.stamp(null), 'the token the socket answers changed with the save').toBeGreaterThan(before)
  })

  it("reads and writes the bot's own config on a ticket bound to it, and never the launch profile's", { timeout: PATIENT_TEST_MS }, async () => {
    const gateway = await listen(errandGateway(RULES))
    const { call } = await routeTo(gateway)
    await put(call, { command_allowlist: ['podman *'] }, 'ada')
    expect((await get(call, 'ada')).body).toMatchObject({ command_allowlist: ['podman *'] })
    expect((await get(call)).body, "the launch profile's list did not change").toMatchObject({ command_allowlist: ['delete in root path'] })
    expect((gateway.rules?.config('ada') as unknown as Config).command_allowlist).toEqual(['podman *'])
  })

  it('answers 404 for a Hermes with no /api/config', { timeout: PATIENT_TEST_MS }, async () => {
    const { call } = await routeTo(await listen(errandGateway()))
    expect(await get(call)).toEqual({ status: 404, body: { detail: 'Not Found' } })
  })

  it('rejects with the ticket refusal when the gateway mints no HTTP ticket', { timeout: PATIENT_TEST_MS }, async () => {
    const gateway = await listen(errandGateway(RULES))
    const far = await host('ok', { mint: gateway.mint, instanceId: gateway.instanceId })
    const route = closing(liveRoute({ hermesBin: far.hermes }), held => held.dispose())
    const error = await get(route.call).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(TicketRefused)
    expect(error).toMatchObject({ code: 'ticket_unavailable' })
  })
})

describe('the command rules over the address of a Webapp', () => {
  async function signedIn() {
    const gateway = await listen(errandGateway(RULES))
    const web = await webapp('ok', { gateway })
    const gateways = gatewaysByUrl({ keep: memoryKeep(), browse: web.browse })
    expect(await gateways.check(web.url, { signal: new AbortController().signal, onStep: () => {} })).toEqual({ ok: true })
    return { gateway, web, route: closing(gateways.route(web.url), route => route.dispose()) }
  }

  it("sends the bearer, names the bot in a GET's query and in a PUT's body, and sees the save in the next read", async () => {
    const { gateway, web, route } = await signedIn()
    expect(await put(route.call, { command_allowlist: ['podman *'] }, 'ada')).toEqual({ status: 200, body: { ok: true } })
    expect((await get(route.call, 'ada')).body).toMatchObject({ command_allowlist: ['podman *'] })
    expect((await get(route.call)).body).toMatchObject({ command_allowlist: ['delete in root path'] })
    expect(web.requests.filter(line => line.endsWith(RULES_PATH))).toEqual([`PUT ${RULES_PATH}`, `GET ${RULES_PATH}`, `GET ${RULES_PATH}`])
    expect(gateway.rules?.stamp('ada')).toBeGreaterThan(gateway.rules?.stamp('grace') as number)
  })

  it('refreshes the sign-in once when Hermes no longer takes the bearer, and says the sign-in ended once it is gone', async () => {
    const { web, route } = await signedIn()
    web.lapse()
    expect(await get(route.call)).toMatchObject({ status: 200 })
    web.signOut()
    await expect(get(route.call)).rejects.toMatchObject({ kind: 'signed-out' })
  })

  it('answers 404 when the Hermes holds no rules', async () => {
    const web = await webapp('ok')
    const gateways = gatewaysByUrl({ keep: memoryKeep(), browse: web.browse })
    await gateways.check(web.url, { signal: new AbortController().signal, onStep: () => {} })
    const route = closing(gateways.route(web.url), held => held.dispose())
    expect(await get(route.call)).toEqual({ status: 404, body: { detail: 'Not Found' } })
  })
})
