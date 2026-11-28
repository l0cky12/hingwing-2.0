/**
 * Where a socket's ticket comes from: client rules 1 to 4 of Hermes's SSH client contract
 * (website/docs/developer-guide/gateway-ssh-clients.md), for the Hermes on this computer and for
 * one on another machine. Nothing here outlives a dial: the `--serve` run is sent one line and ends.
 */
import { CHECK_FAILURES } from '../domain/reach'
import { DialError, dialWith, EXIT_KINDS, GATEWAY_PROTOCOL, TICKET_PREFIX, type Clock, type Mint, type ReadHermes } from './link'
import type { Route } from './remote'
import { cantReach, WHOLE_DOWNLOAD_MS, downloadedOf, downloadPath, unminted, type Download } from './download'
import { ASK_INTERACTIVE, askNativeHttp, ATTACH, attachedOf, httpTicketOf, NOT_FOUND, originOf, PROBE, probeOf, runTool, SERVE, servedOf, type HermesArgs, type HttpTicket, type ProbeFailure, type SshRun } from './ssh'
import { askWithTicket, CANT_REACH, CANT_TRANSCRIBE, postWithTicket, transcriptOf, type Transcribe } from './transcribe'

/** How a hermes command runs on the gateway's machine: `runTool` here, `sshExec` on another. */
export type RunHermes = (args: HermesArgs, options: { readonly deadlineMs: number; readonly input?: string }) => Promise<SshRun>

const PROBE_KINDS: Readonly<Record<ProbeFailure, DialError['kind']>> = {
  unreachable: 'unreachable', 'ssh-missing': 'ssh-missing', 'ssh-denied': 'ssh-denied', 'ssh-check': 'ssh-check', 'host-changed': 'host-changed',
  'hermes-not-found': 'hermes-missing', 'hermes-too-old': 'incompatible'
}

const PROBE_MS = 20_000
/** attach's own `--timeout`, plus ssh's ConnectTimeout and room to exit. */
const ATTACH_MS = { start: 90_000, retry: 35_000 } as const
const SERVE_MS = 20_000
const READ_MS = 10_000
const ATTACH_ONLY = { windowsServiceSession: false, interactive: false } as const

export interface MintOptions {
  /** How the words name the gateway's machine. null: this computer, whose failures keep the link's own words. */
  readonly machine: string | null
  /** Client rule 4: turns the gateway's loopback url into one this computer can dial. */
  readonly forward: (url: string) => Promise<string>
  /**
   * What a probe that got no answer means. `'refuse'`: the dial fails with the probe's words, as
   * the setup check does. `'attach'`: the dial goes on with attach alone, the path from before the
   * probe existed (client rule 1).
   */
  readonly unprobed: 'refuse' | 'attach'
}

/**
 * Each dial probes (once per answer), attaches for the gateway's address, and on a Hermes that
 * lists `interactive` asks `--serve` for the ticket that reaches every profile. A Hermes that does
 * not list it, or answers `unsupported_purpose`, is dialed with the ticket attach returned, which
 * reaches one profile. A `--serve` that fails is a `DialError` like any other: once the probe
 * answered, nothing falls back (client rule 1).
 */
export function mintWith(run: RunHermes, options: MintOptions): Mint {
  const { machine } = options
  const failed = (failure: ProbeFailure) => new DialError(PROBE_KINDS[failure], machine === null ? undefined : CHECK_FAILURES[failure].words(machine))
  const ran = async (...asked: Parameters<RunHermes>) => {
    const result = await run(...asked)
    if (!result.ok) throw failed(result.why)
    if (result.code === NOT_FOUND) throw failed('hermes-not-found')
    return result
  }

  let probed: Promise<typeof ATTACH_ONLY | { readonly windowsServiceSession: boolean; readonly interactive: boolean }> | null = null
  /** Only an answer is kept, so a machine that was unreachable is asked again. */
  const probe = () => (probed ??= run(PROBE, { deadlineMs: PROBE_MS }).then(result => {
    const reply = result.ok ? probeOf(result.code, result.stdout) : { ok: false as const, failure: result.why }
    if (reply.ok) return reply
    probed = null
    if (options.unprobed === 'attach') return ATTACH_ONLY
    throw failed(reply.failure)
  }))

  return async ({ start }) => {
    const { windowsServiceSession, interactive } = await probe()
    // Client rule 2: a Windows service session only attaches. A gateway it started would refuse that user's own windows.
    const starts = start && !windowsServiceSession
    const attach = await ran(starts ? ATTACH.start : ATTACH.retry, { deadlineMs: starts ? ATTACH_MS.start : ATTACH_MS.retry })
    if (attach.code !== 0) {
      const kind = EXIT_KINDS[attach.code] ?? 'inaccessible'
      throw kind === 'not-running' && windowsServiceSession && machine !== null
        ? new DialError(kind, `Hermes isn't running on ${machine}. Start it from a normal window on that machine's desktop.`)
        : new DialError(kind)
    }
    const attached = attachedOf(attach.stdout)
    if (attached === null) throw new DialError('incompatible')
    const bound = async () => ({ url: await options.forward(attached.url), protocols: attached.protocols, reach: 'profile' as const })
    if (!interactive) return bound()
    const serve = await ran(SERVE, { deadlineMs: SERVE_MS, input: ASK_INTERACTIVE })
    const served = servedOf(serve.code, serve.stdout)
    if (served.is === 'unsupported') return bound()
    if (served.is === 'failed') throw new DialError(served.kind)
    // Another gateway answered than the one attach found: it was replaced in between. The retry attaches again.
    if (served.instanceId === null || served.instanceId !== attached.instanceId) throw new DialError('dropped')
    return { url: await options.forward(attached.url), protocols: [GATEWAY_PROTOCOL, TICKET_PREFIX + served.ticket], reach: 'host' }
  }
}

const EXIT_AS_LOCATOR: Readonly<Record<'missing' | 'cut', number>> = { missing: NOT_FOUND, cut: 7 }

/**
 * A transcription through the gateway's HTTP routes: `--serve` mints a one-use `native-http`
 * ticket and names the gateway's loopback origin, which `reach` turns into one this computer can
 * dial, and the recording is posted there. A Hermes that mints no such ticket cannot transcribe
 * for Highwing. Nothing is started: with no gateway running, there is nothing to reach.
 */
export function transcribeWith(run: RunHermes, reach: (origin: string) => Promise<string>): Transcribe {
  return async (recording, signal) => {
    const result = await run(SERVE, { deadlineMs: SERVE_MS, input: askNativeHttp() }).catch(() => null)
    if (result === null || !result.ok) return CANT_REACH
    const served = servedOf(result.code, result.stdout)
    if (served.is === 'unsupported') return CANT_TRANSCRIBE
    const origin = originOf(result.stdout)
    if (served.is === 'failed' || origin === null) return CANT_REACH
    try {
      const { status, body } = await postWithTicket(await reach(origin), served.ticket, recording, signal)
      return transcriptOf(status, body)
    } catch {
      return CANT_REACH
    }
  }
}

const profileOf = (path: string): string | undefined => new URL(path, 'http://hermes.invalid').searchParams.get('profile') ?? undefined

/** Mints a one-use `native-http` ticket for `profile`: Hermes's ticket is single use and lives 30 seconds (gateway-ssh-clients.md, client rule 3). */
const ticketFor = (run: RunHermes) => async (profile?: string): Promise<HttpTicket> => {
  const serve = await run(SERVE, { deadlineMs: SERVE_MS, input: askNativeHttp(profile) }).catch(() => null)
  return serve?.ok === true ? httpTicketOf(serve.code, serve.stdout) : { ok: false, why: 'unavailable' }
}

/** A fresh ticket per GET, for the profile the path names, else the one the gateway runs as. */
export function readWith(run: RunHermes, forward: (origin: string) => Promise<string>, fetcher: typeof fetch = fetch): ReadHermes {
  const ticket = ticketFor(run)
  return async path => {
    const minted = await ticket(profileOf(path))
    if (!minted.ok) throw new Error('Hermes minted no ticket for its HTTP API.')
    const response = await fetcher(`${await forward(minted.origin)}${path}`, {
      // Never followed, so the ticket goes only to the address the gateway named.
      redirect: 'manual',
      signal: AbortSignal.timeout(READ_MS),
      headers: { accept: 'application/json', 'x-hermes-gateway-ticket': minted.ticket }
    })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
}

/** A fresh ticket per file, for the file's bot: the route checks `?profile=` against the profile the ticket was minted for. */
export function downloadWith(run: RunHermes, forward: (origin: string) => Promise<string>): Download {
  const ticket = ticketFor(run)
  return async (file, signal) => {
    const minted = await ticket(file.bot)
    if (!minted.ok) return unminted(minted.why, file)
    const deadline = AbortSignal.timeout(WHOLE_DOWNLOAD_MS)
    try {
      const answer = await askWithTicket(new URL(downloadPath(file), await forward(minted.origin)), minted.ticket, {
        method: 'GET', accept: '*/*', signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline])
      })
      const header = (name: string) => {
        const value = answer.headers[name]
        return typeof value === 'string' ? value : null
      }
      return await downloadedOf({ status: answer.statusCode ?? 0, header, body: answer }, file)
    } catch {
      return cantReach(file)
    }
  }
}

/** The gateway of the Hermes on this computer. */
export function liveRoute(options: { readonly hermesBin?: string; readonly clock?: Clock } = {}): Route {
  const { signal } = new AbortController()
  const run: RunHermes = async (args, asked) => {
    const tool = await runTool(options.hermesBin ?? 'hermes', args, { ...asked, signal, ...(options.clock === undefined ? {} : { clock: options.clock }) })
    if (tool.end === 'exit') return { ok: true, code: tool.code, stdout: tool.stdout }
    return { ok: true, code: EXIT_AS_LOCATOR[tool.end], stdout: '' }
  }
  const here = async (url: string) => url
  return {
    dial: dialWith(mintWith(run, { machine: null, forward: here, unprobed: 'attach' })), read: readWith(run, here), transcribe: transcribeWith(run, here), download: downloadWith(run, here),
    dispose: () => {}
  }
}
