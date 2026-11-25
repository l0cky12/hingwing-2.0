import { byKind, CHECK_FAILURES, hostPart, type CheckFailure, type CheckStep, type SshHost, type Target } from '../domain/reach'
import type { Clock } from './link'
import { PROBE, probeHermes, probeOf, runTool, type Probe, type ToolRun } from './ssh'

export type CheckResult = { readonly ok: true } | { readonly ok: false; readonly failure: CheckFailure }

export interface CheckOptions {
  /** Ends the commands of a check that was replaced or cancelled. Its result then means nothing. */
  readonly signal: AbortSignal
  /** Called as each step begins, in order. */
  readonly onStep: (step: CheckStep) => void
  readonly sshBin?: string
  readonly tailscaleBin?: string
  readonly hermesBin?: string
  readonly clock?: Clock
}

const TAILSCALE_MS = 10_000
const PROBE_MS = 20_000

/** A machine of the tailnet other than this one, by every name ssh could be given for it. */
export interface Peer {
  /** The MagicDNS name, its short form and the Tailscale IPs: unique on a tailnet. */
  readonly names: readonly string[]
  /** The machine's own hostname, which two machines can share. Matched only when no peer has the name above. */
  readonly alias: string | null
  readonly online: boolean
}

type Obj = Readonly<Record<string, unknown>>
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)
const texts = (values: readonly unknown[]) => values.filter((value): value is string => typeof value === 'string' && value !== '')

function peerOf(raw: Obj): Peer {
  const dns = typeof raw.DNSName === 'string' ? raw.DNSName.replace(/\.$/, '') : ''
  const names = texts([dns, dns.split('.')[0], ...(Array.isArray(raw.TailscaleIPs) ? raw.TailscaleIPs : [])])
  const alias = typeof raw.HostName === 'string' && raw.HostName !== '' ? raw.HostName.toLowerCase() : null
  return { names: names.map(name => name.toLowerCase()), alias, online: raw.Online === true }
}

/** Reads `tailscale status --json`. The key names were measured on Tailscale 1.104. */
export function tailnetOf(run: ToolRun): readonly Peer[] | 'tailscale-missing' | 'tailscale-off' | 'tailscale-signed-out' {
  if (run.end === 'missing') return 'tailscale-missing'
  if (run.end === 'cut') return 'tailscale-off'
  let status: unknown
  try {
    status = JSON.parse(run.stdout)
  } catch {
    return 'tailscale-off'
  }
  if (!isObject(status) || status.BackendState === undefined) return 'tailscale-off'
  if (status.BackendState === 'NeedsLogin') return 'tailscale-signed-out'
  if (status.BackendState !== 'Running') return 'tailscale-off'
  return isObject(status.Peer) ? Object.values(status.Peer).filter(isObject).map(peerOf) : []
}

export function peerFailure(peers: readonly Peer[], name: string): 'host-not-found' | 'host-offline' | null {
  const wanted = name.toLowerCase().replace(/\.$/, '')
  const peer = peers.find(({ names }) => names.includes(wanted)) ?? peers.find(({ alias }) => alias === wanted)
  if (peer === undefined) return 'host-not-found'
  return peer.online ? null : 'host-offline'
}

const verdict = (probe: Probe): CheckResult => (probe.ok ? { ok: true } : { ok: false, failure: probe.failure })

async function checkRemote(host: SshHost, options: CheckOptions): Promise<CheckResult> {
  const { onStep } = options
  onStep('tailscale')
  const tailnet = tailnetOf(await runTool(options.tailscaleBin ?? 'tailscale', ['status', '--json'], { ...options, deadlineMs: TAILSCALE_MS }))
  if (typeof tailnet === 'string') return { ok: false, failure: tailnet }
  onStep('peer')
  const absent = peerFailure(tailnet, hostPart(host))
  if (absent !== null) return { ok: false, failure: absent }
  onStep('ssh')
  const probe = await probeHermes(host, { ...options, deadlineMs: PROBE_MS })
  if (probe.ok || CHECK_FAILURES[probe.failure].step === 'hermes') onStep('hermes')
  return verdict(probe)
}

async function checkLocal(options: CheckOptions): Promise<CheckResult> {
  options.onStep('hermes')
  const run = await runTool(options.hermesBin ?? 'hermes', PROBE, { ...options, deadlineMs: PROBE_MS })
  if (run.end === 'missing') return { ok: false, failure: 'hermes-not-found' }
  return verdict(run.end === 'cut' ? { ok: false, failure: 'hermes-too-old' } : probeOf(run.code, run.stdout))
}

/**
 * Whether Highwing can reach Hermes at `target`, one step at a time, stopping at the first that
 * fails. A remote target needs Tailscale to list the machine, ssh to reach it and a Hermes there
 * that knows the SSH client contract. This computer needs only that Hermes. Starts nothing and
 * contacts no gateway.
 */
export function checkTarget(target: Target, options: CheckOptions): Promise<CheckResult> {
  return byKind(target, { local: () => checkLocal(options), remote: ({ host }) => checkRemote(host, options) })
}
