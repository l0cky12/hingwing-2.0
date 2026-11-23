import { CHECK_FAILURES, machineOf, type SshHost } from '../domain/reach'
import { DialError, dialWith, endpointOf, EXIT_KINDS, type Clock, type Dialer, type Endpoint, type Mint } from './link'
import { ATTACH, NOT_FOUND, probeHermes, relay, sshExec, type ProbeFailure } from './ssh'

/** A way to reach one gateway, and the processes that way holds. */
export interface Route {
  readonly dial: Dialer
  /** Ends every process and relay of this route, and refuses later dials. Call it after closing the `Hermes` that dials through it. */
  dispose(): void
}

type Kind = DialError['kind']

const PROBE_KINDS: Readonly<Record<ProbeFailure, Kind>> = {
  unreachable: 'unreachable', 'ssh-missing': 'ssh-missing', 'ssh-denied': 'ssh-denied', 'ssh-check': 'ssh-check', 'host-changed': 'host-changed',
  'hermes-not-found': 'hermes-missing', 'hermes-too-old': 'incompatible'
}

const PROBE_MS = 20_000
/** attach's own `--timeout`, plus ssh's ConnectTimeout and room to exit. */
const ATTACH_MS = { start: 90_000, retry: 35_000 } as const

function tunnelOf(endpoint: Endpoint): { readonly port: number; readonly path: string } | null {
  const url = URL.parse(endpoint.url)
  const port = Number(url?.port)
  return url !== null && url.protocol === 'ws:' && port > 0 ? { port, path: url.pathname + url.search } : null
}

/**
 * The gateway on another machine, over Hermes's SSH client contract. Each dial runs
 * `hermes gateway attach --json` there for a fresh ticket and the gateway's current loopback port,
 * relays one connection to that port through `ssh -W`, and dials the relay with the code the local
 * route uses. A gateway that restarted on another port needs no handling, because the next attach
 * names it. The ticket travels from attach's stdout to the upgrade and nowhere else.
 */
export function remoteRoute(host: SshHost, options: { readonly sshBin?: string; readonly clock?: Clock } = {}): Route {
  const life = new AbortController()
  const { signal } = life
  const machine = machineOf({ kind: 'remote', host })
  const failed = (failure: ProbeFailure) => new DialError(PROBE_KINDS[failure], CHECK_FAILURES[failure].words(machine))
  let probed: Promise<{ readonly windowsServiceSession: boolean }> | null = null
  /** Client rule 1: probe first. Only an answer is kept, so a machine that was unreachable is asked again. */
  const probe = () => (probed ??= probeHermes(host, { ...options, signal, deadlineMs: PROBE_MS }).then(reply => {
    if (reply.ok) return reply
    probed = null
    throw failed(reply.failure)
  }))

  const attach: Mint = async ({ start }) => {
    const { windowsServiceSession } = await probe()
    // Client rule 2: a Windows service session only attaches. A gateway it started would refuse that user's own windows.
    const starts = start && !windowsServiceSession
    const run = await sshExec(host, starts ? ATTACH.start : ATTACH.retry, { ...options, signal, deadlineMs: starts ? ATTACH_MS.start : ATTACH_MS.retry })
    if (!run.ok) throw failed(run.why)
    if (run.code === NOT_FOUND) throw failed('hermes-not-found')
    if (run.code !== 0) {
      const kind = EXIT_KINDS[run.code] ?? 'inaccessible'
      throw kind === 'not-running' && windowsServiceSession
        ? new DialError(kind, `Hermes isn't running on ${machine}. Start it from a normal window on that machine's desktop.`)
        : new DialError(kind)
    }
    const endpoint = endpointOf(run.stdout)
    const tunnel = endpoint === null ? null : tunnelOf(endpoint)
    if (endpoint === null || tunnel === null) throw new DialError('incompatible')
    const port = await relay(host, tunnel.port, { ...options, signal })
    return { url: `ws://127.0.0.1:${port}${tunnel.path}`, protocols: endpoint.protocols }
  }

  /** A dial that a dispose cut short fails as `dropped`, whatever its killed ssh looked like. */
  const mint: Mint = request => attach(request).catch((error: unknown) => {
    throw signal.aborted ? new DialError('dropped') : error
  })

  return { dial: dialWith(mint), dispose: () => life.abort() }
}
