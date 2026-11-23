import { describe, expect, it } from 'vitest'
import { CHECK_FAILURES, machineOf, parseSshHost, STEP_WORDS, targetOf, type CheckStep, type SshHost } from '../src/domain/reach'

const remote = (host: string) => ({ kind: 'remote', host: host as SshHost }) as const

describe('parseSshHost', () => {
  it.each([
    'hermes-host', 'hermes-host.example-tailnet.ts.net', 'ada@hermes-host', 'deploy_1@hermes-host.example-tailnet.ts.net',
    '100.101.102.103', 'fd7a:115c:a1e0::1', 'HERMES-HOST'
  ])('takes %s as it is', host => {
    expect(parseSshHost(host)).toBe(host)
  })

  it('drops the spaces around a name', () => {
    expect(parseSshHost('  hermes-host \n')).toBe('hermes-host')
  })

  it.each([
    ['nothing', ''],
    ['an ssh option', '-oProxyCommand=true'],
    ['an option after the user', 'ada@-oProxyCommand=true'],
    ['a user that is an option', '-l@hermes-host'],
    ['two names', 'hermes-host other-host'],
    ['a shell word', 'hermes-host;true'],
    ['a command substitution', '$(true)'],
    ['a user and no name', 'ada@'],
    ['a name longer than DNS allows', 'h'.repeat(254)]
  ])('refuses %s', (_what, host) => {
    expect(parseSshHost(host)).toBeNull()
  })
})

describe('targetOf', () => {
  it('reads the two kinds and keeps nothing else', () => {
    expect(targetOf({ kind: 'local', host: 'ignored' })).toEqual({ kind: 'local' })
    expect(targetOf({ kind: 'remote', host: ' hermes-host ', port: 22 })).toEqual(remote('hermes-host'))
  })

  it.each([
    null, 'local', [], {}, { kind: 'cloud' }, { kind: 'remote' }, { kind: 'remote', host: 7 }, { kind: 'remote', host: '-oProxyCommand=true' }
  ])('refuses %j', raw => {
    expect(targetOf(raw)).toBeNull()
  })
})

describe('machineOf', () => {
  it.each([
    [{ kind: 'local' } as const, 'this computer'],
    [remote('hermes-host.example-tailnet.ts.net'), 'hermes-host'],
    [remote('ada@hermes-host.example-tailnet.ts.net'), 'hermes-host'],
    [remote('hermes-host'), 'hermes-host'],
    [remote('100.101.102.103'), '100.101.102.103'],
    [remote('ada@fd7a:115c:a1e0::1'), 'fd7a:115c:a1e0::1']
  ])('names %j as %s', (target, name) => {
    expect(machineOf(target)).toBe(name)
  })
})

describe('the words of a check', () => {
  const ORDER: readonly CheckStep[] = ['tailscale', 'peer', 'ssh', 'hermes', 'save']

  it('give every failure a sentence and a different sentence to try', () => {
    for (const [failure, { words, fix }] of Object.entries(CHECK_FAILURES)) {
      expect(words('hermes-host'), failure).toMatch(/^[A-Z].+\.$/)
      expect(fix('hermes-host'), failure).toMatch(/^[A-Z].+\.$/)
      expect(fix('hermes-host'), failure).not.toBe(words('hermes-host'))
    }
  })

  it('name the machine that failed, in the words the design gives', () => {
    expect(CHECK_FAILURES['tailscale-off'].words('hermes-host')).toBe("Tailscale isn't running on this computer.")
    expect(CHECK_FAILURES['host-not-found'].words('hermes-host')).toBe('No machine called hermes-host is on your tailnet.')
    expect(CHECK_FAILURES['hermes-not-found'].words('hermes-host')).toBe("Hermes isn't installed on hermes-host.")
    expect(CHECK_FAILURES['hermes-not-found'].words('this computer')).toBe("Hermes isn't installed on this computer.")
  })

  it('list the failures in the order their steps run', () => {
    const steps = Object.values(CHECK_FAILURES).map(({ step }) => ORDER.indexOf(step))
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
    expect(Object.keys(STEP_WORDS)).toEqual(ORDER)
  })
})
