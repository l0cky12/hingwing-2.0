import { describe, expect, it } from 'vitest'
import type { GatewayUrl, SshHost, Target } from '../src/domain/reach'
import { currentServer, isPrivateHost, nextServers, rankWays, serverName, serversOf, wayLabel, type Server, type ServerId, type Servers } from '../src/domain/servers'

const id = (text: string) => text as ServerId
const TAILNET: Target = { kind: 'remote', host: 'hermes-host.example-tailnet.ts.net' as SshHost }
const LAN: Target = { kind: 'ssh', host: '192.168.1.20' as SshHost }
const SSH: Target = { kind: 'ssh', host: 'ada@build.example.com' as SshHost }
const WEB: Target = { kind: 'url', url: 'https://hermes.example.com' as GatewayUrl }
const LOCAL: Target = { kind: 'local' }

const server = (name: string, ways: readonly Target[], pick: Server['pick'] = 'fastest'): Server => ({ id: id(name), name, ways: ways as Server['ways'], pick })
const ONE: Servers = { list: [server('hermes-host', [TAILNET])], current: id('hermes-host') }
const TWO_WAYS: Servers = { list: [server('hermes-host', [TAILNET, LAN, WEB])], current: id('hermes-host') }
const TWO: Servers = { list: [server('hermes-host', [TAILNET, LAN]), server('studio', [WEB])], current: id('hermes-host') }

describe('wayLabel', () => {
  const url = (address: string): Target => ({ kind: 'url', url: address as GatewayUrl })

  it.each([
    [TAILNET, 'Tailscale'],
    [LAN, 'LAN'],
    [{ kind: 'ssh', host: 'ada@workshop.local' as SshHost } as const, 'LAN'],
    [SSH, 'SSH'],
    [{ kind: 'ssh', host: 'workshop' as SshHost } as const, 'SSH'],
    [url('http://192.168.1.20:9120'), 'LAN'],
    [url('http://[fd00::20]:9120'), 'LAN'],
    [url('https://hermes-host.example-tailnet.ts.net'), 'Tailscale'],
    [WEB, 'Web'],
    [LOCAL, 'This computer']
  ])('shows %j as %s', (target, label) => {
    expect(wayLabel(target)).toBe(label)
  })
})

describe('isPrivateHost', () => {
  it.each(['10.0.0.4', '172.16.0.1', '172.31.255.254', '192.168.1.20', '169.254.10.1', 'fd00::20', '[fc00::1]', 'fe80::1', 'nas.local', 'printer.lan', 'hub.home.arpa', 'NAS.LOCAL.'])('takes %s for the local network', name => {
    expect(isPrivateHost(name)).toBe(true)
  })

  it.each(['11.0.0.1', '172.15.0.1', '172.32.0.1', '192.169.1.1', '100.101.102.103', '8.8.8.8', '2001:db8::1', 'fd7a.example.com', 'hermes.example.com', 'local', 'lan.example.com'])('takes %s for somewhere else', name => {
    expect(isPrivateHost(name)).toBe(false)
  })
})

describe('rankWays', () => {
  it('in order, dials the ways that answered in priority order and leaves the times out of it', () => {
    expect(rankWays([300, 10, 80], 'order')).toEqual([0, 1, 2])
  })

  it('fastest, dials the lowest time first', () => {
    expect(rankWays([300, 10, 80], 'fastest')).toEqual([1, 2, 0])
  })

  it('fastest, gives a tie to the way higher in priority', () => {
    expect(rankWays([15, 10, 80], 'fastest')).toEqual([0, 1, 2])
    expect(rankWays([16, 10, 80], 'fastest')).toEqual([1, 0, 2])
    expect(rankWays([40, 40, 40], 'fastest')).toEqual([0, 1, 2])
  })

  it.each(['fastest', 'order'] as const)('%s, still dials a way that did not answer, after those that did, in priority order', pick => {
    expect(rankWays([null, 90, null, 20], pick)).toEqual(pick === 'fastest' ? [3, 1, 0, 2] : [1, 3, 0, 2])
    expect(rankWays([null, null], pick)).toEqual([0, 1])
  })

  it('ranks one way, and none', () => {
    expect(rankWays([7], 'fastest')).toEqual([0])
    expect(rankWays([], 'order')).toEqual([])
  })
})

describe('serversOf', () => {
  const raw = JSON.parse(JSON.stringify(TWO)) as unknown

  it('reads what it wrote', () => {
    expect(serversOf(raw)).toEqual(TWO)
    expect(currentServer(TWO).name).toBe('hermes-host')
  })

  it.each([
    ['nothing', null],
    ['no servers', { list: [], current: 'a' }],
    ['a current server that is not listed', { ...TWO, current: 'gone' }],
    ['two servers with one id', { list: [TWO.list[0], TWO.list[0]], current: 'hermes-host' }],
    ['a server with no ways', { list: [{ ...ONE.list[0], ways: [] }], current: 'hermes-host' }],
    ['a server with the same way twice', { list: [{ ...ONE.list[0], ways: [LAN, LAN] }], current: 'hermes-host' }],
    ['a way that is no target', { list: [{ ...ONE.list[0], ways: [{ kind: 'relay' }] }], current: 'hermes-host' }],
    ['a pick it does not know', { list: [{ ...ONE.list[0], pick: 'random' }], current: 'hermes-host' }],
    ['a server with no name', { list: [{ ...ONE.list[0], name: '' }], current: 'hermes-host' }]
  ])('refuses %s', (_what, broken) => {
    expect(serversOf(broken)).toBeNull()
  })
})

describe('nextServers', () => {
  it('makes the first server from a replace or an add when none is saved', () => {
    const first = { list: [{ id: 'new', name: 'hermes-host', ways: [TAILNET], pick: 'fastest' }], current: 'new' }
    expect(nextServers(null, { do: 'replace', target: TAILNET, id: id('new') })).toEqual(first)
    expect(nextServers(null, { do: 'addServer', target: TAILNET, id: id('new') })).toEqual(first)
  })

  it('names a server after its machine, and this computer as the card does', () => {
    expect(serverName(LAN)).toBe('192.168.1.20')
    expect(serverName(WEB)).toBe('hermes.example.com')
    expect(serverName(LOCAL)).toBe('This computer')
  })

  it('replace swaps the current server, in its place, for a new one with only the new way', () => {
    const current = { ...TWO, current: id('studio') }
    expect(nextServers(current, { do: 'replace', target: LOCAL, id: id('new') })).toEqual({
      list: [TWO.list[0], { id: 'new', name: 'This computer', ways: [LOCAL], pick: 'fastest' }], current: 'new'
    })
  })

  it('addServer appends a server and makes it current', () => {
    const next = nextServers(ONE, { do: 'addServer', target: WEB, id: id('new') })
    expect(next?.list.map(held => held.name)).toEqual(['hermes-host', 'hermes.example.com'])
    expect(next?.current).toBe('new')
  })

  it.each(['replace', 'addServer'] as const)('%s refuses an id a server already has', edit => {
    expect(nextServers(TWO, { do: edit, target: LOCAL, id: id('studio') })).toBeNull()
  })

  it('addWay appends to the current server, and leaves the other servers and the name alone', () => {
    const next = nextServers(TWO, { do: 'addWay', target: SSH })
    expect(next).toEqual({ list: [{ ...TWO.list[0], ways: [TAILNET, LAN, SSH] }, TWO.list[1]], current: 'hermes-host' })
  })

  it('addWay changes nothing for a way the server already has, and is refused with no server', () => {
    expect(nextServers(TWO, { do: 'addWay', target: { ...LAN } })).toBe(TWO)
    expect(nextServers(null, { do: 'addWay', target: LAN })).toBeNull()
  })

  it('arrange reorders the ways, cuts them down and sets the pick, and keeps the name', () => {
    expect(nextServers(TWO_WAYS, { do: 'arrange', ways: [WEB, TAILNET, LAN], pick: 'order' })).toEqual({
      list: [{ id: 'hermes-host', name: 'hermes-host', ways: [WEB, TAILNET, LAN], pick: 'order' }], current: 'hermes-host'
    })
    expect(currentServer(nextServers(TWO_WAYS, { do: 'arrange', ways: [LAN], pick: 'fastest' }) as Servers).ways).toEqual([LAN])
  })

  it.each([
    ['no way left', []],
    ['a way the server does not have', [TAILNET, SSH]],
    ['a way twice', [LAN, LAN]]
  ])('arrange refuses %s', (_what, ways) => {
    expect(nextServers(TWO_WAYS, { do: 'arrange', ways, pick: 'fastest' })).toBeNull()
  })

  it('use makes a listed server current, and refuses one that is not listed', () => {
    expect(nextServers(TWO, { do: 'use', server: id('studio') })).toEqual({ ...TWO, current: 'studio' })
    expect(nextServers(TWO, { do: 'use', server: id('hermes-host') })).toBe(TWO)
    expect(nextServers(TWO, { do: 'use', server: id('gone') })).toBeNull()
    expect(nextServers(null, { do: 'use', server: id('studio') })).toBeNull()
  })

  it('remove drops another server, and refuses the current one and one that is not listed', () => {
    expect(nextServers(TWO, { do: 'remove', server: id('studio') })).toEqual({ list: [TWO.list[0]], current: 'hermes-host' })
    expect(nextServers(TWO, { do: 'remove', server: id('hermes-host') })).toBeNull()
    expect(nextServers(TWO, { do: 'remove', server: id('gone') })).toBeNull()
  })

  it('every accepted edit gives servers the parser takes', () => {
    const edits = [
      { do: 'replace', target: LOCAL, id: id('new') }, { do: 'addServer', target: LOCAL, id: id('new') }, { do: 'addWay', target: SSH },
      { do: 'arrange', ways: [LAN], pick: 'order' }, { do: 'use', server: id('studio') }, { do: 'remove', server: id('studio') }
    ] as const
    for (const edit of edits) {
      const next = nextServers(TWO, edit)
      expect(serversOf(JSON.parse(JSON.stringify(next))), edit.do).toEqual(next)
    }
  })
})
