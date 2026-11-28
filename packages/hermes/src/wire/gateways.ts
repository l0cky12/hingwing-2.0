/**
 * Everything Highwing knows about a Hermes gateway reached by its address. The gateway's Webapp
 * listener (Hermes's gateway/webapp_listener.py) is the only door: a public status, a sign-in in
 * the user's own browser (RFC 8252 with PKCE, hermes_cli/dashboard_auth/routes.py:307-355), a
 * bearer that mints one-use socket tickets (routes.py:583-595), and `/api/ws` with the ticket as a
 * subprotocol.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { inspect } from 'node:util'
import { gatewayHost, URL_FAILURES, type GatewayUrl, type UrlFailure } from '../domain/reach'
import type { CheckOptions } from './check'
import { DialError, dialWith, GATEWAY_PROTOCOL, HANDSHAKE_MS, profiled, sessionAuthorityOf, systemClock, TICKET_PREFIX, type CallHermes, type Clock, type HermesAsk, type Endpoint, type Mint } from './link'
import type { Route } from './remote'
import { CANT_REACH, TRANSCRIBE_MS, TRANSCRIBE_PATH, transcribeBody, transcriptOf, type Transcribe } from './transcribe'

/**
 * Where a sign-in is kept between runs, one per gateway address. `secret` is text this module wrote
 * and will read back. A keeper encrypts it before it reaches a disk, or holds it in memory, and
 * never logs it or sends it anywhere.
 */
export interface Keep {
  /** false: a sign-in lasts for this run only, because this computer has nowhere safe to write one. */
  readonly durable: boolean
  /** null: none is kept for the address, or what was kept can no longer be read. */
  load(url: GatewayUrl): Promise<string | null>
  /** Keeps `secret` for the address in place of what it held. null: keeps nothing for it. */
  save(url: GatewayUrl, secret: string | null): Promise<void>
  /** Forgets every address but those of `urls`. */
  keepOnly(urls: readonly GatewayUrl[]): Promise<void>
}

/** A keeper that writes nothing. For tests, and for a computer with no keyring. */
export function memoryKeep(): Keep {
  const kept = new Map<GatewayUrl, string>()
  return {
    durable: false,
    load: async url => kept.get(url) ?? null,
    save: async (url, secret) => void (secret === null ? kept.delete(url) : kept.set(url, secret)),
    keepOnly: async urls => {
      for (const held of [...kept.keys()]) if (!urls.includes(held)) kept.delete(held)
    }
  }
}

export interface GatewayDeps {
  readonly keep: Keep
  /** Opens a page in the user's own browser. Highwing shows no sign-in page itself, so it never sees a password. */
  readonly browse: (url: string) => Promise<void>
  /** How long a check waits for the user to sign in. Default 10 minutes, the life of Hermes's pending sign-in (native_flow.py:28). */
  readonly signInMs?: number
  readonly clock?: Clock
  readonly fetch?: typeof fetch
}

export type UrlCheckResult = { readonly ok: true } | { readonly ok: false; readonly failure: UrlFailure | 'hermes-too-old' }

export interface Gateways {
  /**
   * Whether Highwing can chat through the gateway at `url`, one step at a time, stopping at the
   * first that fails. `hermes` reads the status. `sign-in` uses the sign-in kept for the address
   * when Hermes still takes it, and otherwise opens the browser and waits. `gateway` opens one
   * socket and waits for the gateway to say it owns its sessions. A sign-in this check made is
   * forgotten again when `gateway` fails. An aborted check ends as `sign-in-cancelled` while it
   * waits for the browser. Aborted at another step, its result means nothing.
   */
  check(url: GatewayUrl, options: Pick<CheckOptions, 'signal' | 'onStep'>): Promise<UrlCheckResult>
  /**
   * The way to chat through the gateway at `url`. Each dial mints a ticket with the address's
   * sign-in and never opens a browser. It fails as `signed-out` when no sign-in is held or Hermes
   * ended it, and as `unreachable` when nothing answers. `start` is ignored, because nothing can be
   * started over HTTP, so no dial fails as `not-running`.
   */
  route(url: GatewayUrl): Route
  /** Forgets every sign-in but those of `urls`. Never rejects. */
  keepOnly(urls: readonly GatewayUrl[]): Promise<void>
}

const SIGN_IN_MS = 600_000
const REQUEST_MS = 10_000
const HIDDEN = '•••'

type Obj = Readonly<Record<string, unknown>>
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export class Credential {
  constructor(
    readonly access: string | null,
    readonly refresh: string,
    /** The Hermes provider that signed the user in. A refresh names it, so Hermes asks that provider first (request_utils.py:146-148). */
    readonly provider: string
  ) {}

  toString(): string {
    return HIDDEN
  }

  toJSON(): string {
    return HIDDEN
  }

  [inspect.custom](): string {
    return HIDDEN
  }
}

function credentialOf(reply: unknown): Credential | null {
  if (!isObject(reply)) return null
  const { access_token: access, refresh_token: refresh, provider } = reply
  return isText(access) && isText(refresh) ? new Credential(access, refresh, typeof provider === 'string' ? provider : '') : null
}

const keptOf = ({ refresh, provider }: Credential): string => JSON.stringify({ refresh, provider })

function fromKept(secret: string | null): Credential | null {
  const kept = secret === null ? null : jsonOf(secret)
  return isObject(kept) && isText(kept.refresh) && typeof kept.provider === 'string' ? new Credential(null, kept.refresh, kept.provider) : null
}

interface Asked {
  readonly json?: unknown
  readonly bearer?: string
  readonly signal?: AbortSignal
  /** How long the request may take. Default `REQUEST_MS`. */
  readonly ms?: number
}

interface Answer {
  readonly status: number
  readonly body: unknown
}

/**
 * What the status says about the address. null: the gateway's Webapp, with a sign-in an app can use.
 * A gated dashboard answers a signed-out caller with keys the gated Webapp never sends
 * (hermes_cli/web_routers/status.py:533-535). An ungated listener sends every caller the full body
 * (status.py:662-672), so there those keys tell nothing, and its empty `auth_flows` decides.
 * `auth_providers` is not read: it lists a provider whether or not it has a sign-in page.
 */
function statusVerdict({ status, body }: Answer): UrlFailure | 'hermes-too-old' | null {
  if (status !== 200 || !isObject(body) || typeof body.version !== 'string' || typeof body.gateway_running !== 'boolean') return 'not-hermes'
  if (body.auth_required === true && ('config_version' in body || 'gateway_mode' in body)) return 'dashboard'
  if (!Array.isArray(body.auth_flows)) return 'hermes-too-old'
  return body.auth_flows.includes('native_pkce') ? null : 'no-sign-in'
}

/** Node's codes for a certificate it does not trust, such as DEPTH_ZERO_SELF_SIGNED_CERT, UNABLE_TO_VERIFY_LEAF_SIGNATURE and CERT_HAS_EXPIRED. */
const UNTRUSTED = /CERT|UNABLE_TO_VERIFY/

function reachFailure(error: unknown): 'url-unreachable' | 'url-certificate' {
  for (let at = error; at instanceof Error; at = at.cause) {
    const { code } = at as { readonly code?: unknown }
    if (typeof code === 'string' && UNTRUSTED.test(code)) return 'url-certificate'
  }
  return 'url-unreachable'
}

class Failed extends Error {
  constructor(readonly failure: UrlFailure | 'hermes-too-old') {
    super(failure)
  }
}

const CHECK_KINDS: Readonly<Partial<Record<DialError['kind'], UrlFailure>>> = { unreachable: 'url-unreachable', 'signed-out': 'sign-in-refused' }

const cantReach = (url: GatewayUrl) => new DialError('unreachable', URL_FAILURES['url-unreachable'].words(gatewayHost(url)))
const ended = (url: GatewayUrl) => new DialError('signed-out', `Your sign-in to the Hermes on ${gatewayHost(url)} has ended.`)
const noKeyring = (url: GatewayUrl) =>
  new DialError('signed-out', `Sign in to the Hermes on ${gatewayHost(url)}. This computer has no keyring, so Highwing asks each time it starts.`)

const page = (words: string) => `<!doctype html><meta charset="utf-8"><title>Highwing</title><p>${words}</p>`
const SIGNED_IN = page("You're signed in to Hermes. You can close this tab and go back to Highwing.")
const NOT_SIGNED_IN = page("Highwing couldn't finish this sign-in. Go back to Highwing and press Connect to try again.")

interface Login {
  bearer(): Promise<string>
  replaceRefused(bearer: string): Promise<void>
  take(credential: Credential): Promise<void>
  forget(): Promise<void>
}

/** One per process. Its sign-ins, one per address, are what a check and a route share. */
/**
 * The routes that resolve `?profile=` through the dashboard's profile scope, which over a web address reads `current` as
 * the profile Hermes runs as (hermes_cli/web_server_profiles.py), yet `current` is a valid profile name. A read for a bot
 * named `current` there would answer with another bot's data. The cron routes look the name up as it is, and a ticket
 * read is bound by the ticket's own profile, so neither has the doubt.
 */
const SCOPED_ROUTES = ['/api/learning/', '/api/config']
const namesCurrent = ({ path, profile }: HermesAsk): boolean => {
  const url = new URL(path, 'http://hermes.invalid')
  const names = profile === null ? url.searchParams.getAll('profile') : [profile, ...url.searchParams.getAll('profile')]
  return SCOPED_ROUTES.some(route => url.pathname.startsWith(route)) && names.some(name => name.trim().toLowerCase() === 'current')
}
const CURRENT_IS_OWN = 'Over a web address, Hermes reads a bot named current as the bot it runs as.'

export function gatewaysByUrl(deps: GatewayDeps): Gateways {
  const clock = deps.clock ?? systemClock
  const fetcher = deps.fetch ?? fetch
  const signInMs = deps.signInMs ?? SIGN_IN_MS

  const send = async (method: 'GET' | 'POST' | 'PUT', address: string, asked: Asked): Promise<Answer> => {
    const deadline = AbortSignal.timeout(asked.ms ?? REQUEST_MS)
    const response = await fetcher(address, {
      method,
      // Never followed, so a bearer goes only to the address the user gave.
      redirect: 'manual',
      signal: asked.signal === undefined ? deadline : AbortSignal.any([asked.signal, deadline]),
      headers: {
        accept: 'application/json',
        ...(asked.json === undefined ? {} : { 'content-type': 'application/json' }),
        ...(asked.bearer === undefined ? {} : { authorization: `Bearer ${asked.bearer}` })
      },
      ...(asked.json === undefined ? {} : { body: JSON.stringify(asked.json) })
    })
    return { status: response.status, body: jsonOf(await response.text()) }
  }

  const answered = async (url: GatewayUrl, path: string, asked: Asked): Promise<Obj | 'refused'> => {
    const { status, body } = await send('POST', `${url}${path}`, asked).catch(() => { throw cantReach(url) })
    if (status === 401) return 'refused'
    if (status >= 500) throw cantReach(url)
    if (status !== 200 || !isObject(body)) throw new DialError('incompatible')
    return body
  }

  const within = async <T extends boolean | object>(ms: number, signal: AbortSignal, wait: Promise<T>): Promise<T | 'aborted' | 'timed-out'> => {
    let stop = () => {}
    const cut = new Promise<'aborted' | 'timed-out'>(resolve => {
      const aborted = () => resolve('aborted')
      const cancel = clock.setTimeout(() => resolve('timed-out'), ms)
      signal.addEventListener('abort', aborted)
      if (signal.aborted) aborted()
      stop = () => {
        cancel()
        signal.removeEventListener('abort', aborted)
      }
    })
    try {
      return await Promise.race([wait, cut])
    } finally {
      stop()
    }
  }

  const logins = new Map<GatewayUrl, Login>()

  const login = (url: GatewayUrl): Login => {
    let held: Credential | null = null
    let loaded: Promise<void> | null = null
    let renewing: Promise<void> | null = null

    const load = () => (loaded ??= deps.keep.load(url).then(secret => { held = fromKept(secret) }, () => {}))

    const stillHeld = () => logins.get(url) === self

    const hold = async (next: Credential | null) => {
      await load()
      held = next
      if (stillHeld()) await deps.keep.save(url, next === null ? null : keptOf(next)).catch(() => {})
    }

    /**
     * No caller's signal reaches this request. Hermes ends the old refresh token as it answers, so
     * a request cut short after that would lose the sign-in.
     */
    const renew = async (from: Credential) => {
      const reply = await answered(url, '/auth/native/refresh', { json: { refresh_token: from.refresh, provider: from.provider } })
      if (reply === 'refused') {
        await hold(null)
        throw ended(url)
      }
      const next = credentialOf(reply)
      if (next === null) throw new DialError('incompatible')
      await hold(next)
    }

    const refresh = (from: Credential) => (renewing ??= renew(from).finally(() => { renewing = null }))

    const bearer = async (): Promise<string> => {
      await load()
      if (held === null) throw deps.keep.durable ? ended(url) : noKeyring(url)
      if (held.access !== null) return held.access
      await refresh(held)
      return bearer()
    }

    const self: Login = {
      bearer,
      replaceRefused: async refusedBearer => {
        if (held !== null && held.access === refusedBearer) await refresh(held)
      },
      take: hold,
      forget: () => hold(null)
    }
    return self
  }

  const loginOf = (url: GatewayUrl): Login => {
    const held = logins.get(url) ?? login(url)
    logins.set(url, held)
    return held
  }

  const mint = async (url: GatewayUrl, signal: AbortSignal): Promise<Endpoint> => {
    const held = loginOf(url)
    const ticketWith = (bearer: string) => answered(url, '/api/auth/ws-ticket', { bearer, signal })
    const bearer = await held.bearer()
    let reply = await ticketWith(bearer)
    if (reply === 'refused') {
      await held.replaceRefused(bearer)
      reply = await ticketWith(await held.bearer())
    }
    if (reply === 'refused') {
      await held.forget()
      throw ended(url)
    }
    if (!isText(reply.ticket)) throw new DialError('incompatible')
    // The Webapp's gate authorizes the whole host, so its socket reaches every profile (hermes_cli/web_routers/chat_ws.py:674-677).
    return { url: `${url.replace(/^http/, 'ws')}/api/ws`, protocols: [GATEWAY_PROTOCOL, TICKET_PREFIX + reply.ticket], reach: 'host' }
  }

  /** The upload goes with the address's sign-in, which Hermes's gate takes on any route (dashboard_auth/middleware.py:299-305). */
  const transcribeAt = (url: GatewayUrl): Transcribe => async (recording, signal) => {
    const held = loginOf(url)
    const post = async (bearer: string) =>
      send('POST', `${url}${TRANSCRIBE_PATH}`, { json: transcribeBody(recording), bearer, ms: TRANSCRIBE_MS, ...(signal === undefined ? {} : { signal }) })
    try {
      const bearer = await held.bearer()
      let answer = await post(bearer)
      if (answer.status === 401) {
        await held.replaceRefused(bearer)
        answer = await post(await held.bearer())
      }
      if (answer.status === 401) throw ended(url)
      return transcriptOf(answer.status, answer.body)
    } catch (error) {
      return error instanceof DialError && error.kind === 'signed-out' ? { ok: false, refusal: { kind: 'offline', message: error.message } } : CANT_REACH
    }
  }

  const signIn = async (url: GatewayUrl, signal: AbortSignal): Promise<Credential> => {
    const server = createServer()
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
    // Hermes takes a loopback IP literal and never `localhost` (routes.py:257-289).
    const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`
    const verifier = randomBytes(32).toString('base64url')
    const state = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const authorize = `${url}/auth/native/authorize?${new URLSearchParams({ code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: redirect, state })}`
    try {
      const back = await within(signInMs, signal, new Promise<{ readonly code: string }>((resolve, reject) => {
        const refuse = () => reject(new Failed('sign-in-refused'))
        server.on('request', (request, response) => {
          const asked = URL.parse(request.url ?? '/', redirect)
          if (asked?.pathname !== '/callback') return void response.writeHead(404, { connection: 'close' }).end()
          const code = asked.searchParams.get('code') ?? ''
          const good = code !== '' && asked.searchParams.get('state') === state
          response.writeHead(good ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', connection: 'close' }).end(good ? SIGNED_IN : NOT_SIGNED_IN)
          if (good) resolve({ code })
          else refuse()
        })
        deps.browse(authorize).catch(refuse)
      }))
      if (back === 'aborted') throw new Failed('sign-in-cancelled')
      if (back === 'timed-out') throw new Failed('sign-in-timed-out')
      const { status, body } = await send('POST', `${url}/auth/native/token`, { json: { code: back.code, code_verifier: verifier }, signal })
        .catch(() => { throw new Failed('url-unreachable') })
      const credential = status === 200 ? credentialOf(body) : null
      if (credential === null) throw new Failed('sign-in-refused')
      return credential
    } finally {
      server.closeAllConnections()
      server.close()
    }
  }

  const proven = async (endpoint: Endpoint, signal: AbortSignal): Promise<void> => {
    const dialing = dialWith(async () => endpoint)({ start: false })
    const socket = await within(HANDSHAKE_MS, signal, dialing.catch(() => { throw new Failed('url-no-socket') }))
    if (socket === 'aborted' || socket === 'timed-out') {
      void dialing.then(late => late.close(), () => {})
      throw new Failed('url-no-socket')
    }
    try {
      const authority = await within(HANDSHAKE_MS, signal, new Promise<boolean>((resolve, reject) => {
        socket.onClose = () => reject(new Failed('url-no-socket'))
        socket.onText = text => {
          const said = sessionAuthorityOf(jsonOf(text))
          if (said !== null) resolve(said)
        }
      }))
      if (authority !== true) throw new Failed(authority === false ? 'url-legacy' : 'url-no-socket')
    } finally {
      socket.onText = null
      socket.onClose = null
      socket.close()
    }
  }

  return {
    check: async (url, { signal, onStep }) => {
      try {
        onStep('hermes')
        const verdict = statusVerdict(await send('GET', `${url}/api/status`, { signal }).catch((error: unknown) => { throw new Failed(reachFailure(error)) }))
        if (verdict !== null) throw new Failed(verdict)

        onStep('sign-in')
        let made = false
        const endpoint = await mint(url, signal).catch(async (error: unknown) => {
          if (!(error instanceof DialError) || error.kind !== 'signed-out') throw error
          await loginOf(url).take(await signIn(url, signal))
          made = true
          return mint(url, signal)
        })

        onStep('gateway')
        await proven(endpoint, signal).catch(async (error: unknown) => {
          if (made) await loginOf(url).forget()
          throw error
        })
        return { ok: true }
      } catch (error) {
        if (error instanceof Failed) return { ok: false, failure: error.failure }
        if (error instanceof DialError) return { ok: false, failure: CHECK_KINDS[error.kind] ?? 'not-hermes' }
        throw error
      }
    },

    route: url => {
      const life = new AbortController()
      const minted: Mint = async () => {
        try {
          life.signal.throwIfAborted()
          return await mint(url, life.signal)
        } catch (error) {
          throw life.signal.aborted ? new DialError('dropped') : error
        }
      }
      const call: CallHermes = async ask => {
        if (namesCurrent(ask)) throw new Error(CURRENT_IS_OWN)
        const { path, json } = profiled(ask)
        const sent = (bearer: string) => send(ask.method, `${url}${path}`, { bearer, signal: life.signal, ...(json === undefined ? {} : { json }) })
        const held = loginOf(url)
        const bearer = await held.bearer()
        const answer = await sent(bearer)
        if (answer.status !== 401) return answer
        await held.replaceRefused(bearer)
        return sent(await held.bearer())
      }
      return { dial: dialWith(minted), call, transcribe: transcribeAt(url), dispose: () => life.abort() }
    },

    keepOnly: async urls => {
      for (const held of [...logins.keys()]) if (!urls.includes(held)) logins.delete(held)
      await deps.keep.keepOnly(urls).catch(() => {})
    }
  }
}
