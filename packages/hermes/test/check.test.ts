import { describe, expect, it } from 'vitest'
import { CHECK_FAILURES, type CheckFailure, type CheckStep, type SshHost, type Target } from '../src/domain/reach'
import { manualClock } from '../src/testing/clock'
import { FAKE_HOST, SCENARIOS, type FakeHost, type ScenarioName } from '../src/testing/fake-host'
import { checkTarget, peerFailure, tailnetOf, type Peer } from '../src/wire/check'
import type { Clock } from '../src/wire/link'
import { host, until } from './support/host'

const REMOTE: Target = { kind: 'remote', host: FAKE_HOST }

const check = (held: FakeHost, target: Target = REMOTE, life = new AbortController(), clock?: Clock) => {
  const steps: CheckStep[] = []
  const result = checkTarget(target, {
    signal: life.signal, onStep: step => steps.push(step),
    sshBin: held.ssh, tailscaleBin: held.tailscale, hermesBin: held.hermes, ...(clock === undefined ? {} : { clock })
  })
  return { steps, result, life }
}

const status = (stdout: unknown) => ({ end: 'exit', code: 0, stdout: JSON.stringify(stdout), stderr: '' }) as const
const PEER = { DNSName: 'hermes-host.example-tailnet.ts.net.', HostName: 'workstation', TailscaleIPs: ['100.101.102.103', 'fd7a:115c:a1e0::1'], Online: true }

describe('tailnetOf', () => {
  it.each([
    ['no tailscale command', { end: 'missing' }, 'tailscale-missing'],
    ['a command that hung', { end: 'cut', stderr: '' }, 'tailscale-off'],
    ['a daemon that is not running', { end: 'exit', code: 1, stdout: '', stderr: 'failed to connect to local tailscaled' }, 'tailscale-off'],
    ['a stopped backend', status({ BackendState: 'Stopped' }), 'tailscale-off'],
    ['a backend that is still starting', status({ BackendState: 'Starting' }), 'tailscale-off'],
    ['output with no backend state', status({}), 'tailscale-off'],
    ['output that is not an object', status([]), 'tailscale-off'],
    ['a signed-out backend', status({ BackendState: 'NeedsLogin' }), 'tailscale-signed-out']
  ] as const)('reads %s as %s', (_what, run, failure) => {
    expect(tailnetOf(run)).toBe(failure)
  })

  it('lists each peer under every name ssh could be given for it', () => {
    expect(tailnetOf(status({ BackendState: 'Running', Peer: { 'nodekey:a': PEER, 'nodekey:b': { HostName: 'Phone', Online: false } } }))).toEqual([
      { names: ['hermes-host.example-tailnet.ts.net', 'hermes-host', 'workstation', '100.101.102.103', 'fd7a:115c:a1e0::1'], online: true },
      { names: ['phone'], online: false }
    ])
  })

  it('reads a running tailnet with no other machine as an empty list', () => {
    expect(tailnetOf(status({ BackendState: 'Running' }))).toEqual([])
  })
})

describe('peerFailure', () => {
  const peers = tailnetOf(status({ BackendState: 'Running', Peer: { a: PEER, b: { HostName: 'asleep', Online: false } } })) as readonly Peer[]

  it.each(['hermes-host.example-tailnet.ts.net', 'hermes-host', 'Hermes-Host', 'workstation', '100.101.102.103', 'fd7a:115c:a1e0::1'])('finds the machine by %s', name => {
    expect(peerFailure(peers, name)).toBeNull()
  })

  it.each([
    ['hermes', 'host-not-found'], ['example-tailnet.ts.net', 'host-not-found'], ['100.101.102.104', 'host-not-found'], ['asleep', 'host-offline']
  ] as const)('reads %s as %s', (name, failure) => {
    expect(peerFailure(peers, name)).toBe(failure)
  })
})

describe('the scenarios', () => {
  it('give every failure a check can find a scenario that ends in it', () => {
    for (const [failure, { step }] of Object.entries(CHECK_FAILURES)) {
      expect(SCENARIOS[failure as CheckFailure].verdict, failure).toBe(step === 'save' ? null : failure)
    }
  })
})

describe('checkTarget, against the fake host', () => {
  const QUICK = (Object.keys(SCENARIOS) as ScenarioName[]).filter(name => !JSON.stringify(SCENARIOS[name].ssh).includes('never'))
  const STEPS: readonly CheckStep[] = ['tailscale', 'peer', 'ssh', 'hermes']

  it.each(QUICK)('ends the %s scenario in its verdict, at the step that verdict names', async name => {
    const { verdict } = SCENARIOS[name]
    const { result, steps } = check(await host(name))
    expect(await result).toEqual(verdict === null ? { ok: true } : { ok: false, failure: verdict })
    expect(steps).toEqual(verdict === null ? STEPS : STEPS.slice(0, STEPS.indexOf(CHECK_FAILURES[verdict].step) + 1))
  })

  it.each(['slow', 'ssh-check'] as const)('reads the %s scenario from what ssh wrote before its deadline, and kills it', async name => {
    const clock = manualClock()
    const held = await host(name)
    const { result, steps } = check(held, REMOTE, new AbortController(), clock)
    await until('ssh to say all it will', () => steps.includes('ssh') && held.running().length === 1 && held.printed === 2)
    await clock.advance(19_999)
    expect(held.running()).toHaveLength(1)
    await clock.advance(1)
    expect(await result).toEqual({ ok: false, failure: SCENARIOS[name].verdict })
    await until('the hung ssh to end', () => held.running().length === 0)
  })

  it('passes the whole name to ssh and looks up only the part after the user', async () => {
    const held = await host('ok')
    const { result } = check(held, { kind: 'remote', host: `ada@${FAKE_HOST}` as SshHost })
    expect(await result).toEqual({ ok: true })
    expect(held.calls).toEqual(['gateway tickets --probe --json'])
  })

  it('refuses a machine the tailnet does not list before it runs ssh', async () => {
    const held = await host('ok')
    const { result, steps } = check(held, { kind: 'remote', host: 'other-host' as SshHost })
    expect(await result).toEqual({ ok: false, failure: 'host-not-found' })
    expect(steps).toEqual(['tailscale', 'peer'])
    expect(held.calls).toEqual([])
  })

  it('starts nothing: it runs the probe once and never an attach', async () => {
    const held = await host('ok')
    await check(held).result
    expect(held.calls).toEqual(['gateway tickets --probe --json'])
  })

  it('ends its command when the check is cancelled', async () => {
    const held = await host('ok', null, 'ssh')
    const { result, life } = check(held)
    await until('the probe to wait', () => held.calls.length === 1)
    life.abort()
    await result
    await until('the held ssh to end', () => held.running().length === 0)
  })
})

describe('checkTarget, for this computer', () => {
  const LOCAL: Target = { kind: 'local' }

  it.each([
    ['ok', { ok: true }], ['hermes-not-found', { ok: false, failure: 'hermes-not-found' }], ['hermes-too-old', { ok: false, failure: 'hermes-too-old' }]
  ] as const)('runs only the hermes step in the %s scenario', async (name, verdict) => {
    const { result, steps } = check(await host(name), LOCAL)
    expect(await result).toEqual(verdict)
    expect(steps).toEqual(['hermes'])
  })

  it('needs neither Tailscale nor ssh', async () => {
    const { result } = check(await host('tailscale-missing'), LOCAL)
    expect(await result).toEqual({ ok: true })
    expect(await check(await host('ssh-missing'), LOCAL).result).toEqual({ ok: true })
  })
})
