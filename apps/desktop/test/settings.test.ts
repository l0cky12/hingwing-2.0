import { nextServers, type ServerId, type Servers, type SshHost, type Target } from '@highwing/hermes/domain'
import type { GatewayUrl } from '@highwing/hermes/domain'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadSettings, parseSettings, saveSettings, SETTINGS_FILE } from '../src/main/settings'
import { oneServer, SERVER } from './support/live'

const REMOTE: Target = { kind: 'remote', host: 'hermes-host.example-tailnet.ts.net' as SshHost }
const LAN: Target = { kind: 'ssh', host: '192.168.1.20' as SshHost }
const LOCAL: Target = { kind: 'local' }
const GATEWAY: Target = { kind: 'url', url: 'https://hermes.example.com:8443/hermes' as GatewayUrl }
/** Two servers: the first with two ways in and its own pick, the second current. */
const TWO: Servers = {
  list: [{ id: SERVER, name: 'hermes-host', ways: [REMOTE, LAN], pick: 'order' }, { id: 'server-2' as ServerId, name: 'hermes.example.com', ways: [GATEWAY], pick: 'fastest' }],
  current: 'server-2' as ServerId
}
const text = (value: unknown) => JSON.stringify(value)
const version2 = ({ list, current }: Servers) => text({ version: 2, current, servers: list })
/** What a version 1 file reads as: one server under the place version 1 kept its unread marks. */
const upgraded = (target: Target, name: string) => ({ state: 'saved', servers: { list: [{ id: text(target), name, ways: [target], pick: 'fastest' }], current: text(target) } })
const emptyDir = () => mkdtempSync(join(tmpdir(), 'highwing-settings-'))
const dirWith = (content: string) => {
  const dir = emptyDir()
  writeFileSync(join(dir, SETTINGS_FILE), content)
  return dir
}

describe('parseSettings', () => {
  it.each([
    ['no file', null, { state: 'none' }],
    ['one server with one way', version2(oneServer(REMOTE)), { state: 'saved', servers: oneServer(REMOTE) }],
    ['two servers, several ways and a pick', version2(TWO), { state: 'saved', servers: TWO }],
    ['keys this build does not know', text({ version: 2, current: SERVER, servers: [{ ...oneServer(LAN).list[0], color: 'plum' }], theme: 'dark' }), { state: 'saved', servers: oneServer(LAN) }],
    ['a version 1 remote target', text({ version: 1, target: REMOTE }), upgraded(REMOTE, 'hermes-host')],
    ['a version 1 file for this computer', text({ version: 1, target: LOCAL }), upgraded(LOCAL, 'This computer')],
    ['a version 1 gateway address', text({ version: 1, target: GATEWAY }), upgraded(GATEWAY, 'hermes.example.com')],
    ['a version 1 target with keys this build does not know', text({ version: 1, target: { ...REMOTE, port: 22 }, theme: 'dark' }), upgraded(REMOTE, 'hermes-host')],
    ['a later version', text({ version: 3, servers: [{ kind: 'relay', via: 'somewhere' }] }), { state: 'newer' }],
    ['a later version whose servers this build could read', version2(TWO).replace('"version":2', '"version":7'), { state: 'newer' }],
    ['an empty file', '', { state: 'unreadable' }],
    ['half a file', '{"version": 2, "servers": [{"id": "ser', { state: 'unreadable' }],
    ['JSON that is not an object', '7', { state: 'unreadable' }],
    ['no version', text({ target: REMOTE }), { state: 'unreadable' }],
    ['a version of the wrong type', text({ version: '1', target: REMOTE }), { state: 'unreadable' }],
    ['version zero', text({ version: 0, target: REMOTE }), { state: 'unreadable' }],
    ['version 1 with no target', text({ version: 1 }), { state: 'unreadable' }],
    ['version 1 holding version 2 servers', version2(TWO).replace('"version":2', '"version":1'), { state: 'unreadable' }],
    ['version 2 holding a version 1 target', text({ version: 2, target: REMOTE }), { state: 'unreadable' }],
    ['no servers', text({ version: 2, current: SERVER, servers: [] }), { state: 'unreadable' }],
    ['a current server that is not listed', version2({ ...TWO, current: 'gone' as ServerId }), { state: 'unreadable' }],
    ['a server with no way in', text({ version: 2, current: SERVER, servers: [{ ...oneServer(REMOTE).list[0], ways: [] }] }), { state: 'unreadable' }],
    ['an address that holds a sign-in secret', text({ version: 1, target: { kind: 'url', url: 'https://hermes.example.com/?token=abc' } }), { state: 'unreadable' }],
    ['an address in another spelling than the one Highwing saves', text({ version: 1, target: { kind: 'url', url: 'https://Hermes.Example.com:8443/hermes/' } }), { state: 'unreadable' }],
    ['a host ssh would read as an option', text({ version: 2, current: SERVER, servers: [{ ...oneServer(REMOTE).list[0], ways: [{ kind: 'ssh', host: '-oProxyCommand=true' }] }] }), { state: 'unreadable' }]
  ])('reads %s', (_what, content, settings) => {
    expect(parseSettings(content)).toEqual(settings)
  })
})

describe('saveSettings and loadSettings', () => {
  it('reads back the server it saved, from a file only the user can read', async () => {
    const dir = emptyDir()
    expect(await loadSettings(dir)).toEqual({ state: 'none' })
    await saveSettings(dir, oneServer(REMOTE))
    expect(await loadSettings(dir)).toEqual({ state: 'saved', servers: oneServer(REMOTE) })
    expect(readFileSync(join(dir, SETTINGS_FILE), 'utf8'))
      .toBe('{"version":2,"current":"server-1","servers":[{"id":"server-1","name":"hermes-host","ways":[{"kind":"remote","host":"hermes-host.example-tailnet.ts.net"}],"pick":"fastest"}]}\n')
    expect(statSync(join(dir, SETTINGS_FILE)).mode & 0o777).toBe(0o600)
    expect(readdirSync(dir)).toEqual([SETTINGS_FILE])
  })

  it('reads back every server, its ways in their order, its pick and the current one after a restart', async () => {
    const dir = emptyDir()
    await saveSettings(dir, TWO)
    expect(await loadSettings(dir)).toEqual({ state: 'saved', servers: TWO })
  })

  it('holds a gateway address and nothing else of its sign-in', async () => {
    const dir = emptyDir()
    await saveSettings(dir, oneServer(GATEWAY))
    expect(readFileSync(join(dir, SETTINGS_FILE), 'utf8')).toContain('"ways":[{"kind":"url","url":"https://hermes.example.com:8443/hermes"}]')
  })

  it('writes version 2 over a version 1 file at the first save, with the server under the place version 1 used', async () => {
    const dir = dirWith(text({ version: 1, target: REMOTE }))
    const loaded = await loadSettings(dir)
    if (loaded.state !== 'saved') throw new Error('the version 1 file did not load')
    const added = nextServers(loaded.servers, { do: 'addWay', target: LAN }) as Servers
    await saveSettings(dir, added)
    expect(JSON.parse(readFileSync(join(dir, SETTINGS_FILE), 'utf8'))).toMatchObject({ version: 2, current: text(REMOTE), servers: [{ id: text(REMOTE), ways: [REMOTE, LAN] }] })
    expect(await loadSettings(dir)).toEqual({ state: 'saved', servers: added })
    expect(readdirSync(dir)).toEqual([SETTINGS_FILE])
  })

  it('replaces the saved servers and leaves no other file', async () => {
    const dir = emptyDir()
    await saveSettings(dir, oneServer(REMOTE))
    await saveSettings(dir, oneServer(LOCAL))
    expect(await loadSettings(dir)).toEqual({ state: 'saved', servers: oneServer(LOCAL) })
    expect(readdirSync(dir)).toEqual([SETTINGS_FILE])
  })

  it('makes the directory when it is not there yet', async () => {
    const dir = join(emptyDir(), 'Highwing')
    await saveSettings(dir, oneServer(LOCAL))
    expect(await loadSettings(dir)).toEqual({ state: 'saved', servers: oneServer(LOCAL) })
  })

  it.each([
    ['unreadable', '{"version": 2, "servers"'],
    ['newer', text({ version: 3, servers: [{ kind: 'relay' }] })]
  ] as const)('leaves an %s file untouched on load, and sets it aside under its reason on the first save', async (reason, content) => {
    const dir = dirWith(content)
    expect(await loadSettings(dir)).toEqual({ state: reason })
    expect(readFileSync(join(dir, SETTINGS_FILE), 'utf8')).toBe(content)

    await saveSettings(dir, oneServer(REMOTE), 1_700_000_000_000)
    expect(readdirSync(dir).sort()).toEqual([SETTINGS_FILE, `connection.${reason}-1700000000000.json`].sort())
    expect(readFileSync(join(dir, `connection.${reason}-1700000000000.json`), 'utf8')).toBe(content)
    expect(await loadSettings(dir)).toEqual({ state: 'saved', servers: oneServer(REMOTE) })
  })

  it('reads a settings path that is not a file as unreadable', async () => {
    const dir = emptyDir()
    mkdirSync(join(dir, SETTINGS_FILE))
    expect(await loadSettings(dir)).toEqual({ state: 'unreadable' })
  })

  it('rejects when the file cannot be written, and keeps the saved servers', async () => {
    const dir = emptyDir()
    await saveSettings(dir, oneServer(REMOTE))
    mkdirSync(join(dir, `${SETTINGS_FILE}.tmp`))
    await expect(saveSettings(dir, oneServer(LOCAL))).rejects.toThrow()
    expect(await loadSettings(dir)).toEqual({ state: 'saved', servers: oneServer(REMOTE) })
  })
})
