import { machineOf, type SshHost } from '../domain/reach'
import { DialError, dialWith, type Clock, type Dialer, type Mint } from './link'
import { relay, sshExec } from './ssh'
import { mintWith } from './tickets'

/** A way to reach one gateway, and the processes that way holds. */
export interface Route {
  readonly dial: Dialer
  /** Ends every process and relay of this route, and refuses later dials. Call it after closing the `Hermes` that dials through it. */
  dispose(): void
}

function tunnelOf(address: string): { readonly port: number; readonly path: string } | null {
  const url = URL.parse(address)
  const port = Number(url?.port)
  return url !== null && url.protocol === 'ws:' && port > 0 ? { port, path: url.pathname + url.search } : null
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

  /** Each relay carries one connection, so another socket to the gateway gets one of its own, to the port the last attach named. */
  let farPort = 0
  const relayed = async (port: number, path: string) => `ws://127.0.0.1:${await relay(host, port, { ...options, signal })}${path}`

  const minted = mintWith((args, asked) => sshExec(host, args, { ...options, ...asked, signal }), {
    machine: machineOf({ kind: 'remote', host }),
    unprobed: 'refuse',
    forward: async url => {
      const tunnel = tunnelOf(url)
      if (tunnel === null) throw new DialError('incompatible')
      farPort = tunnel.port
      return relayed(tunnel.port, tunnel.path)
    }
  })

  /** A dial that a dispose cut short fails as `dropped`, whatever its killed ssh looked like. */
  const mint: Mint = async request => {
    try {
      const endpoint = await minted(request)
      const port = farPort
      return { ...endpoint, sibling: path => relayed(port, path) }
    } catch (error) {
      throw signal.aborted ? new DialError('dropped') : error
    }
  }

  return { dial: dialWith(mint), dispose: () => life.abort() }
}
