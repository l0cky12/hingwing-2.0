import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MODE, preferenceStore, readPreference, type Preference } from '../src/main/preferences'

const text = (value: unknown) => JSON.stringify(value)
const emptyDir = () => mkdtempSync(join(tmpdir(), 'highwing-preference-'))

interface Case<T> {
  readonly preference: Preference<T>
  /** Every value this build writes, the fallback first. */
  readonly values: readonly [T, T, ...T[]]
  readonly unknown: string
}
const CASES: readonly Case<string>[] = [
  { preference: MODE, values: ['bots', 'chats'], unknown: 'inbox' }
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

it('keeps mode.json as earlier builds wrote it', async () => {
  const dir = emptyDir()
  writeFileSync(join(dir, 'mode.json'), '{"version":1,"mode":"chats"}\n')
  const store = await preferenceStore(dir, MODE)
  expect(store.get()).toBe('chats')
  store.set('bots')
  await store.settled()
  expect(readFileSync(join(dir, 'mode.json'), 'utf8')).toBe('{"version":1,"mode":"bots"}\n')
})
