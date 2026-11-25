import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Mode } from '../src/ipc-contract'
import { MODE_FILE, modeStore, readMode } from '../src/main/mode'

const text = (value: unknown) => JSON.stringify(value)
const emptyDir = () => mkdtempSync(join(tmpdir(), 'highwing-mode-'))
const saved = (dir: string) => JSON.parse(readFileSync(join(dir, MODE_FILE), 'utf8')) as unknown

describe('readMode', () => {
  it.each(['bots', 'chats'] satisfies Mode[])('reads %s as this build wrote it', mode => {
    expect(readMode(text({ version: 1, mode }))).toBe(mode)
  })

  it.each([
    ['half a file', '{"version": 1, "mode": "ch'],
    ['JSON that is not an object', '"chats"'],
    ['null', 'null'],
    ['no version', text({ mode: 'chats' })],
    ['a version of the wrong type', text({ version: '1', mode: 'chats' })],
    ['a later version', text({ version: 2, mode: 'chats' })],
    ['a mode Highwing does not have', text({ version: 1, mode: 'inbox' })],
    ['no mode', text({ version: 1 })]
  ])('reads %s as the bots, without throwing', (_what, content) => {
    expect(readMode(content)).toBe('bots')
  })
})

describe('modeStore', () => {
  it('starts in the bots when there is no file yet', async () => {
    expect((await modeStore(emptyDir())).mode.get()).toBe('bots')
  })

  it('starts in the bots when the file cannot be read', async () => {
    const dir = emptyDir()
    mkdirSync(join(dir, MODE_FILE))
    expect((await modeStore(dir)).mode.get()).toBe('bots')
  })

  it('starts in the bots from a file it cannot parse, and leaves the file until the next switch', async () => {
    const dir = emptyDir()
    writeFileSync(join(dir, MODE_FILE), '{"version": 1, "mo')
    const store = await modeStore(dir)
    expect(store.mode.get()).toBe('bots')
    expect(readFileSync(join(dir, MODE_FILE), 'utf8')).toBe('{"version": 1, "mo')
    store.set('chats')
    await store.settled()
    expect(saved(dir)).toEqual({ version: 1, mode: 'chats' })
  })

  it('shows a switch at once, and the next launch starts in it, from a file only the user can read', async () => {
    const dir = emptyDir()
    const store = await modeStore(dir)
    const heard: Mode[] = []
    store.mode.subscribe(mode => heard.push(mode))
    store.set('chats')
    expect(store.mode.get()).toBe('chats')
    expect(heard).toEqual(['chats'])
    await store.settled()
    expect((await modeStore(dir)).mode.get()).toBe('chats')
    expect(statSync(join(dir, MODE_FILE)).mode & 0o777).toBe(0o600)
    expect(readdirSync(dir)).toEqual([MODE_FILE])
  })

  it('applies switches in the order they were made', async () => {
    const dir = emptyDir()
    const store = await modeStore(dir)
    for (let round = 0; round < 20; round++) {
      store.set('chats')
      store.set('bots')
    }
    store.set('chats')
    await store.settled()
    expect(saved(dir)).toEqual({ version: 1, mode: 'chats' })
  })

  it('keeps the mode it shows when a save fails, and saves the next switch', async () => {
    const dir = join(emptyDir(), 'gone')
    const store = await modeStore(dir)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.set('chats')
    await store.settled()
    expect(logged).toHaveBeenCalledOnce()
    logged.mockRestore()
    expect(store.mode.get()).toBe('chats')
    mkdirSync(dir)
    store.set('bots')
    await store.settled()
    expect(saved(dir)).toEqual({ version: 1, mode: 'bots' })
  })
})
