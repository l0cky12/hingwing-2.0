import { describe, expect, it } from 'vitest'
import { CHECK_FAILURES, machineOf, parseSshHost, STEP_WORDS, targetOf, type CheckStep, type SshHost } from '../src/domain/reach'
import { isPlainHttp, parseGatewayUrl, sameTarget, URL_PROBLEMS, type GatewayUrl } from '../src/domain/reach'

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

describe('sameTarget', () => {
  it.each([
    [{ kind: 'local' } as const, { kind: 'local' } as const, true],
    [remote('hermes-host'), remote('hermes-host'), true],
    [remote('hermes-host'), remote('ada@hermes-host'), false],
    [remote('hermes-host'), remote('other-host'), false],
    [{ kind: 'local' } as const, remote('hermes-host'), false],
    [remote('hermes-host'), { kind: 'local' } as const, false]
  ])('compares %j with %j as %s', (a, b, same) => {
    expect(sameTarget(a, b)).toBe(same)
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

const gatewayUrl = (text: string): GatewayUrl => {
  const parsed = parseGatewayUrl(text)
  if (!parsed.ok) throw new Error(`${text} is ${parsed.problem}`)
  return parsed.url
}

describe('parseGatewayUrl', () => {
  it.each([
    ['hermes.example.com', 'https://hermes.example.com'],
    ['  HTTPS://Hermes.Example.COM:443/ ', 'https://hermes.example.com'],
    ['https://hermes.example.com/', 'https://hermes.example.com'],
    ['http://hermes-host:80', 'http://hermes-host'],
    ['https://hermes.example.com:8443', 'https://hermes.example.com:8443'],
    ['localhost:9120', 'https://localhost:9120'],
    ['box.example/hermes/', 'https://box.example/hermes'],
    ['https://box.example/proxied/hermes//', 'https://box.example/proxied/hermes'],
    ['http://[FD7A:115C:A1E0:0:0:0:0:1]:9120/', 'http://[fd7a:115c:a1e0::1]:9120'],
    ['[::1]:9120', 'https://[::1]:9120']
  ])('reads %j as %s', (text, url) => {
    expect(parseGatewayUrl(text)).toEqual({ ok: true, url })
  })

  it('gives every spelling of one gateway the same string, and keeps that string as it is', () => {
    const spellings = ['Hermes.Example.com/hermes', 'https://hermes.example.com:443/hermes/', 'HTTPS://HERMES.EXAMPLE.COM/hermes']
    const urls = new Set(spellings.map(gatewayUrl))
    expect([...urls]).toEqual(['https://hermes.example.com/hermes'])
    expect(gatewayUrl('https://hermes.example.com/hermes')).toBe('https://hermes.example.com/hermes')
  })

  it('tells two gateways apart by scheme, port and path', () => {
    const urls = ['https://box.example', 'http://box.example', 'https://box.example:8443', 'https://box.example/hermes'].map(gatewayUrl)
    expect(new Set(urls).size).toBe(4)
  })

  it('keeps an address of 2048 characters and refuses a longer one', () => {
    const at = (length: number) => `https://box.example/${'p'.repeat(length - 'https://box.example/'.length)}`
    expect(parseGatewayUrl(at(2048))).toEqual({ ok: true, url: at(2048) })
    expect(parseGatewayUrl(at(2049))).toEqual({ ok: false, problem: 'not-an-address' })
  })

  it.each([
    ['nothing', '', 'not-an-address'],
    ['another scheme', 'ftp://box.example', 'not-an-address'],
    ['a script', 'javascript:alert(1)', 'not-an-address'],
    ['no host', 'https://', 'not-an-address'],
    ['port 0', 'https://box.example:0', 'not-an-address'],
    ['a port past 65535', 'https://box.example:65536', 'not-an-address'],
    ['a space in the name', 'hermes host', 'not-an-address'],
    ['a username and password', 'https://ada:secret@box.example', 'credentials'],
    ['a username', 'ada@box.example', 'credentials'],
    ['a query', 'https://box.example/?token=abc', 'extras'],
    ['an empty query', 'https://box.example/?', 'extras'],
    ['a fragment', 'box.example/#/chat', 'extras'],
    ['an empty fragment', 'https://box.example#', 'extras']
  ])('refuses %s', (_what, text, problem) => {
    expect(parseGatewayUrl(text)).toEqual({ ok: false, problem })
  })

  it('gives every problem a sentence and a different sentence to try', () => {
    for (const [problem, { words, fix }] of Object.entries(URL_PROBLEMS)) {
      expect(words, problem).toMatch(/^[A-Z].+\.$/)
      expect(fix, problem).toMatch(/^[A-Z].+\.$/)
      expect(fix, problem).not.toBe(words)
    }
  })
})

describe('isPlainHttp', () => {
  it.each(['http://192.168.1.20:9120', 'http://hermes-host:9120', 'http://hermes.example.com', 'http://[fd7a:115c:a1e0::1]'])(
    'takes plain http to %s, and says it is plain', text => {
      expect(isPlainHttp(gatewayUrl(text))).toBe(true)
    }
  )

  it.each(['http://127.0.0.1:9120', 'http://127.4.5.6', 'http://localhost:9120', 'http://LOCALHOST', 'http://[::1]:9120', 'https://192.168.1.20', 'hermes.example.com'])(
    'does not call %s plain', text => {
      expect(isPlainHttp(gatewayUrl(text))).toBe(false)
    }
  )
})
