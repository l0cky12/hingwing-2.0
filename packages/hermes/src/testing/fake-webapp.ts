/**
 * A Hermes gateway to reach by its address: the Webapp's HTTP routes in front of a `loopback()`
 * scripted gateway, on its port. It keeps the rules of Hermes's own routes
 * (hermes_cli/dashboard_auth/routes.py and native_flow.py), so a client that breaks one fails here
 * as it would there:
 * - `/auth/native/authorize` takes S256 only, and a redirect that is http to a loopback IP literal;
 * - a code works once, for 120 s, and only with the verifier of its challenge;
 * - a refresh token works once: each refresh returns a new pair and ends the old one;
 * - `/api/auth/ws-ticket` and the kanban board answer 401 without the bearer of a live sign-in;
 * - the socket is behind the loopback gate: one single-use ticket, no `Origin`.
 * It has no sign-in page. Its user is `browse`, which follows the authorize address as the browser
 * of a user who signs in at once.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { BOARD_PATH } from '../domain/tasks'
import { parseGatewayUrl, type GatewayUrl, type UrlFailure } from '../domain/reach'
import { TICKET_PREFIX, type Clock } from '../wire/link'
import type { Front, Loopback } from './loopback'

/** A provider is listed whether or not it has a sign-in page. Only `auth_flows` says an app can sign in. */
const GATED = {
  version: '0.23.3', release_date: '2026.9.24', gateway_running: true, gateway_state: 'running', overall: 'ok',
  components: { gateway: { status: 'ok', state: 'running' } },
  auth_required: true, auth_providers: ['basic', 'plugin-with-no-page']
}
/** What the gateway's Webapp answers a signed-out caller: nine keys (hermes_cli/web_routers/status.py:533-535). */
const SIGNED_OUT = { ...GATED, auth_flows: ['cookie', 'native_pkce'] }
/** What the standalone dashboard adds for every caller, and an ungated listener too (status.py:608-672). */
const FULL = { ...SIGNED_OUT, config_version: 12, latest_config_version: 12, gateway_mode: 'single', active_sessions: 0 }

const STATUS = {
  webapp: SIGNED_OUT,
  dashboard: FULL,
  /** A Webapp bound to loopback with no `webapp.public_url` has no sign-in gate, and offers no flow (status.py:425-428). */
  ungated: { ...FULL, auth_required: false, auth_flows: [] },
  'cookie-only': { ...GATED, auth_flows: ['cookie'] },
  old: GATED,
  html: null
} as const

interface Scenario {
  readonly listener: 'http' | 'closed' | 'self-signed'
  readonly status: keyof typeof STATUS
  readonly user: 'signs-in' | 'leaves-the-page-open'
  readonly token: 'gives' | 'refuses'
  readonly upgrades: Front['upgrades']
  readonly verdict: UrlFailure | 'hermes-too-old' | null
}

const OK = { listener: 'http', status: 'webapp', user: 'signs-in', token: 'gives', upgrades: 'gateway', verdict: null } as const

export const WEBAPP_SCENARIOS: Readonly<Record<UrlFailure | 'ok' | 'too-old' | 'ungated', Scenario>> = {
  ok: OK,
  'too-old': { ...OK, status: 'old', verdict: 'hermes-too-old' },
  ungated: { ...OK, status: 'ungated', verdict: 'no-sign-in' },
  'url-unreachable': { ...OK, listener: 'closed', verdict: 'url-unreachable' },
  'url-certificate': { ...OK, listener: 'self-signed', verdict: 'url-certificate' },
  'not-hermes': { ...OK, status: 'html', verdict: 'not-hermes' },
  'no-sign-in': { ...OK, status: 'cookie-only', verdict: 'no-sign-in' },
  dashboard: { ...OK, status: 'dashboard', verdict: 'dashboard' },
  'sign-in-cancelled': { ...OK, user: 'leaves-the-page-open', verdict: 'sign-in-cancelled' },
  'sign-in-timed-out': { ...OK, user: 'leaves-the-page-open', verdict: 'sign-in-timed-out' },
  'sign-in-refused': { ...OK, token: 'refuses', verdict: 'sign-in-refused' },
  'url-no-socket': { ...OK, upgrades: 'refused', verdict: 'url-no-socket' },
  'url-legacy': { ...OK, upgrades: 'legacy', verdict: 'url-legacy' }
}

export type WebappScenarioName = keyof typeof WEBAPP_SCENARIOS

export interface FakeWebapp {
  readonly url: GatewayUrl
  readonly browse: (url: string) => Promise<void>
  readonly opened: readonly string[]
  readonly pages: readonly string[]
  readonly secrets: readonly string[]
  readonly requests: readonly string[]
  lapse(): void
  signOut(): void
  close(): Promise<void>
}

/** Hermes's hermes_cli/dashboard_auth/native_flow.py:28-29 */
const PENDING_MS = 600_000
const CODE_MS = 120_000
const ACCESS_S = 900
/** RFC 8252 loopback IP literals, as `URL` spells them (routes.py:257). */
const LOOPBACK_IPS: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]'])

interface Asked {
  readonly query: URLSearchParams
  readonly bearer: string | null
  readonly body: Readonly<Record<string, unknown>>
}

type Reply =
  | { readonly status: number; readonly json: unknown }
  | { readonly status: 200; readonly html: string }
  | { readonly status: 302; readonly location: string }

const refused = (status: number, detail: string): Reply => ({ status, json: { detail } })
const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

async function bodyOf(request: IncomingMessage): Promise<Asked['body']> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString())
    return body !== null && typeof body === 'object' ? body as Asked['body'] : {}
  } catch {
    return {}
  }
}

const der = (tag: number, ...parts: readonly Buffer[]): Buffer => {
  const body = Buffer.concat(parts)
  const length = body.length < 128 ? [body.length] : body.length < 256 ? [0x81, body.length] : [0x82, body.length >> 8, body.length & 255]
  return Buffer.concat([Buffer.from([tag, ...length]), body])
}

/** Signed with ECDSA on P-256. Electron's TLS offers no Ed25519, so there such a certificate fails the handshake before trust is ever judged. */
function selfSigned(): { readonly key: string; readonly cert: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const ecdsaWithSha256 = der(0x30, der(0x06, Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])))
  const name = der(0x30, der(0x31, der(0x30, der(0x06, Buffer.from([0x55, 0x04, 0x03])), der(0x0c, Buffer.from('fake-webapp')))))
  const validity = der(0x30, der(0x17, Buffer.from('250101000000Z')), der(0x17, Buffer.from('450101000000Z')))
  const body = der(0x30, der(0x02, Buffer.from([1])), ecdsaWithSha256, name, validity, name, publicKey.export({ type: 'spki', format: 'der' }))
  const cert = der(0x30, body, ecdsaWithSha256, der(0x03, Buffer.from([0]), sign('sha256', body, privateKey)))
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: `-----BEGIN CERTIFICATE-----\n${cert.toString('base64')}\n-----END CERTIFICATE-----\n`
  }
}

async function untrusted(): Promise<{ readonly port: number; close(): Promise<void> }> {
  const server = createServer(selfSigned(), (_request, response) => void response.writeHead(404).end())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise(resolve => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  }
}

export async function fakeWebapp(
  name: WebappScenarioName,
  gateway: Loopback,
  clock: Clock,
  options: { readonly prefix?: string } = {}
): Promise<FakeWebapp> {
  const scenario = WEBAPP_SCENARIOS[name]
  const prefix = options.prefix ?? ''
  const secrets: string[] = []
  const requests: string[] = []
  const opened: string[] = []
  const pages: string[] = []
  const pending = new Map<string, { readonly challenge: string; readonly redirect: string; readonly state: string; readonly expires: number }>()
  const codes = new Map<string, { readonly challenge: string; readonly expires: number }>()
  const signIns = new Map<string, string | null>()
  const signedInBy = (bearer: string | null) => bearer !== null && [...signIns.values()].includes(bearer)

  const secret = (): string => {
    const made = randomBytes(32).toString('base64url')
    secrets.push(made)
    return made
  }

  const signedIn = (): Reply => {
    const [access, refresh] = [secret(), secret()]
    signIns.set(refresh, access)
    return {
      status: 200,
      json: { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_at: Math.floor(clock.now() / 1000) + ACCESS_S, provider: 'basic', user_id: 'ada' }
    }
  }

  const routes: Readonly<Record<string, (asked: Asked) => Reply>> = {
    'GET /api/status': () => {
      const status = STATUS[scenario.status]
      return status === null ? { status: 200, html: '<!doctype html><title>Welcome</title>' } : { status: 200, json: status }
    },
    'GET /auth/native/authorize': ({ query }) => {
      const challenge = query.get('code_challenge') ?? ''
      const redirect = URL.parse(query.get('redirect_uri') ?? '')
      if ((query.get('code_challenge_method') ?? '').toUpperCase() !== 'S256') return refused(400, 'code_challenge_method must be S256')
      if (challenge === '') return refused(400, 'code_challenge required')
      if (redirect === null || redirect.protocol !== 'http:' || !LOOPBACK_IPS.has(redirect.hostname) || redirect.username !== '' || redirect.hash !== '') {
        return refused(400, 'native redirect_uri must be http:// on the loopback interface')
      }
      const broker = secret()
      pending.set(broker, { challenge, redirect: redirect.href, state: query.get('state') ?? '', expires: clock.now() + PENDING_MS })
      return { status: 302, location: `${prefix}/login?broker=${broker}` }
    },
    /** Hermes shows its password form here. This user is signed in at once and sent on to the app. */
    'GET /login': ({ query }) => {
      const broker = query.get('broker') ?? ''
      const held = pending.get(broker)
      pending.delete(broker)
      if (held === undefined || held.expires < clock.now()) return refused(400, 'This sign-in has expired.')
      const code = secret()
      codes.set(code, { challenge: held.challenge, expires: clock.now() + CODE_MS })
      const back = new URL(held.redirect)
      back.searchParams.set('code', code)
      back.searchParams.set('state', held.state)
      return { status: 302, location: back.href }
    },
    'POST /auth/native/token': ({ body }) => {
      const code = String(body.code ?? '')
      const issued = codes.get(code)
      codes.delete(code)
      const good = issued !== undefined && issued.expires >= clock.now() && issued.challenge === s256(String(body.code_verifier ?? ''))
      return good && scenario.token === 'gives' ? signedIn() : refused(400, 'Invalid or expired authorization code.')
    },
    'POST /auth/native/refresh': ({ body }) => {
      if (!signIns.delete(String(body.refresh_token ?? ''))) {
        return { status: 401, json: { error: 'session_expired', detail: 'Refresh token expired or invalid; start a new sign-in.' } }
      }
      return signedIn()
    },
    'POST /api/auth/ws-ticket': ({ bearer }) => {
      if (bearer === null || ![...signIns.values()].includes(bearer)) {
        return { status: 401, json: { error: 'unauthenticated', detail: 'Unauthorized', reason: 'no_cookie', login_url: '/login' } }
      }
      const ticket = (gateway.mint('host').protocols[1] as string).slice(TICKET_PREFIX.length)
      secrets.push(ticket)
      return { status: 200, json: { ticket, ttl_seconds: 30 } }
    },
    /** Hermes's speech upload (hermes_cli/web_routers/audio.py:89-150). This Hermes hears how many bytes it was sent. */
    'POST /api/audio/transcribe': ({ bearer, body }) => {
      if (bearer === null || ![...signIns.values()].includes(bearer)) return refused(401, 'Unauthorized')
      const audio = /^data:audio\/[^,]*;base64,(.+)$/.exec(String(body.data_url ?? ''))?.[1]
      return audio === undefined ? refused(400, 'Invalid audio payload') : { status: 200, json: { ok: true, transcript: `heard ${Buffer.from(audio, 'base64').byteLength} bytes`, provider: 'fake' } }
    },
    /** A routine's write routes (hermes_cli/web_routers/cron.py). This Hermes answers what it was sent, so a test reads the request off the reply. */
    'PUT /api/cron/jobs/a1': ({ bearer, query, body }) => (signedInBy(bearer) ? { status: 200, json: { id: 'a1', profile: query.get('profile'), received: body } } : refused(401, 'Unauthorized')),
    'POST /api/cron/jobs/a1/trigger': ({ bearer, query }) => (signedInBy(bearer) ? { status: 200, json: { id: 'a1', profile: query.get('profile'), last_status: 'ok' } } : refused(401, 'Unauthorized')),
    [`GET ${BOARD_PATH}`]: ({ bearer }) =>
      bearer !== null && [...signIns.values()].includes(bearer)
        ? { status: 200, json: { columns: [{ name: 'todo', tasks: [] }] } }
        : { status: 401, json: { error: 'unauthenticated', detail: 'Unauthorized' } }
  }

  const serve = async (request: IncomingMessage, response: ServerResponse) => {
    const { pathname, searchParams } = new URL(request.url ?? '/', 'http://fake-webapp')
    requests.push(`${request.method} ${pathname}`)
    const route = pathname.startsWith(`${prefix}/`) ? routes[`${request.method} ${pathname.slice(prefix.length)}`] : undefined
    const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? null
    const reply = route === undefined ? refused(404, 'Not Found') : route({ query: searchParams, bearer, body: await bodyOf(request) })
    if ('location' in reply) return void response.writeHead(reply.status, { location: reply.location }).end()
    if ('html' in reply) return void response.writeHead(reply.status, { 'content-type': 'text/html; charset=utf-8' }).end(reply.html)
    response.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.json))
  }
  gateway.front({ prefix, upgrades: scenario.upgrades, serve: (request, response) => void serve(request, response) })

  const https = scenario.listener === 'self-signed' ? await untrusted() : null
  const address = {
    http: `http://127.0.0.1:${gateway.port}${prefix}`,
    closed: 'http://127.0.0.1:1',
    'self-signed': `https://127.0.0.1:${https?.port}`
  }[scenario.listener]
  const parsed = parseGatewayUrl(address)
  if (!parsed.ok) throw new Error(`${address} is ${parsed.problem}`)

  return {
    url: parsed.url,
    opened,
    pages,
    secrets,
    requests,
    browse: async url => {
      opened.push(url)
      if (scenario.user === 'signs-in') void fetch(url).then(page => page.text()).then(text => void pages.push(text), () => {})
    },
    lapse: () => {
      for (const refresh of signIns.keys()) signIns.set(refresh, null)
    },
    signOut: () => signIns.clear(),
    close: async () => https?.close()
  }
}
