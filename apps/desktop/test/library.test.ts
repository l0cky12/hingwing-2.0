import type { Hermes } from '@highwing/hermes'
import type { BotId, CommandOutcome, FarFile, LibraryItemId, MadeRead, SessionId, SshHost, Target } from '@highwing/hermes/domain'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as disk from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Setup } from '../src/ipc-contract'
import { feed } from '../src/main/connection'
import { ownLibrary } from '../src/main/library'
import type { Source } from '../src/main/preview-page'
import { folderSaver } from '../src/main/saves'
import { live } from './support/live'

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, stat: vi.fn(actual.stat), lstat: vi.fn(actual.lstat), copyFile: vi.fn(actual.copyFile), readFile: vi.fn(actual.readFile), open: vi.fn(actual.open), access: vi.fn(actual.access) }
})

const RAE = 'rae' as BotId
const SAM = 'sam' as BotId
const CHAT = 'local-0301' as SessionId
const HERE: Target = { kind: 'local' }
const FAR: Target = { kind: 'ssh', host: 'ada@hermes-host' as SshHost }

const madeWith = (path: string): MadeRead => ({
  chats: [{ sessionId: CHAT, title: 'Weekly report', rows: [{ at: 2000, wrote: [path] }, { at: 3000, said: 'The [source data](https://example.com/data).' }] }],
  reach: 'more', unread: 1
})

function rig(target: Target, options: { readonly made?: MadeRead; readonly sent?: CommandOutcome<Uint8Array> } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'highwing-library-'))
  const path = join(work, 'notes.md')
  const saves = join(work, 'saves')
  const made = options.made ?? madeWith(path)
  const setup = feed<Setup>({ at: 'chat', live: live(target, 1) })
  const asked: unknown[] = []
  const downloads: FarFile[] = []
  const shown: { request: string; named: string | null; elsewhere: string | undefined; session: string | null }[] = []
  const owner = {
    hermes: {} as Hermes,
    setup,
    run: async (command: unknown) => (asked.push(command), { ok: true, value: made }) as never,
    download: async (file: FarFile) => (downloads.push(file), options.sent ?? { ok: true, value: new TextEncoder().encode('# Notes, as Hermes sent them\n') })
  }
  const pane = {
    show: (request: string, _label: string | null, source: Source | undefined) => (shown.push({ request, named: source?.named(request) ?? null, elsewhere: source?.elsewhere, session: source?.session ?? null }), true)
  }
  const library = ownLibrary({ owner, pane, saver: folderSaver(saves) })
  const always = () => true
  const read = (bot = RAE) => library.run({ do: 'readLibrary', bot, step: 0 }, always)
  const save = (id: string, bot = RAE, stillLive = always) => library.run({ do: 'saveLibraryItem', bot, id: id as LibraryItemId }, stillLive)
  const preview = (id: string, bot = RAE) => library.run({ do: 'previewLibraryItem', bot, id: id as LibraryItemId }, always)
  const saved = () => readdirSync(saves, { withFileTypes: true }).map(entry => [entry.name, readFileSync(join(saves, entry.name), 'utf8')])
  return { work, path, saves, owner, setup, asked, downloads, shown, read, save, preview, saved, fileId: `hermes:${path}`, linkId: 'web:https://example.com/data' }
}

describe("a bot's Library in main", () => {
  it("reads the bot's chats through the hub, and answers the items, newest first, with how many chats it looked at", async () => {
    const { read, asked, path } = rig(HERE)
    expect(await read()).toEqual({
      ok: true,
      value: {
        items: [
          { id: 'web:https://example.com/data', kind: 'link', name: 'source data', at: 3000, chat: { sessionId: CHAT, title: 'Weekly report' }, where: { on: 'web', url: 'https://example.com/data' } },
          { id: `hermes:${path}`, kind: 'file', name: 'notes.md', at: 2000, chat: { sessionId: CHAT, title: 'Weekly report' }, where: { on: 'hermes', path } }
        ],
        chats: 2, reach: 'more', unread: 1
      }
    })
    expect(asked).toEqual([{ do: 'readMade', bot: 'rae', step: 0 }])
  })

  it('acts on no item this connection did not read for that bot: an unknown id, another bot\'s, or one read before a switch', async () => {
    const STALE = { ok: false, refusal: { kind: 'stale', message: 'This list is out of date. Open the Library tab again.' } }
    const { read, save, preview, owner, fileId, shown, downloads } = rig(HERE)
    expect(await save(fileId), 'nothing read yet').toEqual(STALE)
    await read()
    expect(await save('hermes:/etc/passwd')).toEqual(STALE)
    expect(await preview('web:https://evil.example/')).toEqual(STALE)
    expect(await save(fileId, SAM), "another bot's item").toEqual(STALE)
    owner.hermes = {} as Hermes
    expect(await save(fileId), 'the connection that read it is gone').toEqual(STALE)
    expect(await preview(fileId)).toEqual(STALE)
    expect(shown).toEqual([])
    expect(downloads).toEqual([])
  })

  it('keeps nothing of a read that lands after the connection switched', async () => {
    const { owner } = rig(HERE)
    const first = owner.hermes
    const switching = { ...owner, run: async () => { switching.hermes = {} as Hermes; return { ok: true, value: madeWith('/home/rae/notes.md') } as never } }
    const library = ownLibrary({ owner: switching, pane: { show: () => true }, saver: folderSaver(mkdtempSync(join(tmpdir(), 'highwing-library-'))) })
    expect(await library.run({ do: 'readLibrary', bot: RAE, step: 0 }, () => true)).toMatchObject({ ok: false, refusal: { kind: 'stale' } })
    switching.hermes = first
    expect(await library.run({ do: 'saveLibraryItem', bot: RAE, id: 'hermes:/home/rae/notes.md' as LibraryItemId }, () => true)).toMatchObject({ ok: false, refusal: { kind: 'stale' } })
  })

  it('shows a file in the pane vouched for that path alone, and a link as a web page', async () => {
    const { read, preview, fileId, linkId, shown, path } = rig(FAR)
    await read()
    expect(await preview(fileId)).toEqual({ ok: true, value: undefined })
    expect(await preview(linkId)).toEqual({ ok: true, value: undefined })
    expect(shown).toEqual([
      { request: path, named: path, elsewhere: 'Save it to open it on this computer.', session: CHAT },
      { request: 'https://example.com/data', named: null, elsewhere: undefined, session: null }
    ])
  })

  it('saves a file of a Hermes on this computer by copying it, and never asks Hermes for it', async () => {
    const { read, save, fileId, path, saves, saved, downloads } = rig(HERE)
    writeFileSync(path, '# Notes, on this computer\n')
    await read()
    expect(await save(fileId)).toEqual({ ok: true, value: join(saves, 'notes.md') })
    expect(saved()).toEqual([['notes.md', '# Notes, on this computer\n']])
    expect(downloads).toEqual([])
  })

  it('says a file of this computer is gone, or no file, before it asks where to save it', async () => {
    const { read, save, fileId, path, saves } = rig(HERE)
    await read()
    expect(await save(fileId)).toEqual({ ok: false, refusal: { kind: 'stale', message: "notes.md isn't there any more." } })
    mkdirSync(path)
    expect(await save(fileId)).toEqual({ ok: false, refusal: { kind: 'rejected', message: "notes.md isn't a file Highwing can save." } })
    expect(() => readdirSync(saves), 'no folder was asked for').toThrow()
  })

  it('saves a file of a Hermes elsewhere as Hermes sends it, and never touches the file at that path on this computer', async () => {
    const { read, save, fileId, path, saved, downloads } = rig(FAR)
    writeFileSync(path, 'A DECOY: a file of this computer that only shares the path')
    await read()
    vi.clearAllMocks()
    expect(await save(fileId)).toMatchObject({ ok: true })
    expect(saved()).toEqual([['notes.md', '# Notes, as Hermes sent them\n']])
    expect(downloads).toEqual([{ bot: 'rae', sessionId: CHAT, path }])
    for (const [name, read] of Object.entries({ stat: disk.stat, lstat: disk.lstat, copyFile: disk.copyFile, readFile: disk.readFile, open: disk.open, access: disk.access })) {
      expect(vi.mocked(read).mock.calls.filter(call => (call as unknown[]).includes(path)), name).toEqual([])
    }
  })

  it("answers Hermes's refusal before it asks where to save, and writes nothing", async () => {
    const CANT_SEND = { ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't send files to Highwing. Update Hermes, then try again." } } as const
    const { read, save, fileId, saves } = rig({ kind: 'url', url: 'https://hermes.example.com' as never }, { sent: CANT_SEND })
    await read()
    expect(await save(fileId)).toEqual(CANT_SEND)
    expect(() => readdirSync(saves)).toThrow()
  })

  it('writes nothing when the connection switches while the file comes', async () => {
    const { read, save, fileId, saves, owner } = rig(FAR)
    await read()
    let switched = false
    const sending = owner.download
    owner.download = async file => {
      switched = true
      return sending(file)
    }
    expect(await save(fileId, RAE, () => !switched)).toEqual({ ok: false, refusal: { kind: 'stale', message: "Highwing switched to another Hermes, so it didn't send that." } })
    expect(() => readdirSync(saves)).toThrow()
  })
})
