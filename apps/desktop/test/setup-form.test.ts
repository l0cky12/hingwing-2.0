import { URL_PROBLEMS, type GatewayUrl, type SshHost } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { CHOICES, KINDS, textsOf } from '../src/renderer/setup/form'
import { parseCommand } from '../src/ipc-contract'

describe('the choices of the setup form', () => {
  it('are another machine, a web address and this computer, in that order', () => {
    expect(KINDS.map(kind => CHOICES[kind].label)).toEqual(['Tailnet machine', 'Web address', 'This computer'])
    expect(KINDS.map(kind => CHOICES[kind].field?.label ?? null)).toEqual(['Hermes machine', 'Gateway address', null])
  })

  it.each([
    ['remote', ' ada@hermes-host ', { kind: 'remote', host: 'ada@hermes-host' }],
    ['url', 'hermes.example.com', { kind: 'url', url: 'https://hermes.example.com' }],
    ['url', ' HTTP://Hermes-Host:9120/ ', { kind: 'url', url: 'http://hermes-host:9120' }],
    ['local', 'ignored', { kind: 'local' }]
  ] as const)('read the %s choice with %j typed as a target main accepts', (kind, typed, target) => {
    expect(CHOICES[kind].read(typed)).toEqual({ ok: true, target })
    expect(parseCommand({ do: 'checkTarget', target })).toEqual({ do: 'checkTarget', target })
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

  it('say that text which is no machine name is none', () => {
    expect(CHOICES.remote.read('hermes host')).toEqual({ ok: false, words: "That isn't a machine name. Use the name Tailscale lists, such as hermes-host.", fix: null })
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

  it('never warn about a machine name', () => {
    expect(CHOICES.remote.field?.warning('http://hermes.example.com')).toBeNull()
  })
})

describe('textsOf', () => {
  it('fills the field of the target being edited, and leaves the others empty', () => {
    expect(textsOf(undefined)).toEqual({ local: '', remote: '', url: '' })
    expect(textsOf({ kind: 'local' })).toEqual({ local: '', remote: '', url: '' })
    expect(textsOf({ kind: 'remote', host: 'ada@hermes-host' as SshHost })).toEqual({ local: '', remote: 'ada@hermes-host', url: '' })
    expect(textsOf({ kind: 'url', url: 'https://hermes.example.com' as GatewayUrl })).toEqual({ local: '', remote: '', url: 'https://hermes.example.com' })
  })
})
