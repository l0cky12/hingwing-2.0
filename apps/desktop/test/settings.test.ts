import type { SshHost, Target } from '@highwing/hermes/domain'
import type { GatewayUrl } from '@highwing/hermes/domain'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadSettings, parseSettings, saveSettings, SETTINGS_FILE } from '../src/main/settings'

const REMOTE: Target = { kind: 'remote', host: 'hermes-host.example-tailnet.ts.net' as SshHost }
const LOCAL: Target = { kind: 'local' }
const GATEWAY: Target = { kind: 'url', url: 'https://hermes.example.com:8443/hermes' as GatewayUrl }
const text = (value: unknown) => JSON.stringify(value)
const emptyDir = () => mkdtempSync(join(tmpdir(), 'highwing-settings-'))
const dirWith = (content: string) => {
  const dir = emptyDir()
  writeFileSync(join(dir, SETTINGS_FILE), content)
  return dir
}

describe('parseSettings', () => {
  it.each([
    ['no file', null, { state: 'none' }],
    ['a remote target', text({ version: 1, target: REMOTE }), { state: 'saved', target: REMOTE }],
    ['this computer', text({ version: 1, target: LOCAL }), { state: 'saved', target: LOCAL }],
    ['a gateway address', text({ version: 1, target: GATEWAY }), { state: 'saved', target: GATEWAY }],
    ['a target with keys this build does not know', text({ version: 1, target: { ...REMOTE, port: 22 }, theme: 'dark' }), { state: 'saved', target: REMOTE }],
    ['a later version', text({ version: 2, target: { kind: 'relay', via: 'somewhere' } }), { state: 'newer' }],
    ['a later version whose target this build could read', text({ version: 7, target: REMOTE }), { state: 'newer' }],
    ['an empty file', '', { state: 'unreadable' }],
    ['half a file', '{"version": 1, "target": {"kind": "rem', { state: 'unreadable' }],
    ['JSON that is not an object', '7', { state: 'unreadable' }],
    ['no version', text({ target: REMOTE }), { state: 'unreadable' }],
    ['a version of the wrong type', text({ version: '1', target: REMOTE }), { state: 'unreadable' }],
    ['version zero', text({ version: 0, target: REMOTE }), { state: 'unreadable' }],
    ['no target', text({ version: 1 }), { state: 'unreadable' }],
    ['an address that holds a sign-in secret', text({ version: 1, target: { kind: 'url', url: 'https://hermes.example.com/?token=abc' } }), { state: 'unreadable' }],
    ['an address in another spelling than the one Highwing saves', text({ version: 1, target: { kind: 'url', url: 'https://Hermes.Example.com:8443/hermes/' } }), { state: 'unreadable' }],
    ['a host ssh would read as an option', text({ version: 1, target: { kind: 'remote', host: '-oProxyCommand=true' } }), { state: 'unreadable' }]
  ])('reads %s', (_what, content, settings) => {
    expect(parseSettings(content)).toEqual(settings)
  })
})

describe('saveSettings and loadSettings', () => {
  it('reads back the target it saved, from a file only the user can read', async () => {
    const dir = emptyDir()
    expect(await loadSettings(dir)).toEqual({ state: 'none' })
    await saveSettings(dir, REMOTE)
    expect(await loadSettings(dir)).toEqual({ state: 'saved', target: REMOTE })
    expect(readFileSync(join(dir, SETTINGS_FILE), 'utf8')).toBe('{"version":1,"target":{"kind":"remote","host":"hermes-host.example-tailnet.ts.net"}}\n')
    expect(statSync(join(dir, SETTINGS_FILE)).mode & 0o777).toBe(0o600)
    expect(readdirSync(dir)).toEqual([SETTINGS_FILE])
  })

  it('reads back a gateway address after a restart, from a file that holds the address and nothing else', async () => {
    const dir = emptyDir()
    await saveSettings(dir, GATEWAY)
    expect(await loadSettings(dir)).toEqual({ state: 'saved', target: GATEWAY })
    expect(readFileSync(join(dir, SETTINGS_FILE), 'utf8')).toBe('{"version":1,"target":{"kind":"url","url":"https://hermes.example.com:8443/hermes"}}\n')
  })

  it('replaces a saved target and leaves no other file', async () => {
    const dir = emptyDir()
    await saveSettings(dir, REMOTE)
    await saveSettings(dir, LOCAL)
    expect(await loadSettings(dir)).toEqual({ state: 'saved', target: LOCAL })
    expect(readdirSync(dir)).toEqual([SETTINGS_FILE])
  })

  it('makes the directory when it is not there yet', async () => {
    const dir = join(emptyDir(), 'Highwing')
    await saveSettings(dir, LOCAL)
    expect(await loadSettings(dir)).toEqual({ state: 'saved', target: LOCAL })
  })

  it.each([
    ['unreadable', '{"version": 1, "target"'],
    ['newer', text({ version: 2, target: { kind: 'relay' } })]
  ] as const)('leaves an %s file untouched on load, and sets it aside under its reason on the first save', async (reason, content) => {
    const dir = dirWith(content)
    expect(await loadSettings(dir)).toEqual({ state: reason })
    expect(readFileSync(join(dir, SETTINGS_FILE), 'utf8')).toBe(content)

    await saveSettings(dir, REMOTE, 1_700_000_000_000)
    expect(readdirSync(dir).sort()).toEqual([SETTINGS_FILE, `connection.${reason}-1700000000000.json`].sort())
    expect(readFileSync(join(dir, `connection.${reason}-1700000000000.json`), 'utf8')).toBe(content)
    expect(await loadSettings(dir)).toEqual({ state: 'saved', target: REMOTE })
  })

  it('reads a settings path that is not a file as unreadable', async () => {
    const dir = emptyDir()
    mkdirSync(join(dir, SETTINGS_FILE))
    expect(await loadSettings(dir)).toEqual({ state: 'unreadable' })
  })

  it('rejects when the file cannot be written, and keeps the saved target', async () => {
    const dir = emptyDir()
    await saveSettings(dir, REMOTE)
    mkdirSync(join(dir, `${SETTINGS_FILE}.tmp`))
    await expect(saveSettings(dir, LOCAL)).rejects.toThrow()
    expect(await loadSettings(dir)).toEqual({ state: 'saved', target: REMOTE })
  })
})
