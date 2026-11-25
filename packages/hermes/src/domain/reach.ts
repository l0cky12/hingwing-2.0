/**
 * Where Hermes runs, and what can stop Highwing from reaching it there.
 * Plain data and pure functions, read by Electron main and by the setup screen alike.
 */

declare const sshHost: unique symbol
/** What ssh is given as its destination: `[user@]name`. Only `parseSshHost` makes one. */
export type SshHost = string & { readonly [sshHost]: true }

export type Target =
  | { readonly kind: 'local' }
  | { readonly kind: 'remote'; readonly host: SshHost }

/** A leading "-" would be read by ssh as an option, so no part may start with one. */
const SSH_HOST = /^(?:[A-Za-z0-9_][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9._:-]*$/
const MAX_HOST = 253

export function parseSshHost(raw: string): SshHost | null {
  const host = raw.trim()
  return host.length <= MAX_HOST && SSH_HOST.test(host) ? (host as SshHost) : null
}

/** The one parser of a `Target`, for the settings file and for the window's command alike. */
export function targetOf(raw: unknown): Target | null {
  if (raw === null || typeof raw !== 'object') return null
  const { kind, host } = raw as { readonly kind?: unknown; readonly host?: unknown }
  if (kind === 'local') return { kind }
  const parsed = kind === 'remote' && typeof host === 'string' ? parseSshHost(host) : null
  return parsed === null ? null : { kind: 'remote', host: parsed }
}

export type ByKind<R> = { readonly [K in Target['kind']]: (target: Extract<Target, { readonly kind: K }>) => R }

export function byKind<R>(target: Target, handlers: ByKind<R>): R {
  return (handlers[target.kind] as (target: Target) => R)(target)
}

export function sameTarget(a: Target, b: Target): boolean {
  return byKind(a, {
    local: () => b.kind === 'local',
    remote: ({ host }) => b.kind === 'remote' && b.host === host
  })
}

/** Whether Hermes's files and its localhost are this computer's. */
export const onThisComputer = (target: Target): boolean => byKind(target, { local: () => true, remote: () => false })

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

/** How the words name a target: "this computer", or the far machine's short name. */
export function machineOf(target: Target): string {
  return byKind(target, {
    local: () => 'this computer',
    remote: ({ host }) => {
      const name = hostPart(host)
      return ADDRESS.test(name) ? name : (name.split('.')[0] as string)
    }
  })
}

/** In the order a check runs them. `save` belongs to the connection's owner, after the check passed. */
export type CheckStep = 'tailscale' | 'peer' | 'ssh' | 'hermes' | 'save'

export const firstStep = (target: Target): CheckStep => byKind<CheckStep>(target, { local: () => 'hermes', remote: () => 'tailscale' })

/** ssh's own failures, before any command runs on the far machine. */
export type SshFailure = 'unreachable' | 'ssh-missing' | 'ssh-denied' | 'ssh-check' | 'host-changed'

export type CheckFailure =
  | 'tailscale-missing' | 'tailscale-off' | 'tailscale-signed-out'
  | 'host-not-found' | 'host-offline'
  | SshFailure
  | 'hermes-not-found' | 'hermes-too-old'
  | 'cant-save'

type Words = (machine: string) => string

export const STEP_WORDS: Readonly<Record<CheckStep, Words>> = {
  tailscale: () => 'Checking Tailscale on this computer',
  peer: machine => `Looking for ${machine} on your tailnet`,
  ssh: machine => `Connecting to ${machine}`,
  hermes: machine => `Looking for Hermes on ${machine}`,
  save: () => 'Saving this connection'
}

/** Every way a check can fail: the step it fails at, what to tell the user, and the one thing to try. */
export const CHECK_FAILURES: Readonly<Record<CheckFailure, { readonly step: CheckStep; readonly words: Words; readonly fix: Words }>> = {
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
