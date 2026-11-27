import type { BotId, SessionId, UnreadChat } from '@highwing/hermes/domain'
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { readUnread, unreadStore } from '../src/main/unread'

const unread = (chat: string, bot: string): UnreadChat => ({ chat: chat as SessionId, bot: bot as BotId })
const EGGBOT = unread('local-0000', 'dr-eggbot')
const RESEARCH = unread('local-0102', 'research')
const LOCAL = JSON.stringify({ kind: 'local' })
const REMOTE = JSON.stringify({ kind: 'remote', host: 'studio' })
const text = (value: unknown) => JSON.stringify(value)
const emptyDir = () => join(mkdtempSync(join(tmpdir(), 'highwing-unread-')), 'unread')

describe('readUnread', () => {
  it('reads the chats this build wrote', () => {
    expect(readUnread(text({ version: 1, chats: [EGGBOT, RESEARCH] }))).toEqual([EGGBOT, RESEARCH])
  })

  it('drops a row it cannot read and keeps the rest', () => {
    expect(readUnread(text({ version: 1, chats: [EGGBOT, null, { chat: '', bot: 'research' }, { chat: 'local-0102' }, { chat: 7, bot: 'research' }, RESEARCH] }))).toEqual([EGGBOT, RESEARCH])
  })

  it.each([
    ['half a file', '{"version": 1, "chats": ['],
    ['null', 'null'],
    ['no version', text({ chats: [EGGBOT] })],
    ['a later version', text({ version: 2, chats: [EGGBOT] })],
    ['chats that are not a list', text({ version: 1, chats: { 'local-0000': 'dr-eggbot' } })]
  ])('reads %s as none, without throwing', (_what, content) => {
    expect(readUnread(content)).toEqual([])
  })
})

describe('unreadStore', () => {
  it('loads none for a place it never kept', () => {
    expect(unreadStore(emptyDir()).load(LOCAL)).toEqual([])
  })

  it('reads back the latest list it kept for a place, from a file only the user can read', async () => {
    const dir = emptyDir()
    const store = unreadStore(dir)
    store.keep(LOCAL, [EGGBOT])
    store.keep(LOCAL, [EGGBOT, RESEARCH])
    await store.settled()
    expect(unreadStore(dir).load(LOCAL)).toEqual([EGGBOT, RESEARCH])
    const [name] = readdirSync(dir)
    expect(readdirSync(dir)).toHaveLength(1)
    expect(statSync(join(dir, name!)).mode & 0o777).toBe(0o600)
  })

  it('keeps each place apart', async () => {
    const dir = emptyDir()
    const store = unreadStore(dir)
    store.keep(LOCAL, [EGGBOT])
    store.keep(REMOTE, [RESEARCH])
    await store.settled()
    const reread = unreadStore(dir)
    expect(reread.load(LOCAL)).toEqual([EGGBOT])
    expect(reread.load(REMOTE)).toEqual([RESEARCH])
  })

  it('loads what it was last given before the write reaches the disk', () => {
    const store = unreadStore(emptyDir())
    store.keep(LOCAL, [EGGBOT])
    expect(store.load(LOCAL)).toEqual([EGGBOT])
  })

  it('ignores a file it cannot read', async () => {
    const dir = emptyDir()
    const store = unreadStore(dir)
    store.keep(LOCAL, [EGGBOT])
    await store.settled()
    for (const name of readdirSync(dir)) writeFileSync(join(dir, name), '{"version": 1, "chats": [')
    expect(unreadStore(dir).load(LOCAL)).toEqual([])
  })

  it('says why it could not keep the list', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dir = emptyDir()
    mkdirSync(join(dir, '..'), { recursive: true })
    writeFileSync(dir, 'not a folder')
    const store = unreadStore(dir)
    store.keep(LOCAL, [EGGBOT])
    await expect(store.settled()).resolves.toBeUndefined()
    expect(logged).toHaveBeenCalledOnce()
    logged.mockRestore()
  })
})
