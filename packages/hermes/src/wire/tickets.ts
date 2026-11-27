/**
 * Where a socket's ticket comes from: client rules 1 to 4 of Hermes's SSH client contract
 * (website/docs/developer-guide/gateway-ssh-clients.md), for the Hermes on this computer and for
 * one on another machine. Nothing here outlives a dial: the `--serve` run is sent one line and ends.
 */
import { CHECK_FAILURES } from '../domain/reach'
import { DialError, dialWith, EXIT_KINDS, GATEWAY_PROTOCOL, TICKET_PREFIX, type Clock, type Dialer, type Mint } from './link'
import { ASK_INTERACTIVE, ASK_NATIVE_HTTP, ATTACH, attachedOf, NOT_FOUND, originOf, PROBE, probeOf, runTool, SERVE, servedOf, type HermesArgs, type ProbeFailure, type SshRun } from './ssh'
import { CANT_REACH, CANT_TRANSCRIBE, postWithTicket, transcriptOf, type Transcribe } from './transcribe'

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
    const result = await run(SERVE, { deadlineMs: SERVE_MS, input: ASK_NATIVE_HTTP }).catch(() => null)
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

type LocalOptions = { readonly hermesBin?: string; readonly clock?: Clock }

function localRun(options: LocalOptions): RunHermes {
  const { signal } = new AbortController()
  return async (args, asked) => {
    const tool = await runTool(options.hermesBin ?? 'hermes', args, { ...asked, signal, ...(options.clock === undefined ? {} : { clock: options.clock }) })
    if (tool.end === 'exit') return { ok: true, code: tool.code, stdout: tool.stdout }
    return { ok: true, code: EXIT_AS_LOCATOR[tool.end], stdout: '' }
  }
}

/** The gateway of the Hermes on this computer. */
export function liveDialer(options: LocalOptions = {}): Dialer {
  return dialWith(mintWith(localRun(options), { machine: null, forward: async url => url, unprobed: 'attach' }))
}

/** Speech to text by the Hermes on this computer, whose loopback origin this computer dials as it is. */
export function liveTranscribe(options: LocalOptions = {}): Transcribe {
  return transcribeWith(localRun(options), async origin => origin)
}
