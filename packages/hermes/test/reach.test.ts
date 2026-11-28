import { describe, expect, it } from 'vitest'
import { CHECK_FAILURES, machineOf, parseSshHost, STEP_WORDS, targetOf, type CheckStep, type SshHost } from '../src/domain/reach'
import { isPlainHttp, parseGatewayUrl, sameTarget, URL_PROBLEMS, type GatewayUrl } from '../src/domain/reach'
import { failureOf, gatewayHost, URL_FAILURES } from '../src/domain/reach'
import { byKind, firstStep, onThisComputer, type Target } from '../src/domain/reach'

const remote = (host: string) => ({ kind: 'remote', host: host as SshHost }) as const
const LAN = { kind: 'ssh', host: '192.168.1.20' as SshHost } as const

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
  const ORDER: readonly CheckStep[] = ['tailscale', 'peer', 'ssh', 'hermes', 'sign-in', 'gateway', 'save']

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
    ['[::1]:9120', 'https://[::1]:9120'],
    ['https:/box.example', 'https://box.example'],
    ['https://box.example/%7ehermes/%2f', 'https://box.example/~hermes/%2F']
  ])('reads %j as %s', (text, url) => {
    expect(parseGatewayUrl(text)).toEqual({ ok: true, url })
  })

  it('gives every spelling of one gateway the same string, and keeps that string as it is', () => {
    const spellings = ['Hermes.Example.com/hermes', 'https://hermes.example.com:443/hermes/', 'HTTPS://HERMES.EXAMPLE.COM/hermes']
    const urls = new Set(spellings.map(gatewayUrl))
    expect([...urls]).toEqual(['https://hermes.example.com/hermes'])
    expect(gatewayUrl('https://hermes.example.com/hermes')).toBe('https://hermes.example.com/hermes')
  })

  it.each(['https://box.example/%7ehermes/%2f', 'https://box.example/a%20b', 'https://box.example/%25'])('reads its own canonical form of %j back unchanged', text => {
    const url = gatewayUrl(text)
    expect(gatewayUrl(url)).toBe(url)
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
    ['a stray percent sign', 'https://box.example/%%34%31', 'not-an-address'],
    ['another scheme with one slash', 'ftp:/box.example', 'not-an-address'],
    ['over 2048 characters before the slashes are dropped', `https://box.example${'/'.repeat(2048)}`, 'not-an-address'],
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

describe('the words of a check by address', () => {
  const ORDER = Object.keys(STEP_WORDS)

  it('give every failure a sentence and a different sentence to try', () => {
    for (const [failure, { words, fix }] of Object.entries(URL_FAILURES)) {
      expect(words('hermes.example.com'), failure).toMatch(/^[A-Z].+\.$/)
      expect(fix('hermes.example.com'), failure).toMatch(/^[A-Z].+\.$/)
      expect(fix('hermes.example.com'), failure).not.toBe(words('hermes.example.com'))
    }
  })

  it('name the gateway by the host of its address, in the words the design gives', () => {
    const gateway = gatewayHost(gatewayUrl('https://Hermes.Example.com:8443/hermes'))
    expect(gateway).toBe('hermes.example.com')
    expect(STEP_WORDS['sign-in'](gateway)).toBe('Waiting for you to sign in to hermes.example.com in your browser')
    expect(STEP_WORDS.gateway(gateway)).toBe('Opening the Hermes gateway on hermes.example.com')
    expect(URL_FAILURES.dashboard.words(gateway)).toBe("What answers at hermes.example.com is the Hermes dashboard, which Highwing can't chat through.")
    expect(URL_FAILURES['sign-in-timed-out'].words(gateway)).toBe("You didn't finish signing in to hermes.example.com within 10 minutes.")
    expect(URL_FAILURES['url-no-socket'].fix(gateway)).toBe('If a proxy or tunnel serves this address, let it pass WebSocket connections through to Hermes.')
  })

  it('list the failures in the order their steps run, and only at the steps of an address', () => {
    const steps = Object.values(URL_FAILURES).map(({ step }) => step)
    expect(steps.map(step => ORDER.indexOf(step))).toEqual(steps.map(step => ORDER.indexOf(step)).sort((a, b) => a - b))
    expect([...new Set(steps)]).toEqual(['hermes', 'sign-in', 'gateway'])
  })

  it('share no name with a failure of the other checks, so one lookup serves the setup screen', () => {
    expect(Object.keys(URL_FAILURES).filter(failure => failure in CHECK_FAILURES)).toEqual([])
    expect(failureOf('url-legacy')).toBe(URL_FAILURES['url-legacy'])
    expect(failureOf('hermes-too-old')).toBe(CHECK_FAILURES['hermes-too-old'])
    expect(failureOf('cant-save').step).toBe('save')
  })
})

describe('a target that is a gateway address', () => {
  const at = (text: string): Target => ({ kind: 'url', url: gatewayUrl(text) })
  const HERE = at('https://hermes.example.com')

  it.each(['https://hermes.example.com', 'http://hermes-host:9120', 'https://box.example:8443/proxied/hermes', 'http://[fd7a:115c:a1e0::1]:9120', 'https://box.example/~hermes/%2F'])(
    'reads %s back from the JSON the settings file holds, and keeps nothing else', url => {
      const saved: unknown = JSON.parse(JSON.stringify({ ...at(url), token: 'never kept' }))
      expect(targetOf(saved)).toEqual({ kind: 'url', url })
    }
  )

  it.each([
    ['no address', { kind: 'url' }],
    ['an address that is no text', { kind: 'url', url: 7 }],
    ['a host in place of the address', { kind: 'url', host: 'hermes.example.com' }],
    ['another scheme', { kind: 'url', url: 'ftp://box.example' }],
    ['a script', { kind: 'url', url: 'javascript:alert(1)' }],
    ['a username and password', { kind: 'url', url: 'https://ada:secret@box.example' }],
    ['a query, which can hold a sign-in secret', { kind: 'url', url: 'https://box.example/?token=abc' }],
    ['a fragment', { kind: 'url', url: 'https://box.example#chat' }],
    ['an address with no scheme', { kind: 'url', url: 'hermes.example.com' }],
    ['a trailing slash', { kind: 'url', url: 'https://hermes.example.com/' }],
    ['the default port', { kind: 'url', url: 'https://hermes.example.com:443' }],
    ['capital letters in the host', { kind: 'url', url: 'https://Hermes.Example.com' }],
    ['spaces around the address', { kind: 'url', url: ' https://hermes.example.com ' }],
    ['an address over 2048 characters', { kind: 'url', url: `https://box.example/${'p'.repeat(2048)}` }]
  ])('refuses %s', (_what, raw) => {
    expect(targetOf(raw)).toBeNull()
  })

  it.each([
    [HERE, at('hermes.example.com:443/'), true],
    [HERE, at('https://other.example.com'), false],
    [HERE, at('http://hermes.example.com'), false],
    [HERE, at('https://hermes.example.com:8443'), false],
    [HERE, at('https://hermes.example.com/hermes'), false],
    [HERE, remote('hermes.example.com'), false],
    [remote('hermes.example.com'), HERE, false],
    [HERE, { kind: 'local' } as const, false],
    [{ kind: 'local' } as const, HERE, false]
  ])('compares %j with %j as %s', (a, b, same) => {
    expect(sameTarget(a, b)).toBe(same)
  })

  it.each([
    [HERE, 'hermes.example.com'],
    [at('http://hermes-host:9120/hermes'), 'hermes-host'],
    [at('https://100.101.102.103:8443'), '100.101.102.103'],
    [at('http://[fd7a:115c:a1e0::1]:9120'), '[fd7a:115c:a1e0::1]']
  ])('names %j by the host of its address, %s', (target, name) => {
    expect(machineOf(target)).toBe(name)
  })

  it('starts its check at Hermes, and is never taken for this computer', () => {
    expect(firstStep(HERE)).toBe('hermes')
    expect(onThisComputer(HERE)).toBe(false)
    expect(onThisComputer(at('http://127.0.0.1:9120'))).toBe(false)
  })

  it('is one of four kinds, and byKind hands each kind to its own branch', () => {
    const branch = (target: Target) => byKind(target, { local: () => 'local', remote: ({ host }) => `remote ${host}`, ssh: ({ host }) => `ssh ${host}`, url: ({ url }) => `url ${url}` })
    expect([{ kind: 'local' } as const, remote('hermes-host'), LAN, HERE].map(branch)).toEqual(['local', 'remote hermes-host', 'ssh 192.168.1.20', 'url https://hermes.example.com'])
  })
})

describe('an ssh destination', () => {
  it('is read from a saved file with its host as ssh takes it', () => {
    expect(targetOf({ kind: 'ssh', host: ' ada@192.168.1.20 ' })).toEqual({ kind: 'ssh', host: 'ada@192.168.1.20' })
    expect(targetOf({ kind: 'ssh', host: '-oProxyCommand=true' })).toBeNull()
  })

  it('is another way than the tailnet machine of the same name', () => {
    expect(sameTarget(LAN, { kind: 'ssh', host: '192.168.1.20' as SshHost })).toBe(true)
    expect(sameTarget(LAN, remote('192.168.1.20'))).toBe(false)
    expect(sameTarget(remote('192.168.1.20'), LAN)).toBe(false)
  })

  it('is named as a tailnet machine is, starts its check at ssh, and is never taken for this computer', () => {
    expect(machineOf(LAN)).toBe('192.168.1.20')
    expect(machineOf({ kind: 'ssh', host: 'ada@workshop.lan' as SshHost })).toBe('workshop')
    expect(firstStep(LAN)).toBe('ssh')
    expect(onThisComputer(LAN)).toBe(false)
  })
})
