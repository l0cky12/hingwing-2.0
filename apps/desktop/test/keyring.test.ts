import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dbusSend, hasSecretService, type AskBus } from '../src/main/keyring'

const reply = (body: string) => `method return time=1.5 sender=org.freedesktop.DBus -> destination=:1.7 serial=3 reply_serial=2\n${body}\n`
const NAMES = (...names: readonly string[]) => reply(`   array [\n${names.map(name => `      string "${name}"`).join('\n')}\n   ]`)

const bus = (owned: boolean | null, startable: string | null): AskBus & { readonly asked: string[] } => {
  const asked: string[] = []
  return Object.assign(((method, ...args) => {
    asked.push([method, ...args].join(' '))
    if (method === 'NameHasOwner') return owned === null ? null : reply(`   boolean ${owned}`)
    return startable
  }) satisfies AskBus, { asked })
}

describe('hasSecretService', () => {
  it('finds one that is running, and asks nothing more', () => {
    const asked = bus(true, null)
    expect(hasSecretService(asked)).toBe(true)
    expect(asked.asked).toEqual(['NameHasOwner string:org.freedesktop.secrets'])
  })

  it('finds one the bus can start', () => {
    expect(hasSecretService(bus(false, NAMES('org.freedesktop.DBus', 'org.freedesktop.secrets', 'org.a11y.Bus')))).toBe(true)
  })

  it.each([
    ['a bus with neither', bus(false, NAMES('org.freedesktop.DBus', 'org.a11y.Bus'))],
    ['a bus that only has a name starting the same way', bus(false, NAMES('org.freedesktop.secrets.other'))],
    ['a bus that does not answer', bus(null, null)]
  ])('finds none on %s', (_what, asked) => {
    expect(hasSecretService(asked)).toBe(false)
  })
})

describe('dbusSend', () => {
  const ADDRESS = 'unix:path=/nowhere/bus'
  const binWith = (script: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'highwing-keyring-'))
    writeFileSync(join(dir, 'dbus-send'), `#!/bin/sh\necho "$@" >> "$0.calls"\n${script}\n`, { mode: 0o755 })
    return { PATH: dir, calls: () => (existsSync(join(dir, 'dbus-send.calls')) ? readFileSync(join(dir, 'dbus-send.calls'), 'utf8') : '') }
  }

  it('asks the driver of the session bus, and gives back what dbus-send printed', () => {
    const { PATH, calls } = binWith('echo "   boolean true"')
    expect(dbusSend({ PATH, DBUS_SESSION_BUS_ADDRESS: ADDRESS })('NameHasOwner', 'string:org.freedesktop.secrets')).toBe('   boolean true\n')
    expect(calls()).toBe('--session --dest=org.freedesktop.DBus --type=method_call --print-reply --reply-timeout=500 /org/freedesktop/DBus org.freedesktop.DBus.NameHasOwner string:org.freedesktop.secrets\n')
  })

  it('runs nothing when the session has no bus, because dbus-send would start one', () => {
    const { PATH, calls } = binWith('echo "   boolean true"')
    expect(dbusSend({ PATH })('NameHasOwner', 'string:org.freedesktop.secrets')).toBeNull()
    expect(calls()).toBe('')
  })

  it.each([
    ['a dbus-send that fails', binWith('exit 1').PATH],
    ['a computer with no dbus-send', '/nowhere']
  ])('reads %s as no answer', (_what, PATH) => {
    expect(dbusSend({ PATH, DBUS_SESSION_BUS_ADDRESS: ADDRESS })('ListActivatableNames')).toBeNull()
  })
})
