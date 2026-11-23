/**
 * Hermes's SSH client contract (website/docs/developer-guide/gateway-ssh-clients.md), spoken through
 * the system `ssh`. Nothing here keeps a process between two calls.
 */
import { spawn } from 'node:child_process'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import type { SshFailure, SshHost } from '../domain/reach'
import { HANDSHAKE_MS, systemClock, type Clock } from './link'

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
/** Every hermes command Highwing runs on the far machine. Literal tuples, so no typed value reaches a remote shell. */
export type HermesArgs = typeof PROBE | (typeof ATTACH)[keyof typeof ATTACH]

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
}

/** Runs a command to its end, its deadline or the signal, whichever is first. Its output is returned and never logged. */
export function runTool(bin: string, args: readonly string[], { deadlineMs, signal, clock = systemClock }: ToolOptions): Promise<ToolRun> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve({ end: 'cut', stderr: '' })
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
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

export type ProbeFailure = SshFailure | 'hermes-not-found' | 'hermes-too-old'
export type Probe =
  | { readonly ok: true; readonly windowsServiceSession: boolean }
  | { readonly ok: false; readonly failure: ProbeFailure }

/**
 * Reads `hermes gateway tickets --probe --json`. A Hermes that predates the command exits non-zero
 * and prints no JSON. A host that does not report `windows_service_session` is treated as false.
 */
export function probeOf(code: number, stdout: string): Probe {
  if (code === NOT_FOUND) return { ok: false, failure: 'hermes-not-found' }
  try {
    const reply: unknown = code === 0 ? JSON.parse(stdout.trim().split('\n').at(-1) ?? '') : null
    if (reply === null || typeof reply !== 'object') return { ok: false, failure: 'hermes-too-old' }
    return { ok: true, windowsServiceSession: (reply as { readonly windows_service_session?: unknown }).windows_service_session === true }
  } catch {
    return { ok: false, failure: 'hermes-too-old' }
  }
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
 */
export function relay(host: SshHost, port: number, { sshBin = 'ssh', signal, clock = systemClock }: Omit<SshOptions, 'deadlineMs'>): Promise<number> {
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
      carry(socket, [...SSH_OPTIONS, '-W', `127.0.0.1:${port}`, host], { sshBin, signal, clock })
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

function carry(socket: Socket, args: readonly string[], { sshBin, signal, clock }: { readonly sshBin: string; readonly signal: AbortSignal; readonly clock: Clock }): void {
  const child = spawn(sshBin, args, { stdio: ['pipe', 'pipe', 'ignore'] })
  const stop = () => {
    heard()
    signal.removeEventListener('abort', stop)
    socket.destroy()
    child.kill()
  }
  const heard = clock.setTimeout(stop, UPGRADE_MS)
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
