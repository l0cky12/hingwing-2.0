import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@highwing/hermes/domain'
import { MODE, ON_CLOSE, preferenceStore, readPreference, SEND_KEY, SIDEBAR_WIDTH, SNOOZES, snoozed, SPELL_CHECK, THEME, type Preference } from '../src/main/preferences'

const text = (value: unknown) => JSON.stringify(value)
const emptyDir = () => mkdtempSync(join(tmpdir(), 'highwing-preference-'))

interface Case<T> {
  readonly preference: Preference<T>
  readonly values: readonly [T, T, ...T[]]
  readonly unknown: string
}
const CASES: readonly Case<string>[] = [
  { preference: MODE, values: ['bots', 'chats'], unknown: 'inbox' },
  { preference: THEME, values: ['system', 'dark', 'light'], unknown: 'sepia' },
  { preference: SIDEBAR_WIDTH, values: ['full', 'compact'], unknown: 'narrow' },
  { preference: ON_CLOSE, values: ['quit', 'stay'], unknown: 'minimize' },
  { preference: SEND_KEY, values: ['enter', 'modEnter'], unknown: 'altEnter' }
]

describe.each(CASES)('the $preference.file preference', ({ preference, values, unknown }) => {
  const { file, key, fallback } = preference
  const [, picked] = values
  const saved = (dir: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown

  it.each(values)(`reads %s as this build wrote it`, value => {
    expect(readPreference(preference, text({ version: 1, [key]: value }))).toBe(value)
  })

  it.each([
    ['half a file', `{"version": 1, "${key}": "${picked.slice(0, 2)}`],
    ['JSON that is not an object', text(picked)],
    ['null', 'null'],
    ['no version', text({ [key]: picked })],
    ['a version of the wrong type', text({ version: '1', [key]: picked })],
    ['a later version', text({ version: 2, [key]: picked })],
    ['a value Highwing does not have', text({ version: 1, [key]: unknown })],
    ['no value', text({ version: 1 })]
  ])(`reads %s as ${fallback}, without throwing`, (_what, content) => {
    expect(readPreference(preference, content)).toBe(fallback)
  })

  it(`starts at ${fallback} when there is no file yet`, async () => {
    expect((await preferenceStore(emptyDir(), preference)).get()).toBe(fallback)
  })

  it(`starts at ${fallback} when the file cannot be read`, async () => {
    const dir = emptyDir()
    mkdirSync(join(dir, file))
    expect((await preferenceStore(dir, preference)).get()).toBe(fallback)
  })

  it(`starts at ${fallback} from a file it cannot parse, and leaves the file until the next pick`, async () => {
    const dir = emptyDir()
    writeFileSync(join(dir, file), '{"version": 1, "mo')
    const store = await preferenceStore(dir, preference)
    expect(store.get()).toBe(fallback)
    expect(readFileSync(join(dir, file), 'utf8')).toBe('{"version": 1, "mo')
    store.set(picked)
    await store.settled()
    expect(saved(dir)).toEqual({ version: 1, [key]: picked })
  })

  it('shows a pick at once, and the next launch starts at it, from a file only the user can read', async () => {
    const dir = emptyDir()
    const store = await preferenceStore(dir, preference)
    const heard: string[] = []
    store.subscribe(value => heard.push(value))
    store.set(picked)
    expect(store.get()).toBe(picked)
    expect(heard).toEqual([picked])
    await store.settled()
    expect((await preferenceStore(dir, preference)).get()).toBe(picked)
    expect(statSync(join(dir, file)).mode & 0o777).toBe(0o600)
    expect(readdirSync(dir)).toEqual([file])
  })

  it('applies picks in the order they were made', async () => {
    const dir = emptyDir()
    const store = await preferenceStore(dir, preference)
    for (let round = 0; round < 20; round++) for (const value of values) store.set(value)
    store.set(picked)
    await store.settled()
    expect(saved(dir)).toEqual({ version: 1, [key]: picked })
  })

  it('keeps the value it shows when a save fails, and saves the next pick', async () => {
    const dir = join(emptyDir(), 'gone')
    const store = await preferenceStore(dir, preference)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.set(picked)
    await store.settled()
    expect(logged).toHaveBeenCalledOnce()
    logged.mockRestore()
    expect(store.get()).toBe(picked)
    mkdirSync(dir)
    store.set(fallback)
    await store.settled()
    expect(saved(dir)).toEqual({ version: 1, [key]: fallback })
  })
})

it('keeps a commit on disk and in what it shows, and leaves both alone when the write fails', async () => {
  const dir = emptyDir()
  const store = await preferenceStore(dir, MODE)
  const heard: string[] = []
  store.subscribe(value => heard.push(value))
  const writing = store.commit('chats')
  expect(store.get()).toBe('bots')
  expect(heard).toEqual([])
  await writing
  expect(store.get()).toBe('chats')
  expect(heard).toEqual(['chats'])
  expect(JSON.parse(readFileSync(join(dir, 'mode.json'), 'utf8'))).toEqual({ version: 1, mode: 'chats' })
  store.set('bots')
  expect(store.get()).toBe('bots')
  expect(heard).toEqual(['chats', 'bots'])
  await store.settled()
  expect(JSON.parse(readFileSync(join(dir, 'mode.json'), 'utf8'))).toEqual({ version: 1, mode: 'bots' })

  const missing = join(emptyDir(), 'gone')
  const broken = await preferenceStore(missing, MODE)
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  await expect(broken.commit('chats')).rejects.toThrow()
  expect(logged).not.toHaveBeenCalled()
  logged.mockRestore()
  expect(broken.get()).toBe('bots')
  mkdirSync(missing)
  broken.set('chats')
  await broken.settled()
  expect(JSON.parse(readFileSync(join(missing, 'mode.json'), 'utf8'))).toEqual({ version: 1, mode: 'chats' })
})

it('keeps mode.json as earlier builds wrote it', async () => {
  const dir = emptyDir()
  writeFileSync(join(dir, 'mode.json'), '{"version":1,"mode":"chats"}\n')
  const store = await preferenceStore(dir, MODE)
  expect(store.get()).toBe('chats')
  store.set('bots')
  await store.settled()
  expect(readFileSync(join(dir, 'mode.json'), 'utf8')).toBe('{"version":1,"mode":"bots"}\n')
})

describe('the spell-check.json preference', () => {
  const dir = emptyDir()

  it('reads a boolean as this build wrote it, and anything else as on', () => {
    expect(readPreference(SPELL_CHECK, text({ version: 1, spellCheck: false }))).toBe(false)
    expect(readPreference(SPELL_CHECK, text({ version: 1, spellCheck: true }))).toBe(true)
    for (const spellCheck of ['false', 0, null]) expect(readPreference(SPELL_CHECK, text({ version: 1, spellCheck })), String(spellCheck)).toBe(true)
    expect(readPreference(SPELL_CHECK, text({ version: 2, spellCheck: false }))).toBe(true)
    expect(readPreference(SPELL_CHECK, '{"version": 1, "spellCh')).toBe(true)
  })

  it('starts on, and the next launch starts off once it was turned off', async () => {
    const store = await preferenceStore(dir, SPELL_CHECK)
    expect(store.get()).toBe(true)
    store.set(false)
    await store.settled()
    expect(JSON.parse(readFileSync(join(dir, 'spell-check.json'), 'utf8'))).toEqual({ version: 1, spellCheck: false })
    expect((await preferenceStore(dir, SPELL_CHECK)).get()).toBe(false)
  })
})

describe('the snoozes.json preference', () => {
  it('reads the snoozes this build wrote, and none from a file holding one it cannot read', () => {
    expect(readPreference(SNOOZES, text({ version: 1, snoozes: { s1: 1_800_000_000_000, s2: 1_800_000_060_000 } }))).toEqual({ s1: 1_800_000_000_000, s2: 1_800_000_060_000 })
    for (const snoozes of [{ s1: 'tomorrow' }, { s1: -5 }, { s1: 1.5 }, { ' ': 1_800_000_000_000 }, ['s1'], null]) {
      expect(readPreference(SNOOZES, text({ version: 1, snoozes })), JSON.stringify(snoozes)).toEqual({})
    }
  })

  it('starts with none, and the next launch starts with the snoozes kept', async () => {
    const dir = emptyDir()
    const store = await preferenceStore(dir, SNOOZES)
    expect(store.get()).toEqual({})
    store.set({ ['s1' as SessionId]: 1_800_000_000_000 })
    await store.settled()
    expect((await preferenceStore(dir, SNOOZES)).get()).toEqual({ s1: 1_800_000_000_000 })
  })
})

describe('a snooze or a wake', () => {
  const NOW = 1_000_000
  const held = { ['s1' as SessionId]: 2_000_000, ['s2' as SessionId]: 3_000_000 }
  const chat = (id: string) => id as SessionId

  it('snoozes a chat until the time picked, and moves the time of one already snoozed', () => {
    expect(snoozed(held, { sessionId: chat('s3'), until: 4_000_000 }, NOW)).toEqual({ s1: 2_000_000, s2: 3_000_000, s3: 4_000_000 })
    expect(snoozed(held, { sessionId: chat('s1'), until: 5_000_000 }, NOW)).toEqual({ s1: 5_000_000, s2: 3_000_000 })
  })

  it('wakes a chat, and wakes one snoozed to a time already past', () => {
    expect(snoozed(held, { sessionId: chat('s1'), until: null }, NOW)).toEqual({ s2: 3_000_000 })
    expect(snoozed(held, { sessionId: chat('s1'), until: NOW }, NOW)).toEqual({ s2: 3_000_000 })
  })

  it('drops every snooze whose time has passed', () => {
    expect(snoozed(held, { sessionId: chat('s3'), until: 4_000_000 }, 2_500_000)).toEqual({ s2: 3_000_000, s3: 4_000_000 })
  })
})
