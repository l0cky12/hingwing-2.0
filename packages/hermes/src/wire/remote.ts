import { machineOf, type SshHost } from '../domain/reach'
import { DialError, dialWith, type Clock, type Dialer, type Mint, type ReadHermes } from './link'
import { relay, sshExec } from './ssh'
import { mintWith, readWith, transcribeWith, type RunHermes } from './tickets'
import { TRANSCRIBE_MS, type Transcribe } from './transcribe'

/** A way to reach one gateway, and the processes that way holds. */
export interface Route {
  readonly dial: Dialer
  /** Speech to text by this gateway's Hermes. */
  readonly transcribe: Transcribe
  /** Reads the gateway's HTTP API as this route's user. */
  readonly read: ReadHermes
  /** Ends every process and relay of this route, and refuses later dials. Call it after closing the `Hermes` that dials through it. */
  dispose(): void
}

function tunnelOf(address: string, protocol: 'ws:' | 'http:'): { readonly port: number; readonly path: string } | null {
  const url = URL.parse(address)
  const port = Number(url?.port)
  return url !== null && url.protocol === protocol && port > 0 ? { port, path: url.pathname + url.search } : null
}

/**
 * The gateway on another machine, over Hermes's SSH client contract. Each dial runs the commands of
 * `mintWith` there for a fresh ticket and the gateway's current loopback port, relays one
 * connection to that port through `ssh -W`, and dials the relay with the code the local route
 * uses. A gateway that restarted on another port needs no handling, because the next attach names
 * it. The ticket travels from a command's stdout to the upgrade and nowhere else.
 */
export function remoteRoute(host: SshHost, options: { readonly sshBin?: string; readonly clock?: Clock } = {}): Route {
  const life = new AbortController()
  const { signal } = life

  const run: RunHermes = (args, asked) => sshExec(host, args, { ...options, ...asked, signal })
  /** Each relay carries one connection, so another socket to the gateway gets one of its own, to the port the attach of its dial named. */
  const farPorts = new Map<string, number>()
  const relayed = async (port: number, path: string) => `ws://127.0.0.1:${await relay(host, port, { ...options, signal })}${path}`

  const minted = mintWith(run, {
    machine: machineOf({ kind: 'remote', host }),
    unprobed: 'refuse',
    forward: async url => {
      const tunnel = tunnelOf(url, 'ws:')
      if (tunnel === null) throw new DialError('incompatible')
      const local = await relayed(tunnel.port, tunnel.path)
      farPorts.set(local, tunnel.port)
      return local
    }
  })
  const read = readWith(run, async origin => {
    const tunnel = tunnelOf(origin, 'http:')
    if (tunnel === null) throw new Error('Hermes named an HTTP address Highwing cannot forward.')
    return `http://127.0.0.1:${await relay(host, tunnel.port, { ...options, signal })}`
  })

  /** A dial that a dispose cut short fails as `dropped`, whatever its killed ssh looked like. */
  const mint: Mint = async request => {
    try {
      const endpoint = await minted(request)
      const port = farPorts.get(endpoint.url)
      farPorts.delete(endpoint.url)
      return port === undefined ? endpoint : { ...endpoint, sibling: path => relayed(port, path) }
    } catch (error) {
      throw signal.aborted ? new DialError('dropped') : error
    }
  }

  const transcribe = transcribeWith(run, async origin => {
    const port = Number(URL.parse(origin)?.port)
    if (!(port > 0)) throw new DialError('incompatible')
    return `http://127.0.0.1:${await relay(host, port, { ...options, signal, firstByteMs: TRANSCRIBE_MS })}`
  })

  return { dial: dialWith(mint), read, transcribe, dispose: () => life.abort() }
}
