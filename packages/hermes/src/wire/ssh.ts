/**
 * Hermes's SSH client contract (website/docs/developer-guide/gateway-ssh-clients.md), spoken through
 * the system `ssh`. Nothing here keeps a process between two calls.
 */
import { spawn } from 'node:child_process'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import type { SshFailure, SshHost } from '../domain/reach'
import { EXIT_KINDS, HANDSHAKE_MS, systemClock, type Clock, type DialError } from './link'

/** Hermes's own transport (hermes_cli/gateway_connections_ssh_transport.py:183-190), without its ControlMaster. */
export const SSH_OPTIONS = [
  '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10',
  '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'
] as const

export const PROBE = ['gateway', 'tickets', '--probe', '--json'] as const
export const ATTACH = {
  start: ['gateway', 'attach', '--json', '--start', '--timeout', '75'],
  retry: ['gateway', 'attach', '--json', '--timeout', '20']
} as const
export const SERVE = ['gateway', 'tickets', '--serve', '--json'] as const
/** Every hermes command Highwing runs. Literal tuples, so no typed value reaches a remote shell. */
export type HermesArgs = typeof PROBE | typeof SERVE | (typeof ATTACH)[keyof typeof ATTACH]
/** The only line Highwing writes to a `--serve` channel. A literal too, and it names no profile: an interactive ticket takes none. */
export const ASK_INTERACTIVE = '{"id":1,"purpose":"interactive"}\n'
/**
 * The line that asks `--serve` for a one-use ticket to the gateway's HTTP routes, such as its speech upload and its kanban board.
 * With a profile the ticket is bound to it, which Hermes requires of a route that takes `?profile=` other than the gateway's own.
 */
export const askNativeHttp = (profile?: string): string => `${JSON.stringify({ id: 1, purpose: 'native-http', ...(profile === undefined ? {} : { profile }) })}\n`

/** The installer's command locations (Hermes's scripts/install.sh): per-user, root, and the legacy venv. */
export const HERMES_PATHS = ['$HOME/.local/bin/hermes', '/usr/local/bin/hermes', '$HOME/.hermes/hermes-agent/venv/bin/hermes'] as const
export const NOT_FOUND = 127

/**
 * Hermes's own locator (hermes_cli/gateway_connections_ssh_remote.py:201-224) as one `sh` command:
 * the login shell's `hermes`, then the install locations. A non-interactive ssh command often has no
 * `hermes` on its PATH. The script holds no single quote and no backslash, so it survives one layer
 * of single quotes in sh, bash, zsh and fish.
 */
export function remoteHermes(args: HermesArgs, paths: readonly string[] = HERMES_PATHS): string {
  const candidates = ['$found', ...paths].map(path => `"${path}"`).join(' ')
  const locate = [
    'found=$(bash -lc "command -v hermes" 2>/dev/null | tail -n 1)',
    `for hermes in ${candidates}; do if [ -n "$hermes" ] && [ -x "$hermes" ]; then exec "$hermes" "$@"; fi; done`,
    `exit ${NOT_FOUND}`
  ].join('; ')
  return `sh -c '${locate}' hermes ${args.join(' ')}`
}

export type ToolRun =
  | { readonly end: 'exit'; readonly code: number; readonly stdout: string; readonly stderr: string }
  | { readonly end: 'missing' }
  /** Killed at its deadline or by the signal. `stderr` is what it had written by then. */
  | { readonly end: 'cut'; readonly stderr: string }

export interface ToolOptions {
  readonly deadlineMs: number
  readonly signal: AbortSignal
  readonly clock?: Clock
  /** Written to the command's stdin, which is then closed. Absent: its stdin is closed at once. */
  readonly input?: string
}

/** Runs a command to its end, its deadline or the signal, whichever is first. Its output is returned and never logged. */
export function runTool(bin: string, args: readonly string[], { deadlineMs, signal, clock = systemClock, input }: ToolOptions): Promise<ToolRun> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve({ end: 'cut', stderr: '' })
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    // A command that ends before it reads its stdin closes the pipe under the write. Its exit says what happened.
    child.stdin.on('error', () => {})
    child.stdin.end(input)
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    const done = (run: ToolRun) => {
      cancel()
      signal.removeEventListener('abort', cut)
      resolve(run)
    }
    const cut = () => {
      child.kill()
      done({ end: 'cut', stderr })
    }
    const cancel = clock.setTimeout(cut, deadlineMs)
    signal.addEventListener('abort', cut, { once: true })
    child.on('error', (error: NodeJS.ErrnoException) => done(error.code === 'ENOENT' ? { end: 'missing' } : { end: 'cut', stderr }))
    child.on('close', code => done(code === null ? { end: 'cut', stderr } : { end: 'exit', code, stdout, stderr }))
  })
}

/**
 * ssh's stderr, read only to classify. In the order of Hermes's `classify_ssh_error`
 * (gateway_connections_ssh_transport.py:251-270): the host-key banner also mentions keys, so it is
 * read first. Anything unmatched is `unreachable`.
 */
export const SSH_STDERR: readonly (readonly [RegExp, SshFailure])[] = [
  [/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|Offending (?:key|ECDSA|RSA|ED25519)/i, 'host-changed'],
  [/Tailscale SSH requires an additional check|To authenticate, visit:\s*https:\/\/login\.tailscale\.com\//i, 'ssh-check'],
  [/Permission denied|Too many authentication failures|no matching host key|publickey|password|keyboard-interactive/i, 'ssh-denied']
]

export const sshFailureOf = (stderr: string): SshFailure => SSH_STDERR.find(([pattern]) => pattern.test(stderr))?.[1] ?? 'unreachable'

/** ssh keeps 255 for its own failures. Every other code is the far command's. */
const SSH_FAILED = 255

export type SshRun =
  | { readonly ok: true; readonly code: number; readonly stdout: string }
  | { readonly ok: false; readonly why: SshFailure }

export type SshOptions = ToolOptions & { readonly sshBin?: string }

/**
 * Runs one hermes command on the far machine. A deadline classifies the stderr written so far,
 * because Tailscale's check mode waits for a browser instead of failing.
 */
export async function sshExec(host: SshHost, args: HermesArgs, options: SshOptions): Promise<SshRun> {
  const run = await runTool(options.sshBin ?? 'ssh', [...SSH_OPTIONS, host, remoteHermes(args)], options)
  if (run.end === 'missing') return { ok: false, why: 'ssh-missing' }
  if (run.end === 'cut' || run.code === SSH_FAILED) return { ok: false, why: sshFailureOf(run.stderr) }
  return { ok: true, code: run.code, stdout: run.stdout }
}

/** What a ping runs on the far machine. A literal, and a word that sh, cmd and PowerShell all know. */
export const PING = 'exit'

/** Whether ssh logs in to `host` and runs a command there before the deadline. It runs no hermes command, so it says nothing about Hermes. */
export async function sshPing(host: SshHost, options: SshOptions): Promise<boolean> {
  const run = await runTool(options.sshBin ?? 'ssh', [...SSH_OPTIONS, host, PING], options)
  return run.end === 'exit' && run.code === 0
}

/** The most of a far file Highwing reads. */
export const READ_CAP = 10 * 1024 * 1024
/**
 * Prints the file named by stdin's first line, and at most one byte past the cap. A literal, as the hermes
 * commands are: the path reaches `read` as data, never a shell's parser. Exit 3: there is no such file.
 */
export const READ_FILE = `sh -c 'IFS= read -r path || exit 3; [ -f "$path" ] || exit 3; exec head -c ${READ_CAP + 1} -- "$path"'`

export type RemoteRead = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly why: SshFailure | 'missing' | 'too-big' }

/** Reads one file on the far machine as UTF-8 text. A path with a newline can't go as one line, so no file answers to it. */
export async function sshRead(host: SshHost, path: string, options: SshOptions): Promise<RemoteRead> {
  if (/[\n\0]/.test(path)) return { ok: false, why: 'missing' }
  const run = await runTool(options.sshBin ?? 'ssh', [...SSH_OPTIONS, host, READ_FILE], { ...options, input: `${path}\n` })
  if (run.end === 'missing') return { ok: false, why: 'ssh-missing' }
  if (run.end === 'cut' || run.code === SSH_FAILED) return { ok: false, why: sshFailureOf(run.stderr) }
  if (run.code !== 0) return { ok: false, why: 'missing' }
  return Buffer.byteLength(run.stdout) > READ_CAP ? { ok: false, why: 'too-big' } : { ok: true, text: run.stdout }
}

export type ProbeFailure = SshFailure | 'hermes-not-found' | 'hermes-too-old'
export type Probe =
  /** `interactive`: this Hermes mints the ticket that opens one socket for every profile. */
  | { readonly ok: true; readonly windowsServiceSession: boolean; readonly interactive: boolean }
  | { readonly ok: false; readonly failure: ProbeFailure }

type Obj = Readonly<Record<string, unknown>>
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)

function jsonObjectAt(stdout: string, at: number): Obj | null {
  try {
    const value: unknown = JSON.parse(stdout.trim().split('\n').at(at) ?? '')
    return isObject(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Reads `hermes gateway tickets --probe --json`. A Hermes that predates the command exits non-zero
 * and prints no JSON. A host that does not report `windows_service_session` is treated as false.
 */
export function probeOf(code: number, stdout: string): Probe {
  if (code === NOT_FOUND) return { ok: false, failure: 'hermes-not-found' }
  const reply = code === 0 ? jsonObjectAt(stdout, -1) : null
  if (reply === null) return { ok: false, failure: 'hermes-too-old' }
  return {
    ok: true,
    windowsServiceSession: reply.windows_service_session === true,
    interactive: Array.isArray(reply.purposes) && reply.purposes.includes('interactive')
  }
}

/** What `hermes gateway attach --json` printed: where the gateway listens, the ticket's subprotocols, and which gateway process answered. */
export interface Attached { readonly url: string; readonly protocols: readonly string[]; readonly instanceId: string | null }

export function attachedOf(stdout: string): Attached | null {
  const reply = jsonObjectAt(stdout, -1)
  if (reply === null) return null
  const { url, protocols, endpoint } = reply
  if (typeof url !== 'string' || !Array.isArray(protocols) || !protocols.every(held => typeof held === 'string')) return null
  const instanceId = isObject(endpoint) && typeof endpoint.instance_id === 'string' ? endpoint.instance_id : null
  return { url, protocols, instanceId }
}

export type Served =
  | { readonly is: 'ticket'; readonly ticket: string; readonly instanceId: string | null }
  /** `unsupported_purpose`: this Hermes mints no interactive ticket after all. */
  | { readonly is: 'unsupported' }
  /** The hello was an error, or no ticket came. `kind` is what the link shows. */
  | { readonly is: 'failed'; readonly kind: DialError['kind'] }

/**
 * Reads a run of `hermes gateway tickets --serve --json` that was sent `ASK_INTERACTIVE`: the hello
 * line, then the one reply. With no gateway to use the first line is an error and the exit code is
 * the one `attach` gives that verdict. A ticket the gateway would not mint is `dropped`, so the
 * retry attaches again, as the contract asks after `ticket_unavailable`.
 */
export function servedOf(code: number, stdout: string): Served {
  const hello = jsonObjectAt(stdout, 0)
  if (hello?.type !== 'hello') return { is: 'failed', kind: code === 0 ? 'incompatible' : EXIT_KINDS[code] ?? 'inaccessible' }
  const reply = jsonObjectAt(stdout, 1)
  if (reply?.ok === true && typeof reply.ticket === 'string' && reply.ticket !== '') {
    const { endpoint } = hello
    return { is: 'ticket', ticket: reply.ticket, instanceId: isObject(endpoint) && typeof endpoint.instance_id === 'string' ? endpoint.instance_id : null }
  }
  const refusal = isObject(reply?.error) ? reply.error.code : null
  return refusal === 'unsupported_purpose' ? { is: 'unsupported' } : { is: 'failed', kind: 'dropped' }
}

/** Where the gateway that answered a `--serve` run takes HTTP, as its hello names it: a loopback origin on its own machine. */
export function originOf(stdout: string): string | null {
  const hello = jsonObjectAt(stdout, 0)
  const origin = hello?.type === 'hello' && isObject(hello.endpoint) ? hello.endpoint.api_origin : null
  return typeof origin === 'string' && URL.canParse(origin) ? origin : null
}

/**
 * Why `--serve` gave no ticket to the HTTP routes. `unsupported`: this Hermes mints none, or names no HTTP address for one.
 * `unknown-profile`: it has no such profile. `not-served`: its gateway does not serve that profile. `malformed`: it refused the
 * request line. `unavailable`: no gateway to ask, or a ticket it would not mint now.
 */
export type TicketRefusal = 'unsupported' | 'unknown-profile' | 'not-served' | 'malformed' | 'unavailable'
export type HttpTicket = { readonly ok: true; readonly origin: string; readonly ticket: string } | { readonly ok: false; readonly why: TicketRefusal }

/** `_reply`'s refusal codes (gateway_runtime_tickets.py:79-118). Any other is `unavailable`. */
const TICKET_REFUSALS: Readonly<Record<string, TicketRefusal>> = {
  unsupported_purpose: 'unsupported', unknown_profile: 'unknown-profile', profile_not_served: 'not-served', invalid_request: 'malformed'
}

/** Reads a run of `--serve` that was sent `askNativeHttp`: the hello's `api_origin` and the reply's ticket, or why none came. */
export function httpTicketOf(code: number, stdout: string): HttpTicket {
  const hello = jsonObjectAt(stdout, 0)
  const reply = jsonObjectAt(stdout, 1)
  if (code !== 0 || hello?.type !== 'hello') return { ok: false, why: 'unavailable' }
  if (reply?.ok !== true || typeof reply.ticket !== 'string' || reply.ticket === '') {
    const refusal = isObject(reply?.error) ? reply.error.code : null
    return { ok: false, why: typeof refusal === 'string' && Object.hasOwn(TICKET_REFUSALS, refusal) ? TICKET_REFUSALS[refusal] as TicketRefusal : 'unavailable' }
  }
  const origin = isObject(hello.endpoint) ? hello.endpoint.api_origin : null
  return typeof origin === 'string' ? { ok: true, origin, ticket: reply.ticket } : { ok: false, why: 'unsupported' }
}

export async function probeHermes(host: SshHost, options: SshOptions): Promise<Probe> {
  const run = await sshExec(host, PROBE, options)
  return run.ok ? probeOf(run.code, run.stdout) : { ok: false, failure: run.why }
}

/** How long the far side has to send its first byte back through a relay. */
export const UPGRADE_MS = HANDSHAKE_MS

/**
 * Listens on a loopback port of this computer for one connection, and carries it to
 * `127.0.0.1:port` on the far machine through `ssh -W`. Resolves with the local port. The far side
 * sees a loopback peer, which the gateway requires of a ticket. The ssh ends with the connection,
 * and a crashed Highwing leaves none behind, because `ssh -W` exits when its stdin closes.
 * `firstByteMs`: how long the far side may stay silent once dialed. A socket upgrade answers at
 * once, while an HTTP request is answered only when its work is done.
 */
export function relay(
  host: SshHost, port: number, { sshBin = 'ssh', signal, clock = systemClock, firstByteMs = UPGRADE_MS }: Omit<SshOptions, 'deadlineMs'> & { readonly firstByteMs?: number }
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('The route was disposed.'))
    const server = createServer()
    const abandon = () => {
      neverDialed()
      signal.removeEventListener('abort', abandon)
      server.close()
      reject(new Error('The relay closed before it was dialed.'))
    }
    const neverDialed = clock.setTimeout(abandon, UPGRADE_MS)
    signal.addEventListener('abort', abandon, { once: true })
    server.once('connection', socket => {
      abandon()
      carry(socket, [...SSH_OPTIONS, '-W', `127.0.0.1:${port}`, host], { sshBin, signal, clock, firstByteMs })
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

function carry(socket: Socket, args: readonly string[], { sshBin, signal, clock, firstByteMs }: { readonly sshBin: string; readonly signal: AbortSignal; readonly clock: Clock; readonly firstByteMs: number }): void {
  const child = spawn(sshBin, args, { stdio: ['pipe', 'pipe', 'ignore'] })
  const stop = () => {
    heard()
    signal.removeEventListener('abort', stop)
    socket.destroy()
    child.kill()
  }
  const heard = clock.setTimeout(stop, firstByteMs)
  signal.addEventListener('abort', stop, { once: true })
  child.stdout.once('data', heard)
  socket.pipe(child.stdin)
  child.stdout.pipe(socket)
  socket.on('error', stop)
  socket.on('close', stop)
  child.stdin.on('error', stop)
  child.on('error', stop)
  // The pipe has handed over everything ssh wrote by now, so the close frame is not cut off.
  child.on('close', () => socket.destroySoon())
}
