import { URL_PROBLEMS, type GatewayUrl, type SshHost } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { CHOICES, KINDS, textsOf } from '../src/renderer/setup/form'
import { parseCommand } from '../src/ipc-contract'

describe('the choices of the setup form', () => {
  it('are an ssh destination, a web address and this computer, in that order', () => {
    expect(KINDS.map(kind => CHOICES[kind].label)).toEqual(['SSH', 'Web', 'This computer'])
    expect(KINDS.map(kind => CHOICES[kind].field?.label ?? null)).toEqual(['SSH destination', 'Gateway address', null])
  })

  it.each([
    ['ssh', ' ada@hermes-host ', { kind: 'ssh', host: 'ada@hermes-host' }],
    ['ssh', 'hermes-host.example-tailnet.ts.net', { kind: 'ssh', host: 'hermes-host.example-tailnet.ts.net' }],
    ['ssh', ' ada@192.168.1.20 ', { kind: 'ssh', host: 'ada@192.168.1.20' }],
    ['ssh', 'workshop', { kind: 'ssh', host: 'workshop' }],
    ['url', 'hermes.example.com', { kind: 'url', url: 'https://hermes.example.com' }],
    ['url', ' HTTP://Hermes-Host:9120/ ', { kind: 'url', url: 'http://hermes-host:9120' }],
    ['local', 'ignored', { kind: 'local' }]
  ] as const)('read the %s choice with %j typed as a target main accepts', (kind, typed, target) => {
    expect(CHOICES[kind].read(typed)).toEqual({ ok: true, target })
    expect(parseCommand({ do: 'checkTarget', target, into: 'addWay' })).toEqual({ do: 'checkTarget', target, into: 'addWay' })
  })

  it.each([
    ['', 'not-an-address'],
    ['ftp://hermes.example.com', 'not-an-address'],
    ['https://ada:secret@hermes.example.com', 'credentials'],
    ['https://hermes.example.com/?token=abc', 'extras'],
    ['hermes.example.com/#/chat', 'extras']
  ] as const)('say what is wrong with the address %j, and how to fix it', (typed, problem) => {
    expect(CHOICES.url.read(typed)).toEqual({ ok: false, ...URL_PROBLEMS[problem] })
  })

  it('say that text which is no ssh destination is none', () => {
    expect(CHOICES.ssh.read('-oProxyCommand=true')).toEqual({ ok: false, words: "That isn't an SSH destination. Use an address such as 192.168.1.20, or a host in your SSH config.", fix: null })
  })

  it.each(['http://hermes.example.com', 'http://192.168.1.20:9120/hermes', 'HTTP://Hermes.Example.com'])('warn that %s travels unencrypted, naming its host', typed => {
    const host = new URL(typed).hostname
    expect(CHOICES.url.field?.warning(typed)).toBe(
      `This address uses plain http, so your Hermes sign-in and your chats travel unencrypted. Anyone on the network between here and ${host} could read them. Use https if you can.`
    )
    expect(CHOICES.url.read(typed).ok).toBe(true)
  })

  it.each(['', 'hermes.example.com', 'https://hermes.example.com', 'http://127.0.0.1:9120', 'http://localhost:9120', 'http://', 'http://ada:secret@hermes.example.com'])(
    'warn about nothing for %j', typed => {
      expect(CHOICES.url.field?.warning(typed)).toBeNull()
    }
  )

  it('never warn about an ssh destination', () => {
    expect(CHOICES.ssh.field?.warning('http://hermes.example.com')).toBeNull()
  })
})

describe('textsOf', () => {
  it('fills the field of the target being edited, and leaves the others empty', () => {
    const EMPTY = { local: '', ssh: '', url: '' }
    expect(textsOf(undefined)).toEqual(EMPTY)
    expect(textsOf({ kind: 'local' })).toEqual(EMPTY)
    expect(textsOf({ kind: 'remote', host: 'ada@hermes-host' as SshHost }), 'a saved tailnet machine is edited as SSH').toEqual({ ...EMPTY, ssh: 'ada@hermes-host' })
    expect(textsOf({ kind: 'ssh', host: '192.168.1.20' as SshHost })).toEqual({ ...EMPTY, ssh: '192.168.1.20' })
    expect(textsOf({ kind: 'url', url: 'https://hermes.example.com' as GatewayUrl })).toEqual({ ...EMPTY, url: 'https://hermes.example.com' })
  })
})
