import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Draft } from '../src/ipc-contract'
import { draftStore, readDraft } from '../src/main/drafts'

const draftOf = (key: string, bot: string, text: string) => ({ key, bot, text, attachments: [] }) as unknown as Draft
const SHOT = { id: 'a-1', name: 'error.png', kind: 'image', size: 2048 } as const
const CHAT = draftOf('chat:local-0102', 'research', 'half a thought')
const UNSTARTED = draftOf('bot:research', 'research', 'Rename every photo')
const text = (value: unknown) => JSON.stringify(value)
const emptyDir = () => join(mkdtempSync(join(tmpdir(), 'highwing-drafts-')), 'drafts')
const filesIn = (dir: string) => readdirSync(dir).sort()

describe('readDraft', () => {
  it('reads a draft this build wrote, and one an earlier build wrote with no attachments', () => {
    expect(readDraft(text({ version: 1, ...CHAT }))).toEqual(CHAT)
    expect(readDraft(text({ version: 1, key: 'new', bot: null, text: 'x' }))).toEqual({ key: 'new', bot: null, text: 'x', attachments: [] })
    expect(readDraft(text({ version: 1, ...CHAT, text: '', attachments: [SHOT] }))).toEqual({ ...CHAT, text: '', attachments: [SHOT] })
    expect(readDraft(text({ version: 1, key: 'group:launch-plan', bot: null, text: '@sam go' }))).toEqual({ key: 'group:launch-plan', bot: null, text: '@sam go', attachments: [] })
  })

  it.each([
    ['half a file', '{"version": 1, "key": "chat:'],
    ['JSON that is not an object', '7'],
    ['null', 'null'],
    ['no version', text(CHAT)],
    ['a later version', text({ version: 2, ...CHAT })],
    ['a later version of another shape', text({ version: 3, chats: { 'local-0102': ['half'] } })],
    ['a version of the wrong type', text({ version: '1', ...CHAT })],
    ['a key of no known kind', text({ version: 1, ...CHAT, key: 'session:local-0102' })],
    ['a chat key with no session', text({ version: 1, ...CHAT, key: 'chat:' })],
    ['text that is not a string', text({ version: 1, ...CHAT, text: ['half'] })],
    ['a bot that is not a name', text({ version: 1, ...CHAT, bot: 7 })],
    ['empty text and no attachments', text({ version: 1, ...CHAT, text: '' })],
    ['an attachment it cannot read', text({ version: 1, ...CHAT, attachments: [{ ...SHOT, kind: 'pdf' }] })]
  ])('reads %s as no draft, without throwing', (_what, content) => {
    expect(readDraft(content)).toBeNull()
  })
})

describe('draftStore', () => {
  it('loads no drafts from a folder that does not exist yet', async () => {
    await expect(draftStore(emptyDir()).load()).resolves.toEqual([])
  })

  it('reads back each draft it kept, from files only the user can read', async () => {
    const dir = emptyDir()
    const store = draftStore(dir)
    store.keep(CHAT)
    store.keep(UNSTARTED)
    store.keep({ ...CHAT, text: 'half a thought, and more' })
    await store.settled()
    const loaded = await draftStore(dir).load()
    expect([...loaded].sort((a, b) => a.key.localeCompare(b.key))).toEqual([UNSTARTED, { ...CHAT, text: 'half a thought, and more' }])
    expect(filesIn(dir)).toHaveLength(2)
    for (const name of filesIn(dir)) expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600)
  })

  it('deletes a draft kept with empty text, and is fine when there was none', async () => {
    const dir = emptyDir()
    const store = draftStore(dir)
    store.keep(CHAT)
    store.keep({ ...CHAT, text: '' })
    store.keep({ ...UNSTARTED, text: '' })
    await store.settled()
    await expect(store.load()).resolves.toEqual([])
    expect(filesIn(dir)).toEqual([])
  })

  it('keeps a draft that holds only attachments, and deletes it once they are gone too', async () => {
    const dir = emptyDir()
    const store = draftStore(dir)
    const attached = { ...CHAT, text: '', attachments: [SHOT] } as unknown as Draft
    store.keep(attached)
    await store.settled()
    await expect(draftStore(dir).load()).resolves.toEqual([attached])
    store.keep({ ...attached, attachments: [] })
    await store.settled()
    expect(filesIn(dir)).toEqual([])
  })

  it('applies a save and the delete after it in that order', async () => {
    const dir = emptyDir()
    const store = draftStore(dir)
    for (let round = 0; round < 20; round++) {
      store.keep({ ...CHAT, text: `draft ${round}` })
      store.keep({ ...CHAT, text: '' })
    }
    await store.settled()
    expect(filesIn(dir)).toEqual([])
  })

  it('keeps going after a write fails', async () => {
    const dir = emptyDir()
    mkdirSync(join(dir, '..'), { recursive: true })
    writeFileSync(dir, 'a file where the folder should be')
    const store = draftStore(dir)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.keep(UNSTARTED)
    await store.settled()
    expect(logged).toHaveBeenCalledOnce()
    logged.mockRestore()
    rmSync(dir)
    store.keep(CHAT)
    await store.settled()
    await expect(store.load()).resolves.toEqual([CHAT])
  })

  it('loads a file it cannot read as no draft, and leaves it on disk', async () => {
    const dir = emptyDir()
    mkdirSync(dir, { recursive: true })
    const newer = text({ version: 2, key: 'chat:local-0103', bot: 'research', text: 'from a later Highwing', more: true })
    writeFileSync(join(dir, 'aaaa.json'), newer)
    writeFileSync(join(dir, 'bbbb.json'), '{"version": 1, "key"')
    const store = draftStore(dir)
    store.keep(CHAT)
    await store.settled()
    await expect(store.load()).resolves.toEqual([CHAT])
    expect(readFileSync(join(dir, 'aaaa.json'), 'utf8')).toBe(newer)
    expect(readFileSync(join(dir, 'bbbb.json'), 'utf8')).toBe('{"version": 1, "key"')
  })
})
