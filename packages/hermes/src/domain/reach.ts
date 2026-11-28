/**
 * Where Hermes runs, and what can stop Highwing from reaching it there.
 * Plain data and pure functions, read by Electron main and by the setup screen alike.
 */

declare const sshHost: unique symbol
/** What ssh is given as its destination: `[user@]name`. Only `parseSshHost` makes one. */
export type SshHost = string & { readonly [sshHost]: true }

export type Target =
  | { readonly kind: 'local' }
  /** A machine of the tailnet. Its check asks Tailscale for the machine before it tries ssh. */
  | { readonly kind: 'remote'; readonly host: SshHost }
  /** Any ssh destination, such as a LAN address or a Host of `~/.ssh/config`. Tailscale is never asked. */
  | { readonly kind: 'ssh'; readonly host: SshHost }
  | { readonly kind: 'url'; readonly url: GatewayUrl }

/** A leading "-" would be read by ssh as an option, so no part may start with one. */
const SSH_HOST = /^(?:[A-Za-z0-9_][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9._:-]*$/
const MAX_HOST = 253

export function parseSshHost(raw: string): SshHost | null {
  const host = raw.trim()
  return host.length <= MAX_HOST && SSH_HOST.test(host) ? (host as SshHost) : null
}

/**
 * The one parser of a `Target`, for the settings file and for the window's command alike. An address
 * must be spelled as `parseGatewayUrl` spells it, so two saved targets are the same gateway exactly
 * when their addresses are equal.
 */
export function targetOf(raw: unknown): Target | null {
  if (raw === null || typeof raw !== 'object') return null
  const { kind, host, url } = raw as { readonly kind?: unknown; readonly host?: unknown; readonly url?: unknown }
  if (kind === 'local') return { kind }
  if (kind === 'url') {
    const parsed = typeof url === 'string' ? parseGatewayUrl(url) : null
    return parsed !== null && parsed.ok && parsed.url === url ? { kind, url: parsed.url } : null
  }
  if (kind !== 'remote' && kind !== 'ssh') return null
  const parsed = typeof host === 'string' ? parseSshHost(host) : null
  return parsed === null ? null : { kind, host: parsed }
}

export type ByKind<R> = { readonly [K in Target['kind']]: (target: Extract<Target, { readonly kind: K }>) => R }

export function byKind<R>(target: Target, handlers: ByKind<R>): R {
  return (handlers[target.kind] as (target: Target) => R)(target)
}

export function sameTarget(a: Target, b: Target): boolean {
  return byKind(a, {
    local: () => b.kind === 'local',
    remote: ({ host }) => b.kind === 'remote' && b.host === host,
    ssh: ({ host }) => b.kind === 'ssh' && b.host === host,
    url: ({ url }) => b.kind === 'url' && b.url === url
  })
}

export const onThisComputer = (target: Target): boolean => byKind(target, { local: () => true, remote: () => false, ssh: () => false, url: () => false })

/** The name without any `user@`: what Tailscale lists and what ssh resolves. */
export const hostPart = (host: SshHost): string => host.slice(host.indexOf('@') + 1)

declare const gatewayUrl: unique symbol
/**
 * Where a Hermes gateway serves its Webapp, spelled one way: `scheme://host[:port][/prefix]`.
 * Only `parseGatewayUrl` makes one, so it is http or https, holds no username, password, `?` or `#`
 * part, and two of them name the same gateway exactly when they are equal strings.
 */
export type GatewayUrl = string & { readonly [gatewayUrl]: true }

export type UrlProblem = 'not-an-address' | 'credentials' | 'extras'

export type ParsedUrl = { readonly ok: true; readonly url: GatewayUrl } | { readonly ok: false; readonly problem: UrlProblem }

export const URL_PROBLEMS: Readonly<Record<UrlProblem, { readonly words: string; readonly fix: string }>> = {
  'not-an-address': {
    words: "That isn't a web address.",
    fix: "Type the address of the gateway's Webapp, such as https://hermes.example.com."
  },
  credentials: {
    words: 'That address has a username or password in it.',
    fix: "Take them out. Highwing asks you to sign in on Hermes's own page instead."
  },
  extras: {
    words: 'That address has a ? or # part, which can hold a sign-in secret.',
    fix: 'Use the address up to the ? or #.'
  }
}

const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i
const UNRESERVED = /[A-Za-z0-9._~-]/
const MAX_URL = 2048

/** The one maker of a `GatewayUrl`. Text with no scheme is read as https. */
export function parseGatewayUrl(raw: string): ParsedUrl {
  const text = raw.trim()
  if (text.length > MAX_URL) return { ok: false, problem: 'not-an-address' }
  const url = URL.parse(SCHEME.test(text) ? text : `https://${text}`)
  if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.port === '0') return { ok: false, problem: 'not-an-address' }
  if (url.username !== '' || url.password !== '') return { ok: false, problem: 'credentials' }
  // `URL` drops an empty `?` or `#`, so only the text shows one was typed.
  if (/[?#]/.test(text)) return { ok: false, problem: 'extras' }
  if (/%(?![0-9a-f]{2})/i.test(url.pathname)) return { ok: false, problem: 'not-an-address' }
  const path = url.pathname.replace(/\/+$/, '').replace(/%[0-9a-f]{2}/gi, escape => {
    const char = String.fromCharCode(parseInt(escape.slice(1), 16))
    return UNRESERVED.test(char) ? char : escape.toUpperCase()
  })
  const canonical = `${url.protocol}//${url.host}${path}`
  return canonical.length <= MAX_URL ? { ok: true, url: canonical as GatewayUrl } : { ok: false, problem: 'not-an-address' }
}

const LOOPBACK = /^(?:localhost|\[::1\]|127\.\d+\.\d+\.\d+)$/

/** Whether the address sends a sign-in and chats unencrypted across a network. */
export function isPlainHttp(url: GatewayUrl): boolean {
  const { protocol, hostname } = new URL(url)
  return protocol === 'http:' && !LOOPBACK.test(hostname)
}

const ADDRESS = /^[0-9.]+$|:/

function shortName(host: SshHost): string {
  const name = hostPart(host)
  return ADDRESS.test(name) ? name : (name.split('.')[0] as string)
}

export function machineOf(target: Target): string {
  return byKind(target, {
    local: () => 'this computer',
    remote: ({ host }) => shortName(host),
    ssh: ({ host }) => shortName(host),
    url: ({ url }) => gatewayHost(url)
  })
}

/** The host of the address: how the words name a gateway reached by its address. */
export const gatewayHost = (url: GatewayUrl): string => new URL(url).hostname

/**
 * In the order a check runs them. A tailnet machine runs `tailscale`, `peer`, `ssh` and `hermes`, an
 * ssh destination runs `ssh` and `hermes`, this computer runs `hermes`, and a gateway address runs
 * `hermes`, `sign-in` and `gateway`. `save` belongs to the connection's owner, after the check passed.
 */
export type CheckStep = 'tailscale' | 'peer' | 'ssh' | 'hermes' | 'sign-in' | 'gateway' | 'save'

export const firstStep = (target: Target): CheckStep => byKind<CheckStep>(target, { local: () => 'hermes', remote: () => 'tailscale', ssh: () => 'ssh', url: () => 'hermes' })

/** ssh's own failures, before any command runs on the far machine. */
export type SshFailure = 'unreachable' | 'ssh-missing' | 'ssh-denied' | 'ssh-check' | 'host-changed'

export type CheckFailure =
  | 'tailscale-missing' | 'tailscale-off' | 'tailscale-signed-out'
  | 'host-not-found' | 'host-offline'
  | SshFailure
  | 'hermes-not-found' | 'hermes-too-old'
  | 'cant-save'

/** What only the check of a gateway address can fail with. It can also fail with `hermes-too-old`. */
export type UrlFailure =
  | 'url-unreachable' | 'url-certificate' | 'not-hermes' | 'no-sign-in' | 'dashboard'
  | 'sign-in-cancelled' | 'sign-in-timed-out' | 'sign-in-refused'
  | 'url-no-socket' | 'url-legacy'

export type SetupFailure = CheckFailure | UrlFailure

type Words = (machine: string) => string
/** The step a check fails at, what to tell the user, and the one thing to try. */
export interface Failure { readonly step: CheckStep; readonly words: Words; readonly fix: Words }

export const STEP_WORDS: Readonly<Record<CheckStep, Words>> = {
  tailscale: () => 'Checking Tailscale on this computer',
  peer: machine => `Looking for ${machine} on your tailnet`,
  ssh: machine => `Connecting to ${machine}`,
  hermes: machine => `Looking for Hermes on ${machine}`,
  'sign-in': machine => `Waiting for you to sign in to ${machine} in your browser`,
  gateway: machine => `Opening the Hermes gateway on ${machine}`,
  save: () => 'Saving this connection'
}

/** Every way a check of this computer or of another machine can fail. */
export const CHECK_FAILURES: Readonly<Record<CheckFailure, Failure>> = {
  'tailscale-missing': {
    step: 'tailscale',
    words: () => "Tailscale isn't installed on this computer.",
    fix: () => 'Install Tailscale and sign in, then try again.'
  },
  'tailscale-off': {
    step: 'tailscale',
    words: () => "Tailscale isn't running on this computer.",
    fix: () => 'Start Tailscale, then try again.'
  },
  'tailscale-signed-out': {
    step: 'tailscale',
    words: () => 'Tailscale is signed out on this computer.',
    fix: () => 'Sign in to Tailscale, then try again.'
  },
  'host-not-found': {
    step: 'peer',
    words: machine => `No machine called ${machine} is on your tailnet.`,
    fix: () => 'Check the name against the machines Tailscale lists.'
  },
  'host-offline': {
    step: 'peer',
    words: machine => `Your tailnet lists ${machine}, but it is offline.`,
    fix: () => 'Turn that machine on, or start Tailscale on it.'
  },
  unreachable: {
    step: 'ssh',
    words: machine => `Highwing can't reach ${machine} over SSH.`,
    fix: () => 'Check that the machine is on and that SSH is turned on there.'
  },
  'ssh-missing': {
    step: 'ssh',
    words: () => 'This computer has no ssh command.',
    fix: () => 'Install OpenSSH, then try again.'
  },
  'ssh-denied': {
    step: 'ssh',
    words: machine => `The machine ${machine} refused this computer's SSH login.`,
    fix: () => 'Add your SSH key there, or allow this computer in your Tailscale SSH rules.'
  },
  'ssh-check': {
    step: 'ssh',
    words: () => 'Tailscale wants you to confirm this connection in a browser.',
    fix: machine => `Connect to ${machine} with ssh in a terminal once, finish the check, then try again.`
  },
  'host-changed': {
    step: 'ssh',
    words: machine => `The SSH key of ${machine} has changed since you last connected.`,
    fix: () => 'If that machine was reinstalled, remove its old key from ~/.ssh/known_hosts, then try again.'
  },
  'hermes-not-found': {
    step: 'hermes',
    words: machine => `Hermes isn't installed on ${machine}.`,
    fix: () => 'Install Hermes there, then try again.'
  },
  'hermes-too-old': {
    step: 'hermes',
    words: machine => `The Hermes on ${machine} is too old for Highwing.`,
    fix: () => 'Update Hermes there, then try again.'
  },
  'cant-save': {
    step: 'save',
    words: () => "Highwing couldn't save this connection.",
    fix: () => "Check that Highwing's settings folder can be written to, then try again."
  }
}

/** Every way only the check of a gateway address can fail. `machine` is `gatewayHost` of the address. */
export const URL_FAILURES: Readonly<Record<UrlFailure, Failure>> = {
  'url-unreachable': {
    step: 'hermes',
    words: machine => `Highwing can't reach ${machine}.`,
    fix: () => 'Check the address, and that the machine and its Hermes gateway are on.'
  },
  'url-certificate': {
    step: 'hermes',
    words: machine => `This computer doesn't trust the certificate of ${machine}.`,
    fix: () => "Give that address a certificate this computer trusts, such as one from Tailscale Serve or Let's Encrypt."
  },
  'not-hermes': {
    step: 'hermes',
    words: machine => `Something answers at ${machine}, but it isn't Hermes.`,
    fix: () => "Use the address of the gateway's Webapp. Add a path only if a proxy serves Hermes under one."
  },
  'no-sign-in': {
    step: 'hermes',
    words: machine => `The Hermes on ${machine} has no sign-in that Highwing can use.`,
    fix: () => 'On that machine, give the Webapp a sign-in, such as a username and password under dashboard.basic_auth, then restart the gateway.'
  },
  dashboard: {
    step: 'hermes',
    words: machine => `What answers at ${machine} is the Hermes dashboard, which Highwing can't chat through.`,
    fix: () => "Use the address of the gateway's Webapp instead, which is webapp.public_url in ~/.hermes/config.yaml on that machine. If the Webapp is off, turn it on with webapp.enabled, then restart the gateway."
  },
  'sign-in-cancelled': {
    step: 'sign-in',
    words: machine => `You stopped the sign-in to ${machine}.`,
    fix: () => 'Press Connect when you want to sign in.'
  },
  'sign-in-timed-out': {
    step: 'sign-in',
    words: machine => `You didn't finish signing in to ${machine} within 10 minutes.`,
    fix: () => 'Press Connect to open the sign-in page again.'
  },
  'sign-in-refused': {
    step: 'sign-in',
    words: machine => `The Hermes on ${machine} didn't accept the sign-in.`,
    fix: () => 'Press Connect to sign in again.'
  },
  'url-no-socket': {
    step: 'gateway',
    words: machine => `You signed in to ${machine}, but its chat connection didn't open.`,
    fix: () => 'If a proxy or tunnel serves this address, let it pass WebSocket connections through to Hermes.'
  },
  'url-legacy': {
    step: 'gateway',
    words: machine => `You signed in to ${machine}, but it answered with the dashboard's older chat, which Highwing can't use.`,
    fix: () => "On that machine, turn on the gateway's Webapp and use its address."
  }
}

const FAILURES: Readonly<Record<SetupFailure, Failure>> = { ...CHECK_FAILURES, ...URL_FAILURES }

/** The step, words and fix of any failure the setup screen can show, whichever check found it. */
export const failureOf = (failure: SetupFailure): Failure => FAILURES[failure]
