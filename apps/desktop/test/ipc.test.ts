import { readdirSync, readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import type { Hermes, Route } from '@highwing/hermes'
import type { AttachmentId, BotActivities, Bots, CommandOutcome, Exported, Groups, Link, OpenChat, RelayDesk, Session, SessionId, Sidebar, SkillLibrary, SlashCatalog, SshHost } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyPush, CHANNEL, isWebLink, MAX_ATTACHMENTS, parseCommand, parseDraft, parseFileRequest, validators, type AppTopics, type Draft, type FileOutcome, type ImageOutcome, type ImageRequest, type Mode, type Preview, type PreviewCommand, type Push, type Snoozes, type Theme, type Topic } from '../src/ipc-contract'
import { feed, ownConnection, pinnedConnection, type ConnectionOwner } from '../src/main/connection'
import type { Opener } from '../src/main/files'
import type { ImageContext } from '../src/main/images'
import type { AttachSources, StageSource } from '../src/main/attachments'
import { COALESCE_MS, serveWindows, sessionPatch, type Attaching, type IpcEvent, type IpcMainLike, type PreviewOwner } from '../src/main/ipc'

const fixture = loadFixture('fixtures/errand.jsonl')
const topic = `session:${fixture.header.sessionId}` as const
let moments: readonly Session[] = []

beforeAll(async () => {
  const sessions: Session[] = []
  for await (const { session } of play(fixture)) sessions.push(session)
  moments = sessions
})

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PICTURE = `data:image/png;base64,${Buffer.from([...PNG, 1, 2, 3, 4]).toString('base64')}`
const OVERSIZED = `data:image/png;base64,${Buffer.concat([PNG, Buffer.alloc(2_000_001 - PNG.byteLength)]).toString('base64')}`
const HELD = { id: 'held-1' as AttachmentId, name: 'error.png', kind: 'image' as const, size: PNG.byteLength, mime: 'image/png', bytes: PNG }

const itemsOf = (session: Session) => (session.run.state === 'running' ? session.run.turn.items : [])
const patchPush = (rev: number, before: Session, after: Session): Push<typeof topic> => ({ topic, rev, patch: sessionPatch(before, after) })

describe('applyPush', () => {
  it('rebuilds every moment of the errand from the one before, keeping untouched items by reference', () => {
    for (let index = 1; index < moments.length; index++) {
      const [before, after] = [moments[index - 1]!, moments[index]!]
      const next = applyPush(before, 4, patchPush(5, before, after))
      if (next === 'need-full') throw new Error(`moment ${index} asked for a full value`)
      expect(next.rev).toBe(5)
      expect(next.value, `moment ${index}`).toEqual(after)
      const kept = itemsOf(before).filter((item, at) => itemsOf(after)[at] === item)
      kept.forEach(item => expect(itemsOf(next.value as Session)).toContain(item))
    }
  })

  it('appends a new item without resending the ones before it', () => {
    const index = moments.findIndex((after, at) => at > 0 && itemsOf(after).length > itemsOf(moments[at - 1]!).length && itemsOf(moments[at - 1]!).length > 0)
    const [before, after] = [moments[index - 1]!, moments[index]!]
    const push = patchPush(2, before, after)
    if (!('patch' in push) || push.patch.run.state !== 'running') throw new Error('expected a running patch')
    expect(push.patch.run.items.from).toBe(itemsOf(before).length)
    const next = applyPush(before, 1, push)
    expect(next !== 'need-full' && itemsOf(next.value as Session)[0]).toBe(itemsOf(before)[0])
  })

  it('replaces the last item in place when a delta grows it', () => {
    const index = moments.findIndex((after, at) => {
      const before = moments[at - 1]
      return before !== undefined && itemsOf(after).length === itemsOf(before).length && itemsOf(after).length > 0 && itemsOf(after).at(-1) !== itemsOf(before).at(-1)
    })
    const [before, after] = [moments[index - 1]!, moments[index]!]
    const push = patchPush(2, before, after)
    if (!('patch' in push) || push.patch.run.state !== 'running') throw new Error('expected a running patch')
    expect(push.patch.run.items).toEqual({ from: itemsOf(before).length - 1, items: [itemsOf(after).at(-1)] })
    expect(applyPush(before, 1, push)).toEqual({ value: after, rev: 2 })
  })

  it('takes a full value whatever it held', () => {
    const [first, last] = [moments[0]!, moments.at(-1)!]
    expect(applyPush<typeof topic>(first, 7, { topic, rev: 1, full: last })).toEqual({ value: last, rev: 1 })
    expect(applyPush<'link'>(undefined, 0, { topic: 'link', rev: 1, full: { state: 'online' } })).toEqual({ value: { state: 'online' }, rev: 1 })
  })

  it('asks for a full value on a revision gap or with nothing held', () => {
    const [before, after] = [moments[0]!, moments[1]!]
    expect(applyPush(before, 3, patchPush(5, before, after))).toBe('need-full')
    expect(applyPush(undefined, 0, patchPush(1, before, after))).toBe('need-full')
  })

  const fixtures = readdirSync('fixtures').filter(name => name.endsWith('.jsonl'))
  const onlyTextGrew = (before: Session, after: Session) => {
    const [held, grown] = [itemsOf(before), itemsOf(after)]
    const [last, next] = [held.at(-1), grown.at(-1)]
    return last?.kind === 'text' && next?.kind === 'text' && next.markdown.length > last.markdown.length
      && isDeepStrictEqual({ ...after, run: { ...after.run, turn: { ...(after.run as Extract<Session['run'], { state: 'running' }>).turn, items: held } } }, before)
  }

  it.each(fixtures)('rebuilds every published moment of %s from the one before, and sends no field a text delta left alone', async name => {
    const sessions: Session[] = []
    for await (const { session } of play(loadFixture(`fixtures/${name}`))) sessions.push(session)
    const streams = readFileSync(`fixtures/${name}`, 'utf8').includes('"message.delta"')
    let deltas = 0
    for (let index = 1; index < sessions.length; index++) {
      const [before, after] = [sessions[index - 1]!, sessions[index]!]
      const patch = sessionPatch(before, after)
      expect(applyPush(before, 0, { topic, rev: 1, patch }), `moment ${index}`).toEqual({ value: after, rev: 1 })
      if (!onlyTextGrew(before, after)) continue
      deltas++
      expect(patch.changed, `moment ${index}`).toEqual({})
    }
    expect(deltas > 0, 'a text delta sends no changed field whenever the fixture streams text').toBe(streams)
  })
})

describe('validators', () => {
  it('keep only the known fields of a good command', () => {
    expect(parseCommand({ do: 'send', sessionId: 's1', text: 'hello', extra: 'dropped' })).toEqual({ do: 'send', sessionId: 's1', text: 'hello', attachments: [] })
    expect(parseCommand({ do: 'send', sessionId: 's1', text: 'what is this', attachments: ['a-1', 'a-2'] }))
      .toEqual({ do: 'send', sessionId: 's1', text: 'what is this', attachments: ['a-1', 'a-2'] })
    expect(parseCommand({ do: 'answer', sessionId: 's1', promptId: 'p1', reply: { kind: 'choice', value: 'once', x: 1 } }))
      .toEqual({ do: 'answer', sessionId: 's1', promptId: 'p1', reply: { kind: 'choice', value: 'once' } })
    const request = (reply: object) => parseCommand({ do: 'answer', sessionId: 's1', requestId: 'r1', reply: { ...reply, x: 1 } })
    expect(request({ kind: 'secret', value: 'hunter2', identifier: 'ada' })).toEqual({ do: 'answer', sessionId: 's1', requestId: 'r1', reply: { kind: 'secret', value: 'hunter2', identifier: 'ada' } })
    expect(request({ kind: 'lock', question: 'q0', answer: ['a', 'b'] })).toEqual({ do: 'answer', sessionId: 's1', requestId: 'r1', reply: { kind: 'lock', question: 'q0', answer: ['a', 'b'] } })
    expect(request({ kind: 'lock', question: 'q0', answer: null })).toMatchObject({ reply: { kind: 'lock', answer: null } })
    expect(request({ kind: 'skip' })).toEqual({ do: 'answer', sessionId: 's1', requestId: 'r1', reply: { kind: 'skip' } })
    expect(request({ kind: 'connect', target: 'github', as: 'approved', values: { TOKEN: 't' } })).toEqual({ do: 'answer', sessionId: 's1', requestId: 'r1', reply: { kind: 'connect', target: 'github', as: 'approved', values: { TOKEN: 't' } } })
    expect(parseCommand({ do: 'reconnect', start: true })).toEqual({ do: 'reconnect', start: true })
    expect(parseCommand({ do: 'open', ref: { kind: 'bot', bot: 'research', sessionId: 's9' }, sessionId: 's9' })).toEqual({ do: 'open', ref: { kind: 'bot', bot: 'research' } })
    expect(parseCommand({ do: 'open', ref: { kind: 'new', bot: 'research', draftId: 'd1', sessionId: 's9' } })).toEqual({ do: 'open', ref: { kind: 'new', bot: 'research', draftId: 'd1' } })
    expect(parseCommand({ do: 'open', ref: { kind: 'new', bot: null, draftId: 'd1' } })).toEqual({ do: 'open', ref: { kind: 'new', bot: null, draftId: 'd1' } })
    expect(parseCommand({ do: 'open', ref: { kind: 'chat', sessionId: 's9', bot: 'research' } })).toEqual({ do: 'open', ref: { kind: 'chat', sessionId: 's9' } })
    expect(parseCommand({ do: 'open', ref: { kind: 'link', sessionId: 's9', bot: 'research' } })).toEqual({ do: 'open', ref: { kind: 'link', sessionId: 's9' } })
    expect(parseCommand({ do: 'start', chat: { kind: 'bot', bot: 'research', sessionId: null, draftId: 'd1' }, text: 'hello', sessionId: 's9' }))
      .toEqual({ do: 'start', chat: { kind: 'bot', bot: 'research', sessionId: null }, text: 'hello', attachments: [] })
    expect(parseCommand({ do: 'start', chat: { kind: 'new', bot: null, draftId: 'd1', sessionId: null }, text: 'hello' }))
      .toEqual({ do: 'start', chat: { kind: 'new', bot: null, draftId: 'd1', sessionId: null }, text: 'hello', attachments: [] })
    const model = { id: 'careful-large', provider: 'acme', providerName: 'Acme' }
    expect(parseCommand({ do: 'pickModel', sessionId: 's1', model: { ...model, price: 9 } })).toEqual({ do: 'pickModel', sessionId: 's1', model })
    expect(parseCommand({ do: 'tune', sessionId: 's1', set: 'yolo', on: false, extra: 1 })).toEqual({ do: 'tune', sessionId: 's1', set: 'yolo', on: false })
    expect(parseCommand({ do: 'tune', sessionId: 's1', set: 'fast', on: true })).toEqual({ do: 'tune', sessionId: 's1', set: 'fast', on: true })
    expect(parseCommand({ do: 'tune', sessionId: 's1', set: 'approvals', to: 'smart', on: true })).toEqual({ do: 'tune', sessionId: 's1', set: 'approvals', to: 'smart' })
    expect(parseCommand({ do: 'tune', sessionId: 's1', set: 'effort', to: 'xhigh', on: true })).toEqual({ do: 'tune', sessionId: 's1', set: 'effort', to: 'xhigh' })
    expect(parseCommand({ do: 'tune', sessionId: 's1', set: 'effort', to: 'default' })).toEqual({ do: 'tune', sessionId: 's1', set: 'effort', to: 'default' })
    expect(parseCommand({ do: 'move', sessionId: 's1', cwd: '/work/docs' })).toEqual({ do: 'move', sessionId: 's1', cwd: '/work/docs' })
    expect(parseCommand({ do: 'compress', sessionId: 's1', focus: null })).toEqual({ do: 'compress', sessionId: 's1', focus: null })
    expect(parseCommand({ do: 'export', sessionId: 's1', format: 'json', redact: true })).toEqual({ do: 'export', sessionId: 's1', format: 'json' })
    expect(parseCommand({ do: 'side', sessionId: 's1', kind: 'background', text: 'tidy the notes', extra: 1 })).toEqual({ do: 'side', sessionId: 's1', kind: 'background', text: 'tidy the notes' })
    expect(parseCommand({ do: 'pickModel', sessionId: 's1', model, confirm: 'tok' })).toEqual({ do: 'pickModel', sessionId: 's1', model, confirm: 'tok' })
  })

  it('keep the four fields of a new bot, and the bot whose models are listed or null for the socket\'s own', () => {
    const model = { id: 'careful-large', provider: 'acme', providerName: 'Acme' }
    const draft = { name: 'Rae', description: '', model, persona: 'You write short reports.\n' }
    expect(parseCommand({ do: 'createBot', draft: { ...draft, extra: 1, model: { ...model, price: 9 } }, picture: null, extra: 1 })).toEqual({ do: 'createBot', draft, picture: null })
    expect(parseCommand({ do: 'createBot', draft: { ...draft, model: null }, picture: null })).toEqual({ do: 'createBot', draft: { ...draft, model: null }, picture: null })
    expect(parseCommand({ do: 'botModels', bot: null, extra: 1 })).toEqual({ do: 'botModels', bot: null })
    expect(parseCommand({ do: 'botModels', bot: 'research' })).toEqual({ do: 'botModels', bot: 'research' })
  })

  it("keep a new bot's picture typed by its bytes, and the calls that draw a picture and list pets", () => {
    const draft = { name: 'Rae', description: '', model: null, persona: '' }
    expect(parseCommand({ do: 'createBot', draft, picture: PICTURE })).toEqual({ do: 'createBot', draft, picture: PICTURE })
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]).toString('base64')
    expect(parseCommand({ do: 'createBot', draft, picture: `data:image/png;base64,${jpeg}` })).toEqual({ do: 'createBot', draft, picture: `data:image/jpeg;base64,${jpeg}` })
    expect(parseCommand({ do: 'canGeneratePicture', extra: 1 })).toEqual({ do: 'canGeneratePicture' })
    expect(parseCommand({ do: 'generatePicture', prompt: 'a cheerful robot', extra: 1 })).toEqual({ do: 'generatePicture', prompt: 'a cheerful robot' })
    expect(parseCommand({ do: 'pets', extra: 1 })).toEqual({ do: 'pets' })
    expect(parseCommand({ do: 'petPicture', slug: 'tabby', url: 'https://petdex.example/tabby.webp', name: 'Tabby' })).toEqual({ do: 'petPicture', slug: 'tabby', url: 'https://petdex.example/tabby.webp' })
    expect(parseCommand({ do: 'petPicture', slug: 'mochi', url: null })).toEqual({ do: 'petPicture', slug: 'mochi', url: null })
    expect(parseCommand({ do: 'petPicture', slug: 'mr.whiskers', url: null })).toEqual({ do: 'petPicture', slug: 'mr.whiskers', url: null })
  })

  it('keep a path completion to a chat and the mention typed', () => {
    expect(parseCommand({ do: 'completePath', sessionId: 's1', word: '@not', extra: 1 })).toEqual({ do: 'completePath', sessionId: 's1', word: '@not' })
  })

  it("keep a bot's edited fields as sent, with the revision it was read at, and a window's removal of a picture", () => {
    expect(parseCommand({ do: 'describeBot', bot: 'rae', extra: 1 })).toEqual({ do: 'describeBot', bot: 'rae' })
    expect(parseCommand({ do: 'markBot', bot: 'rae', mark: 'hide', extra: 1 })).toEqual({ do: 'markBot', bot: 'rae', mark: 'hide' })
    expect(parseCommand({ do: 'open', ref: { kind: 'new', bot: 'rae', draftId: 'd1', upFront: true }, upFront: true }))
      .toEqual({ do: 'open', ref: { kind: 'new', bot: 'rae', draftId: 'd1' }, upFront: true })
    expect(parseCommand({ do: 'editBot', bot: 'rae', edit: { persona: ' Plain.\n', extra: 1 }, revision: 2 })).toEqual({ do: 'editBot', bot: 'rae', edit: { persona: ' Plain.\n' }, revision: 2 })
    expect(parseCommand({ do: 'editBot', bot: 'rae', edit: { name: 'Ray', description: '' }, revision: null }))
      .toEqual({ do: 'editBot', bot: 'rae', edit: { name: 'Ray', description: '' }, revision: null })
    expect(parseCommand({ do: 'removeBotPicture', bot: 'rae', data: 'x' })).toEqual({ do: 'removeBotPicture', bot: 'rae' })
    expect(parseCommand({ do: 'botPicture', bot: 'rae' })).toEqual({ do: 'botPicture', bot: 'rae' })
  })

  it('keep the panel commands: a process, a helper, a control button with what it takes, a checkpoint and its scope, and an emoji or none on a turn', () => {
    expect(parseCommand({ do: 'killProcess', sessionId: 's1', processId: 'proc_1', extra: 1 })).toEqual({ do: 'killProcess', sessionId: 's1', processId: 'proc_1' })
    expect(parseCommand({ do: 'stopHelper', sessionId: 's1', helperId: 'sa-0-1', text: 'steer' })).toEqual({ do: 'stopHelper', sessionId: 's1', helperId: 'sa-0-1' })
    expect(parseCommand({ do: 'control', sessionId: 's1', action: { act: 'goal.pause', text: 'ignored' } })).toEqual({ do: 'control', sessionId: 's1', action: { act: 'goal.pause' } })
    expect(parseCommand({ do: 'control', sessionId: 's1', action: { act: 'subgoal.add', text: 'tests pass' } })).toEqual({ do: 'control', sessionId: 's1', action: { act: 'subgoal.add', text: 'tests pass' } })
    expect(parseCommand({ do: 'control', sessionId: 's1', action: { act: 'subgoal.remove', index: 2 } })).toEqual({ do: 'control', sessionId: 's1', action: { act: 'subgoal.remove', index: 2 } })
    expect(parseCommand({ do: 'checkpoints', sessionId: 's1' })).toEqual({ do: 'checkpoints', sessionId: 's1' })
    expect(parseCommand({ do: 'checkpointDiff', sessionId: 's1', checkpoint: 'abc123' })).toEqual({ do: 'checkpointDiff', sessionId: 's1', checkpoint: 'abc123' })
    const folder = { do: 'restore', sessionId: 's1', checkpoint: 'abc123', scope: { kind: 'folder', edits: 'keep' } }
    expect(parseCommand({ ...folder, scope: { ...folder.scope, path: 'ignored' } })).toEqual(folder)
    expect(parseCommand({ ...folder, scope: { kind: 'file', path: 'notes.md' } })).toEqual({ ...folder, scope: { kind: 'file', path: 'notes.md' } })
    expect(parseCommand({ do: 'react', sessionId: 's1', turn: 't1', emoji: '👍' })).toEqual({ do: 'react', sessionId: 's1', turn: 't1', emoji: '👍' })
    expect(parseCommand({ do: 'react', sessionId: 's1', turn: 't1', emoji: null })).toEqual({ do: 'react', sessionId: 's1', turn: 't1', emoji: null })
  })

  it('keep a rewind to a stored row and the text to send there', () => {
    expect(parseCommand({ do: 'rewind', sessionId: 's1', rowId: 7, text: 'again', extra: 1 })).toEqual({ do: 'rewind', sessionId: 's1', rowId: 7, text: 'again' })
  })

  it('keep a branch from a stored row with the key that names it', () => {
    expect(parseCommand({ do: 'branch', sessionId: 's1', rowId: 3, branchId: 'b1', extra: 1 })).toEqual({ do: 'branch', sessionId: 's1', rowId: 3, branchId: 'b1' })
  })

  it('keep an archive or a removal of a chat, and refuse one that names no chat', () => {
    expect(parseCommand({ do: 'archive', sessionId: 's1', archived: true, extra: 1 })).toEqual({ do: 'archive', sessionId: 's1', archived: true })
    expect(parseCommand({ do: 'archive', sessionId: 's1', archived: 'yes' })).toBeNull()
    expect(parseCommand({ do: 'remove', sessionId: 's1', extra: 1 })).toEqual({ do: 'remove', sessionId: 's1' })
    expect(parseCommand({ do: 'remove', sessionId: ' ' })).toBeNull()
    expect(parseCommand({ do: 'remove' })).toBeNull()
  })

  it('keep a pin or an unpin of a chat, and refuse one that says neither', () => {
    expect(parseCommand({ do: 'pin', sessionId: 's1', pinned: true, extra: 1 })).toEqual({ do: 'pin', sessionId: 's1', pinned: true })
    expect(parseCommand({ do: 'pin', sessionId: 's1', pinned: false })).toEqual({ do: 'pin', sessionId: 's1', pinned: false })
    expect(parseCommand({ do: 'pin', sessionId: 's1' })).toBeNull()
    expect(parseCommand({ do: 'pin', pinned: true })).toBeNull()
  })

  it('keep an ask for the versions of a chat, and refuse one that names no chat', () => {
    expect(parseCommand({ do: 'versions', sessionId: 's1', extra: 1 })).toEqual({ do: 'versions', sessionId: 's1' })
    expect(parseCommand({ do: 'versions', sessionId: ' ' })).toBeNull()
    expect(parseCommand({ do: 'versions' })).toBeNull()
  })

  it('read the queue actions, the busy mode and a denial with words, and drop keys the command does not have', () => {
    const row = { do: 'queued', sessionId: 's1', admissionId: 'a1' }
    expect(parseCommand({ ...row, action: 'sendNow', text: 'ignored' })).toEqual({ ...row, action: 'sendNow' })
    expect(parseCommand({ ...row, action: 'edit', text: 'new words' })).toEqual({ ...row, action: 'edit', text: 'new words' })
    expect(parseCommand({ do: 'tune', sessionId: 's1', set: 'busy', to: 'steer' })).toEqual({ do: 'tune', sessionId: 's1', set: 'busy', to: 'steer' })
    const deny = { do: 'answer', sessionId: 's1', promptId: 'p1', reply: { kind: 'deny', tell: 'use trash-put instead' } }
    expect(parseCommand(deny)).toEqual(deny)
  })

  it('read a target with the parser the settings file uses', () => {
    expect(parseCommand({ do: 'checkTarget', target: { kind: 'remote', host: ' hermes-host.example-tailnet.ts.net ', port: 22 } }))
      .toEqual({ do: 'checkTarget', target: { kind: 'remote', host: 'hermes-host.example-tailnet.ts.net' } })
    expect(parseCommand({ do: 'checkTarget', target: { kind: 'local' } })).toEqual({ do: 'checkTarget', target: { kind: 'local' } })
    expect(parseCommand({ do: 'checkTarget', target: { kind: 'url', url: 'https://hermes.example.com', token: 'dropped' } }))
      .toEqual({ do: 'checkTarget', target: { kind: 'url', url: 'https://hermes.example.com' } })
    expect(parseCommand({ do: 'editTarget', target: { kind: 'local' } })).toEqual({ do: 'editTarget' })
  })

  it.each([
    ['a target ssh would read as an option', { do: 'checkTarget', target: { kind: 'remote', host: '-oProxyCommand=true' } }],
    ['a check with no target', { do: 'checkTarget' }],
    ['a check of an address that holds a password', { do: 'checkTarget', target: { kind: 'url', url: 'https://ada:secret@hermes.example.com' } }],
    ['a check of an address the form would have spelled another way', { do: 'checkTarget', target: { kind: 'url', url: 'hermes.example.com' } }],
    ['not an object', 'send'],
    ['an unknown verb', { do: 'format-disk' }],
    ['a verb from the prototype', { do: 'toString' }],
    ['an empty session id', { do: 'stop', sessionId: '' }],
    ['a blank message', { do: 'send', sessionId: 's1', text: '   ' }],
    ['a rewind to row zero', { do: 'rewind', sessionId: 's1', rowId: 0, text: 'again' }],
    ['a rewind to a fractional row', { do: 'rewind', sessionId: 's1', rowId: 1.5, text: 'again' }],
    ['a rewind to a row named as text', { do: 'rewind', sessionId: 's1', rowId: '7', text: 'again' }],
    ['a rewind with a blank message', { do: 'rewind', sessionId: 's1', rowId: 7, text: ' ' }],
    ['a branch from row zero', { do: 'branch', sessionId: 's1', rowId: 0, branchId: 'b1' }],
    ['a branch from a row named as text', { do: 'branch', sessionId: 's1', rowId: '3', branchId: 'b1' }],
    ['a branch with no key', { do: 'branch', sessionId: 's1', rowId: 3 }],
    ['a branch with a blank key', { do: 'branch', sessionId: 's1', rowId: 3, branchId: ' ' }],
    ['an open that names no chat', { do: 'open' }],
    ['an open of a kind of chat Highwing does not know', { do: 'open', ref: { kind: 'session', sessionId: 's1' } }],
    ['an open of a bot with no name', { do: 'open', ref: { kind: 'bot', bot: ' ' } }],
    ['an open of a new chat with no draft id', { do: 'open', ref: { kind: 'new', bot: 'research', draftId: ' ' } }],
    ['an open of a new chat whose bot is not a name or null', { do: 'open', ref: { kind: 'new', draftId: 'd1' } }],
    ['a first message with no chat', { do: 'start', text: 'hello' }],
    ['a message whose attachments are not a list', { do: 'send', sessionId: 's1', text: 'hello', attachments: 'a-1' }],
    ['a message with a blank attachment id', { do: 'send', sessionId: 's1', text: 'hello', attachments: ['a-1', ' '] }],
    ['a message that names an attachment by more than its id', { do: 'send', sessionId: 's1', text: 'hello', attachments: [{ id: 'a-1', name: 'x.png', kind: 'image' }] }],
    ['a message with more attachments than any message could hold', { do: 'send', sessionId: 's1', text: 'hello', attachments: Array.from({ length: 65 }, (_, i) => `a-${i}`) }],
    ['a first message whose attachments are not a list', { do: 'start', chat: { kind: 'new', bot: null, draftId: 'd1', sessionId: null }, text: 'hello', attachments: {} }],
    ['a first message to a chat that has a session', { do: 'start', chat: { kind: 'new', bot: null, draftId: 'd1', sessionId: 's1' }, text: 'hello' }],
    ['a first message to a chat with no session named', { do: 'start', chat: { kind: 'bot', bot: 'research' }, text: 'hello' }],
    ['a first message to a plain chat', { do: 'start', chat: { kind: 'chat', bot: null, sessionId: null }, text: 'hello' }],
    ['a first message to a chat picked from the list', { do: 'start', chat: { kind: 'chat', sessionId: 's1' }, text: 'hello' }],
    ['an open of a picked chat with no session', { do: 'open', ref: { kind: 'chat', sessionId: ' ' } }],
    ['an open of a linked chat with no session', { do: 'open', ref: { kind: 'link', sessionId: ' ' } }],
    ['a new bot with no name', { do: 'createBot', draft: { name: ' ', description: '', model: null, persona: '' } }],
    ['a new bot whose description is not text', { do: 'createBot', draft: { name: 'Rae', description: 7, model: null, persona: '' } }],
    ['a new bot whose persona is missing', { do: 'createBot', draft: { name: 'Rae', description: '', model: null } }],
    ['a new bot whose model is not a model', { do: 'createBot', draft: { name: 'Rae', description: '', model: { id: 'm' }, persona: '' } }],
    ['a new bot whose model is left out', { do: 'createBot', draft: { name: 'Rae', description: '', persona: '' } }],
    ['a new bot with no draft', { do: 'createBot', picture: null }],
    ['a new bot with no picture named', { do: 'createBot', draft: { name: 'Rae', description: '', model: null, persona: '' } }],
    ['a new bot whose picture is text', { do: 'createBot', draft: { name: 'Rae', description: '', model: null, persona: '' }, picture: `data:image/png;base64,${Buffer.from('not a picture').toString('base64')}` }],
    ['a new bot whose picture is a GIF', { do: 'createBot', draft: { name: 'Rae', description: '', model: null, persona: '' }, picture: `data:image/gif;base64,${Buffer.from('GIF89a').toString('base64')}` }],
    ['a new bot whose picture is over 2 MB', { do: 'createBot', draft: { name: 'Rae', description: '', model: null, persona: '' }, picture: OVERSIZED }],
    ['a new bot whose picture is a file path', { do: 'createBot', draft: { name: 'Rae', description: '', model: null, persona: '' }, picture: '/home/me/rae.png' }],
    ['a drawing with no prompt', { do: 'generatePicture', prompt: '  ' }],
    ['a pet picture with no slug', { do: 'petPicture', slug: '', url: null }],
    ['a pet picture whose sheet is not a web address', { do: 'petPicture', slug: 'tabby', url: 'file:///etc/passwd' }],
    ['a pet picture with no sheet named', { do: 'petPicture', slug: 'tabby' }],
    ['a pet picture whose slug climbs out of the pets folder', { do: 'petPicture', slug: '../../x', url: null }],
    ['a pet picture whose slug is a full path', { do: 'petPicture', slug: '/abs', url: null }],
    ['a pet picture whose slug holds a slash', { do: 'petPicture', slug: 'pets/tabby', url: null }],
    ['a pet picture whose slug holds a backslash', { do: 'petPicture', slug: 'a\\b', url: null }],
    ['a pet picture whose slug starts with a Windows drive', { do: 'petPicture', slug: 'D:x', url: null }],
    ['a pet picture whose slug holds a colon', { do: 'petPicture', slug: 'tab:by', url: null }],
    ['a pet picture whose slug is the folder itself', { do: 'petPicture', slug: '.', url: null }],
    ['a pet picture whose slug is the folder above', { do: 'petPicture', slug: '..', url: null }],
    ['a pet picture whose slug has spaces Hermes would trim', { do: 'petPicture', slug: ' tabby', url: null }],
    ['a model list for a bot with no name', { do: 'botModels', bot: ' ' }],
    ['a model list that names no bot', { do: 'botModels' }],
    ['details of a bot with no name', { do: 'describeBot', bot: '' }],
    ['an edit that changes nothing', { do: 'editBot', bot: 'rae', edit: {}, revision: 2 }],
    ['a mark that is not one of the four', { do: 'markBot', bot: 'rae', mark: 'flip' }],
    ['an up-front open of a bot\'s chat', { do: 'open', ref: { kind: 'bot', bot: 'rae' }, upFront: true }],
    ['an up-front open of a new chat in no bot', { do: 'open', ref: { kind: 'new', bot: null, draftId: 'd1' }, upFront: true }],
    ['an up-front flag that is not true', { do: 'open', ref: { kind: 'new', bot: 'rae', draftId: 'd1' }, upFront: false }],
    ['a mark for a bot with no name', { do: 'markBot', bot: ' ', mark: 'pin' }],
    ['a roster refresh, which only Electron main asks for', { do: 'refreshBots' }],
    ['an edit to a blank name', { do: 'editBot', bot: 'rae', edit: { name: '  ' }, revision: 2 }],
    ['an edit whose persona is not text', { do: 'editBot', bot: 'rae', edit: { persona: 7 }, revision: 2 }],
    ['an edit with no revision', { do: 'editBot', bot: 'rae', edit: { persona: 'x' } }],
    ['an edit at a negative revision', { do: 'editBot', bot: 'rae', edit: { persona: 'x' }, revision: -1 }],
    ['an edit at a fractional revision', { do: 'editBot', bot: 'rae', edit: { persona: 'x' }, revision: 1.5 }],
    ['a picture a window sends as bytes', { do: 'setBotPicture', bot: 'rae', data: 'data:image/png;base64,iVBORw0KGgo=' }],
    ['a picture removal for a bot with no name', { do: 'removeBotPicture', bot: ' ' }],
    ['the picture of a bot with no name', { do: 'botPicture', bot: ' ' }],
    ['a blank first message', { do: 'start', chat: { kind: 'bot', bot: 'research', sessionId: null }, text: '' }],
    ['a reply of the wrong kind', { do: 'answer', sessionId: 's1', promptId: 'p1', reply: { kind: 'choice', value: 1 } }],
    ['a prompt answered with a request\'s reply', { do: 'answer', sessionId: 's1', promptId: 'p1', reply: { kind: 'skip' } }],
    ['a request answered with a prompt\'s reply', { do: 'answer', sessionId: 's1', requestId: 'r1', reply: { kind: 'choice', value: 'once' } }],
    ['a secret with no value', { do: 'answer', sessionId: 's1', requestId: 'r1', reply: { kind: 'secret' } }],
    ['a lock whose answer is one string', { do: 'answer', sessionId: 's1', requestId: 'r1', reply: { kind: 'lock', question: 'q0', answer: 'prod' } }],
    ['a connector answer with a value that is not text', { do: 'answer', sessionId: 's1', requestId: 'r1', reply: { kind: 'connect', target: 'github', as: 'approved', values: { TOKEN: 1 } } }],
    ['a denial that tells Hermes nothing', { do: 'answer', sessionId: 's1', promptId: 'p1', reply: { kind: 'deny', tell: ' ' } }],
    ['an action a queue row never offers', { do: 'queued', sessionId: 's1', admissionId: 'a1', action: 'reorder' }],
    ['a queue action that names no row', { do: 'queued', sessionId: 's1', action: 'cancel' }],
    ['an edit with no text', { do: 'queued', sessionId: 's1', admissionId: 'a1', action: 'edit', text: '' }],
    ['a busy mode Hermes does not have', { do: 'tune', sessionId: 's1', set: 'busy', to: 'drop' }],
    ['a non-boolean start', { do: 'reconnect', start: 'yes' }],
    ['a move to no folder', { do: 'move', sessionId: 's1', cwd: ' ' }],
    ['a compression with a blank focus', { do: 'compress', sessionId: 's1', focus: '' }],
    ['an export in a format Hermes does not render', { do: 'export', sessionId: 's1', format: 'pdf' }],
    ['a side prompt of no kind Hermes has', { do: 'side', sessionId: 's1', kind: 'aside', text: 'why?' }],
    ['a side question with no words', { do: 'side', sessionId: 's1', kind: 'btw', text: ' ' }],
    ['an effort Hermes does not take', { do: 'tune', sessionId: 's1', set: 'effort', to: 'turbo' }],
    ['a fast switch with a word for on', { do: 'tune', sessionId: 's1', set: 'fast', on: 'on' }],
    ['a YOLO switch with a word for on', { do: 'tune', sessionId: 's1', set: 'yolo', on: 'on' }],
    ['an approval mode Hermes does not have', { do: 'tune', sessionId: 's1', set: 'approvals', to: 'auto' }],
    ['a path completion for a word that is not a mention', { do: 'completePath', sessionId: 's1', word: 'not' }],
    ['a path completion with no word', { do: 'completePath', sessionId: 's1' }],
    ['a YOLO switch with no chat', { do: 'tune', set: 'yolo', on: true }],
    ['a pick with no provider', { do: 'pickModel', sessionId: 's1', model: { id: 'm', provider: '', providerName: '' } }],
    ['a pick with a blank confirm token', { do: 'pickModel', sessionId: 's1', model: { id: 'm', provider: 'p', providerName: 'P' }, confirm: ' ' }],
    ['a kill that names no process', { do: 'killProcess', sessionId: 's1', processId: ' ' }],
    ['a stop that names no helper', { do: 'stopHelper', sessionId: 's1', helperId: ' ' }],
    ['a stop of a helper in no chat', { do: 'stopHelper', helperId: 'sa-0-1' }],
    ['a button Hermes does not serve', { do: 'control', sessionId: 's1', action: { act: 'goal.delete' } }],
    ['a criterion with no words', { do: 'control', sessionId: 's1', action: { act: 'subgoal.add', text: ' ' } }],
    ['a criterion removed at place zero', { do: 'control', sessionId: 's1', action: { act: 'subgoal.remove', index: 0 } }],
    ['a diff of no checkpoint', { do: 'checkpointDiff', sessionId: 's1', checkpoint: '' }],
    ['a restore of a scope Hermes does not have', { do: 'restore', sessionId: 's1', checkpoint: 'abc123', scope: { kind: 'folder', edits: 'merge' } }],
    ['a restore of a file with no path', { do: 'restore', sessionId: 's1', checkpoint: 'abc123', scope: { kind: 'file', path: ' ' } }],
    ['a blank emoji', { do: 'react', sessionId: 's1', turn: 't1', emoji: ' ' }],
    ['a reaction on no turn', { do: 'react', sessionId: 's1', emoji: '👍' }],
    ['a mode Highwing does not have', { do: 'setMode', mode: 'inbox' }],
    ['a mode switch that names no mode', { do: 'setMode' }],
    ['a theme Highwing does not have', { do: 'setTheme', theme: 'sepia' }],
    ['a theme pick that names no theme', { do: 'setTheme' }],
    ['a rename with AI of no chat', { do: 'retitle' }],
    ['a snooze of no chat', { do: 'snooze', until: 1_800_000_000_000 }],
    ['a snooze to no time', { do: 'snooze', sessionId: 's1' }],
    ['a snooze to a time that is no whole number', { do: 'snooze', sessionId: 's1', until: 1.5 }],
    ['a snooze to a time before 1970', { do: 'snooze', sessionId: 's1', until: -1 }],
    ['a snooze to a time as text', { do: 'snooze', sessionId: 's1', until: '1800000000000' }]
  ])('refuse %s', (_, raw) => {
    expect(parseCommand(raw)).toBeNull()
  })

  it('keep a web page to preview or browse, and where the page sits', () => {
    expect(parseCommand({ do: 'preview', url: 'http://localhost:5173/', label: 'x' })).toEqual({ do: 'preview', url: 'http://localhost:5173/' })
    expect(parseCommand({ do: 'browse', url: 'https://example.com/docs' })).toEqual({ do: 'browse', url: 'https://example.com/docs' })
    expect(parseCommand({ do: 'placePreview', rect: { x: 600, y: 56, width: 580, height: 804, z: 1 } })).toEqual({ do: 'placePreview', rect: { x: 600, y: 56, width: 580, height: 804 } })
    expect(parseCommand({ do: 'placePreview', rect: null })).toEqual({ do: 'placePreview', rect: null })
    expect(parseCommand({ do: 'openPreview', path: '/etc/passwd' })).toEqual({ do: 'openPreview' })
  })

  it('keep a new group chat whose name and bots Hermes could take, trimmed and in the order given', () => {
    const draft = { group: 'launch-plan', name: ' Launch plan ', bots: ['default', 'sam', 'juno'] }
    expect(parseCommand({ do: 'createGroup', draft: { ...draft, colour: 'ink' }, extra: 1 })).toEqual({ do: 'createGroup', draft: { ...draft, name: 'Launch plan' } })
    expect(parseCommand({ do: 'createGroup', draft: { ...draft, bots: ['a', 'b', 'c', 'd', 'e', 'f'], name: 'x'.repeat(200) } })).toMatchObject({ draft: { bots: { length: 6 } } })
  })

  it.each([
    ['no draft', {}],
    ['an id Hermes would not take', { draft: { group: 'launch plan', name: 'Launch plan', bots: ['default', 'sam'] } }],
    ['a blank name', { draft: { group: 'g', name: '  ', bots: ['default', 'sam'] } }],
    ['a name too long for Hermes', { draft: { group: 'g', name: 'x'.repeat(201), bots: ['default', 'sam'] } }],
    ['one bot', { draft: { group: 'g', name: 'G', bots: ['default'] } }],
    ['seven bots', { draft: { group: 'g', name: 'G', bots: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } }],
    ['a bot twice', { draft: { group: 'g', name: 'G', bots: ['sam', 'sam'] } }],
    ['a blank bot', { draft: { group: 'g', name: 'G', bots: ['sam', ' '] } }]
  ])('refuse a new group chat with %s', (_, raw) => {
    expect(parseCommand({ do: 'createGroup', ...raw })).toBeNull()
  })

  it('keep a message and a Stop for a group Hermes could name, and open it by its id', () => {
    expect(parseCommand({ do: 'sendToGroup', group: 'launch-plan', text: '@sam go', extra: 1 })).toEqual({ do: 'sendToGroup', group: 'launch-plan', text: '@sam go' })
    expect(parseCommand({ do: 'stopGroup', group: 'launch-plan', cancel: 'all' })).toEqual({ do: 'stopGroup', group: 'launch-plan' })
    expect(parseCommand({ do: 'deleteGroup', group: 'launch-plan', cancel_id: 'x' })).toEqual({ do: 'deleteGroup', group: 'launch-plan' })
    expect(parseCommand({ do: 'open', ref: { kind: 'group', group: 'launch-plan', over: 'sam' } })).toEqual({ do: 'open', ref: { kind: 'group', group: 'launch-plan' } })
  })

  it('keep a group chat rename trimmed, up to the 200 characters Hermes takes', () => {
    expect(parseCommand({ do: 'renameGroup', group: 'launch-plan', name: '  Ship plan ', event_id: 'e1' })).toEqual({ do: 'renameGroup', group: 'launch-plan', name: 'Ship plan' })
    expect(parseCommand({ do: 'renameGroup', group: 'launch-plan', name: ` ${'x'.repeat(200)} ` })).toMatchObject({ name: 'x'.repeat(200) })
  })

  it.each([
    ['a rename to a blank name', { do: 'renameGroup', group: 'launch-plan', name: '   ' }],
    ['a rename to a name too long for Hermes', { do: 'renameGroup', group: 'launch-plan', name: 'x'.repeat(201) }],
    ['a rename with no name', { do: 'renameGroup', group: 'launch-plan' }],
    ['a rename of an id Hermes would not take', { do: 'renameGroup', group: 'launch plan', name: 'Ship plan' }],
    ['a delete of no group', { do: 'deleteGroup' }],
    ['a delete of an id Hermes would not take', { do: 'deleteGroup', group: '-plan' }],
    ['a message with no words', { do: 'sendToGroup', group: 'launch-plan', text: '  ' }],
    ['a message to an id Hermes would not take', { do: 'sendToGroup', group: 'launch plan', text: 'hi' }],
    ['a Stop of no group', { do: 'stopGroup' }],
    ['an open of a group with no id', { do: 'open', ref: { kind: 'group' } }],
    ['a first message that would start a group', { do: 'start', chat: { kind: 'group', group: 'launch-plan', sessionId: null }, text: 'hi' }]
  ])('refuse %s', (_, raw) => {
    expect(parseCommand(raw)).toBeNull()
  })

  it('keep a mode switch', () => {
    expect(parseCommand({ do: 'setMode', mode: 'chats', extra: 1 })).toEqual({ do: 'setMode', mode: 'chats' })
    expect(parseCommand({ do: 'setMode', mode: 'bots' })).toEqual({ do: 'setMode', mode: 'bots' })
  })

  it.each(['system', 'light', 'dark'] satisfies Theme[])('keep a pick of the %s theme', theme => {
    expect(parseCommand({ do: 'setTheme', theme, extra: 1 })).toEqual({ do: 'setTheme', theme })
  })

  it('keep a snooze and a wake', () => {
    expect(parseCommand({ do: 'snooze', sessionId: 's1', until: 1_800_000_000_000, extra: 1 })).toEqual({ do: 'snooze', sessionId: 's1', until: 1_800_000_000_000 })
    expect(parseCommand({ do: 'snooze', sessionId: 's1', until: null })).toEqual({ do: 'snooze', sessionId: 's1', until: null })
  })

  it.each([
    'mailto:someone@example.com', 'file:///etc/passwd', 'javascript:alert(1)', '/tmp/site/index.html', 'highwing://chat', ''
  ])('refuse to preview or browse %s', url => {
    expect(parseCommand({ do: 'preview', url })).toBeNull()
    expect(parseCommand({ do: 'browse', url })).toBeNull()
  })

  it.each([
    ['no rect', {}],
    ['a negative place', { rect: { x: -1, y: 0, width: 10, height: 10 } }],
    ['a size that is no number', { rect: { x: 0, y: 0, width: '10', height: 10 } }],
    ['an endless size', { rect: { x: 0, y: 0, width: Infinity, height: 10 } }]
  ])('refuse a place for the page with %s', (_, raw) => {
    expect(parseCommand({ do: 'placePreview', ...raw })).toBeNull()
  })

  it('cover every command verb', () => {
    expect(Object.keys(validators).sort()).toEqual([
      'answer', 'archive', 'botModels', 'botPicture', 'branch', 'browse', 'canGeneratePicture', 'checkTarget', 'checkpointDiff', 'checkpoints',
      'closePreview', 'completePath', 'compress', 'contextBreakdown', 'control', 'createBot', 'createGroup', 'deleteGroup', 'describeBot', 'discard', 'editBot',
      'editTarget', 'export', 'generatePicture', 'keepTarget', 'killProcess', 'loadEarlier', 'markBot', 'models', 'move', 'open', 'openPreview',
      'petPicture', 'pets', 'pickModel', 'pin', 'placePreview', 'preview', 'queued', 'react', 'reconnect', 'reloadPreview', 'remove', 'removeBotPicture', 'rename', 'renameGroup',
      'restore', 'retitle', 'rewind', 'send', 'sendToGroup', 'setMode', 'setSkill', 'setTheme', 'side', 'skillText', 'snooze', 'start', 'stop', 'stopCheck', 'stopGroup', 'stopHelper', 'tune', 'versions'
    ])
  })
})

const still = <T>(value: T) => ({ get: () => value, subscribe: () => () => {} })
const LINK: Link = { state: 'blocked', why: 'hermes-missing', message: 'A link of this test.' }
const SIDEBAR: Sidebar = { bot: null, status: 'stale', rows: [], complete: true }
const NO_BOTS: Bots = { state: 'listed', roster: { featured: null, sections: [] }, edition: 1 }
const NOTHING_OPEN: OpenChat = { shown: null, opening: null, missing: null }
const NO_RELAYS: RelayDesk = { supported: false, bySession: {} }
const NO_GROUPS: Groups = { state: 'unsupported' }
const RESEARCH_WAITING = { research: 'waiting' } as BotActivities

/** An owner live on a remote machine, whose every check passes, so a check of this computer switches to it at epoch 2. */
const switchable = (hermes: Hermes) => ownConnection({
  loaded: { state: 'saved', target: { kind: 'remote', host: 'box' as SshHost } },
  save: async () => {},
  check: async () => ({ ok: true }),
  routeFor: () => ({ dial: async () => { throw new Error('the test never dials') }, dispose: () => {} }) as unknown as Route,
  open: () => ({ ...hermes, close: async () => {} })
})

function harness(ownerOf: (hermes: Hermes) => ConnectionOwner = pinnedConnection) {
  const listeners = new Map<string, (event: IpcEvent, ...args: unknown[]) => void>()
  const handlers = new Map<string, (event: IpcEvent, ...args: unknown[]) => unknown>()
  const ipc: IpcMainLike = {
    on: (channel, listener) => listeners.set(channel, listener),
    handle: (channel, handler) => void handlers.set(channel, handler),
    removeAllListeners: channel => listeners.delete(channel),
    removeHandler: channel => void handlers.delete(channel)
  }
  const pushes: Push[] = []
  const destroyed: (() => void)[] = []
  const event = (url = 'app://index.html', senderId = 1): IpcEvent => ({
    sender: { id: senderId, send: (_channel, _id, push) => void pushes.push(push as Push), isDestroyed: () => false, once: (_name, listener) => destroyed.push(listener) },
    senderFrame: { url, parent: null }
  })
  let emit: (session: Session) => void = () => {}
  const commands: unknown[] = []
  let exported: CommandOutcome<Exported> = { ok: true, value: { filename: 'chat.md', content: '# Notes' } }
  let savedAt: Promise<string | null> = Promise.resolve('/home/u/Downloads/chat.md')
  let catalog: SlashCatalog = []
  const catalogListeners = new Set<(value: SlashCatalog) => void>()
  let bots: Bots = { state: 'loading' }
  const botsListeners = new Set<(value: Bots) => void>()
  let open = NOTHING_OPEN
  const openListeners = new Set<(value: OpenChat) => void>()
  const hermes = {
    link: still(LINK),
    sidebar: still(SIDEBAR),
    open: {
      get: () => open,
      subscribe: (listener: (value: OpenChat) => void) => {
        openListeners.add(listener)
        return () => void openListeners.delete(listener)
      }
    },
    bots: {
      get: () => bots,
      subscribe: (listener: (value: Bots) => void) => {
        botsListeners.add(listener)
        return () => void botsListeners.delete(listener)
      }
    },
    relay: still(NO_RELAYS),
    groups: still(NO_GROUPS),
    groupChat: still(null),
    activity: still(RESEARCH_WAITING),
    slash: {
      get: () => catalog,
      subscribe: (listener: (value: SlashCatalog) => void) => {
        catalogListeners.add(listener)
        return () => void catalogListeners.delete(listener)
      }
    },
    watch: (_id: unknown, listener: (session: Session) => void) => {
      emit = listener
      listener(moments[0]!)
      return () => { emit = () => {} }
    },
    watchSkills: (listener: (library: SkillLibrary) => void) => {
      listener({ state: 'reading', bot: null })
      return () => {}
    },
    run: async (command: unknown) => {
      commands.push(command)
      return (command as { do: string }).do === 'export' ? exported : { ok: true, value: undefined }
    }
  } as unknown as Hermes
  const opened: { action: string; path: string }[] = []
  const loaded: { request: ImageRequest; context: ImageContext }[] = []
  const opener: Opener = {
    open: async path => (opened.push({ action: 'open', path }), { ok: true }),
    show: async path => (opened.push({ action: 'show', path }), { ok: true }),
    browse: async () => { throw new Error('a window never browses through the opener') }
  }
  const saves: Exported[] = []
  const saver = { save: async (rendered: Exported): Promise<string | null> => (saves.push(rendered), savedAt) }
  const kept: Draft[] = []
  const picked: string[] = []
  const lives: (() => boolean)[] = []
  const stored: readonly Draft[] = [{ key: 'new', bot: null, text: 'kept on disk', attachments: [] }]
  const previewed: { request: string; label: string | null; session: Session | undefined }[] = []
  const toPane: PreviewCommand[] = []
  const pane: PreviewOwner = {
    preview: still<Preview>({ state: 'closed' }),
    show: (request, label, session) => (previewed.push({ request, label, session }), request.startsWith('/')),
    run: async command => (toPane.push(command), { ok: true, value: undefined })
  }
  const staged: StageSource[] = []
  const store: Attaching['store'] = {
    stage: async source => {
      staged.push(source)
      const name = typeof source === 'string' ? source.slice(source.lastIndexOf('/') + 1) : source.name
      return name.startsWith('big') ? { ok: false, name, reason: `${name} is too big.` } : { ok: true, attachment: { id: `id-${staged.length}` as AttachmentId, name, kind: 'image', size: 3 } }
    },
    read: async id => (id === HELD.id ? HELD : null)
  }
  const mode = feed<Mode>('chats')
  const theme = feed<Theme>('system')
  const snoozes = feed<Snoozes>({})
  const sources: AttachSources = { pick: async () => ['/home/me/error.png', '/home/me/big.zip'], pasted: async () => ({ name: 'Pasted image 1.png', bytes: PNG }) }
  const served = serveWindows(
    ownerOf(hermes), ipc, url => url.startsWith('app://'), opener, { load: async (request, context) => (loaded.push({ request, context }), { ok: false }) },
    { keep: draft => void kept.push(draft), load: async () => stored }, pane,
    { pick: async (bot, live) => (picked.push(bot), lives.push(live), { ok: true, value: 'cancelled' }), choose: async () => (picked.push('chosen'), { ok: true, value: PICTURE }) },
    { store, sources }, saver, { mode, theme, snoozes }
  )
  const setCatalog = (next: SlashCatalog) => {
    catalog = next
    catalogListeners.forEach(listener => listener(next))
  }
  const setBots = (next: Bots) => {
    bots = next
    botsListeners.forEach(listener => listener(next))
  }
  const setOpen = (next: OpenChat) => {
    open = next
    openListeners.forEach(listener => listener(next))
  }
  const exportsAs = (next: CommandOutcome<Exported>, path: string | null | Error) => {
    exported = next
    savedAt = path instanceof Error ? Promise.reject(path) : Promise.resolve(path)
  }
  return {
    listeners, handlers, pushes, destroyed, event, emit: (session: Session) => emit(session), commands, opened, loaded, kept, picked, lives, stored, previewed, toPane, staged, served,
    saves, exportsAs, setCatalog, setBots, setOpen, mode, theme, snoozes
  }
}

describe('serveWindows', () => {
  afterEach(() => vi.useRealTimers())

  it('sends one full value, then coalesced tail patches the window can apply', () => {
    vi.useFakeTimers()
    const { listeners, pushes, event, emit } = harness()
    listeners.get(CHANNEL.watch)!(event(), 7, topic)
    expect(pushes).toEqual([{ topic, rev: 1, full: moments[0] }])

    moments.slice(1, 6).forEach(emit)
    expect(pushes).toHaveLength(1)
    vi.advanceTimersByTime(COALESCE_MS)
    expect(pushes).toHaveLength(2)
    expect(pushes[1]).toMatchObject({ topic, rev: 2, patch: expect.anything() })

    vi.advanceTimersByTime(COALESCE_MS)
    emit(moments[6]!)
    expect(pushes).toHaveLength(3)

    let held: { value: unknown; rev: number } = { value: undefined, rev: 0 }
    for (const push of pushes) {
      const next = applyPush(held.value as Session | undefined, held.rev, push as Push<Topic>)
      if (next === 'need-full') throw new Error('the window fell behind')
      held = next
    }
    expect(held).toEqual({ value: moments[6], rev: 3 })
  })

  it('serves the slash catalog as full values, the empty one first', () => {
    vi.useFakeTimers()
    const { listeners, pushes, event, setCatalog } = harness()
    listeners.get(CHANNEL.watch)!(event(), 3, 'slash')
    const listed: SlashCatalog = [{ kind: 'command', name: 'status', description: 'Show session, model, token, and context info' }]
    vi.advanceTimersByTime(COALESCE_MS)
    setCatalog(listed)
    expect(pushes).toEqual([{ topic: 'slash', rev: 1, full: [] }, { topic: 'slash', rev: 2, full: listed }])
  })

  it('serves every app topic a full value from its own feed, and nothing for a name that is no topic', () => {
    const { listeners, pushes, event } = harness()
    const served: AppTopics = { setup: { at: 'pinned' }, link: LINK, sidebar: SIDEBAR, slash: [], bots: { state: 'loading' }, open: NOTHING_OPEN, relay: NO_RELAYS, groups: NO_GROUPS, groupChat: null, activity: RESEARCH_WAITING, skills: { state: 'reading', bot: null }, preview: { state: 'closed' }, mode: 'chats', theme: 'system', snoozes: {} }
    const watch = listeners.get(CHANNEL.watch)!
    Object.keys(served).forEach((name, id) => watch(event(), id, name))
    expect(pushes).toEqual(Object.entries(served).map(([name, full]) => ({ topic: name, rev: 1, full })))
    for (const name of ['toString', 'session:', 'bot', 7, null]) watch(event(), 99, name)
    expect(pushes).toHaveLength(Object.keys(served).length)
  })

  it('serves the bots as full values, and nothing when the hub publishes no change', () => {
    vi.useFakeTimers()
    const { listeners, pushes, event, setBots } = harness()
    listeners.get(CHANNEL.watch)!(event(), 4, 'bots')
    vi.advanceTimersByTime(COALESCE_MS)
    setBots(NO_BOTS)
    vi.advanceTimersByTime(COALESCE_MS)
    setBots(NO_BOTS)
    vi.advanceTimersByTime(COALESCE_MS)
    expect(pushes).toEqual([{ topic: 'bots', rev: 1, full: { state: 'loading' } }, { topic: 'bots', rev: 2, full: NO_BOTS }])
  })

  it('serves the open chat as full values, and passes a click on a bot to the hub', async () => {
    vi.useFakeTimers()
    const { listeners, handlers, pushes, event, setOpen, commands } = harness()
    listeners.get(CHANNEL.watch)!(event(), 5, 'open')
    vi.advanceTimersByTime(COALESCE_MS)
    const research = { shown: { kind: 'bot', bot: 'research', sessionId: 'local-0001' }, opening: null, missing: null } as OpenChat
    setOpen(research)
    expect(pushes).toEqual([{ topic: 'open', rev: 1, full: NOTHING_OPEN }, { topic: 'open', rev: 2, full: research }])
    await handlers.get(CHANNEL.run)!(event(), { do: 'open', ref: { kind: 'bot', bot: 'research' } }, 0)
    await handlers.get(CHANNEL.run)!(event(), { do: 'start', chat: { kind: 'bot', bot: 'research', sessionId: null }, text: 'hello' }, 0)
    expect(commands).toEqual([{ do: 'open', ref: { kind: 'bot', bot: 'research' } }, { do: 'start', chat: { kind: 'bot', bot: 'research', sessionId: null }, text: 'hello', attachments: [] }])
  })

  it('stops pushing when the window unwatches or is destroyed', () => {
    vi.useFakeTimers()
    const { listeners, pushes, event, emit, destroyed } = harness()
    listeners.get(CHANNEL.watch)!(event(), 1, topic)
    listeners.get(CHANNEL.unwatch)!(event(), 1)
    emit(moments[1]!)
    vi.advanceTimersByTime(COALESCE_MS * 4)
    expect(pushes).toHaveLength(1)

    listeners.get(CHANNEL.watch)!(event(), 2, topic)
    destroyed.forEach(listener => listener())
    emit(moments[2]!)
    vi.advanceTimersByTime(COALESCE_MS * 4)
    expect(pushes).toHaveLength(2)
  })

  it('serves the setup state as a full value, and refuses a setup command a fixture run has no use for', async () => {
    const { listeners, handlers, pushes, event, commands } = harness()
    listeners.get(CHANNEL.watch)!(event(), 3, 'setup')
    expect(pushes).toEqual([{ topic: 'setup', rev: 1, full: { at: 'pinned' } }])
    await expect(handlers.get(CHANNEL.run)!(event(), { do: 'editTarget' })).resolves.toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(commands).toEqual([])
  })

  it.each([
    { topic: 'mode', verb: 'setMode', was: 'chats', picked: 'bots', unknown: 'inbox' },
    { topic: 'theme', verb: 'setTheme', was: 'system', picked: 'dark', unknown: 'sepia' }
  ] as const)('sets the $topic a trusted window picks and pushes it, and never passes it to Hermes', async ({ topic, verb, was, picked, unknown }) => {
    vi.useFakeTimers()
    const { listeners, handlers, pushes, event, commands, ...shown } = harness()
    listeners.get(CHANNEL.watch)!(event(), 6, topic)
    vi.advanceTimersByTime(COALESCE_MS)
    const run = handlers.get(CHANNEL.run)!
    await expect(run(event('https://example.com/'), { do: verb, [topic]: picked })).resolves.toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    await expect(run(event(), { do: verb, [topic]: unknown })).resolves.toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(shown[topic].get()).toBe(was)
    await expect(run(event(), { do: verb, [topic]: picked })).resolves.toEqual({ ok: true, value: undefined })
    expect(shown[topic].get()).toBe(picked)
    expect(pushes).toEqual([{ topic, rev: 1, full: was }, { topic, rev: 2, full: picked }])
    expect(commands).toEqual([])
  })

  it('snoozes and wakes a chat a trusted window names, drops snoozes whose time has passed, and never passes it to Hermes', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const { listeners, handlers, pushes, event, commands, snoozes } = harness()
    snoozes.set({ ['old' as SessionId]: 999_999, ['s2' as SessionId]: 5_000_000 })
    listeners.get(CHANNEL.watch)!(event(), 7, 'snoozes')
    vi.advanceTimersByTime(COALESCE_MS)
    const run = handlers.get(CHANNEL.run)!
    await expect(run(event('https://example.com/'), { do: 'snooze', sessionId: 's1', until: 4_000_000 })).resolves.toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    await expect(run(event(), { do: 'snooze', sessionId: 's1', until: 4_000_000 }, 99)).resolves.toEqual({ ok: true, value: undefined })
    expect(snoozes.get()).toEqual({ s2: 5_000_000, s1: 4_000_000 })
    vi.advanceTimersByTime(COALESCE_MS)
    await expect(run(event(), { do: 'snooze', sessionId: 's2', until: null })).resolves.toEqual({ ok: true, value: undefined })
    expect(snoozes.get()).toEqual({ s1: 4_000_000 })
    vi.advanceTimersByTime(COALESCE_MS)
    expect(pushes.map(push => 'full' in push && push.full)).toEqual([{ old: 999_999, s2: 5_000_000 }, { s2: 5_000_000, s1: 4_000_000 }, { s1: 4_000_000 }])
    expect(commands).toEqual([])
  })

  it('passes a command for the pane to the pane, and never to Hermes', async () => {
    const { handlers, event, commands, toPane } = harness()
    const run = handlers.get(CHANNEL.run)!
    const asked: PreviewCommand[] = [
      { do: 'preview', url: 'http://localhost:5173/' }, { do: 'browse', url: 'https://example.com/' }, { do: 'reloadPreview' },
      { do: 'placePreview', rect: { x: 600, y: 56, width: 580, height: 804 } }, { do: 'openPreview' }, { do: 'closePreview' }
    ]
    for (const command of asked) await expect(run(event(), command)).resolves.toEqual({ ok: true, value: undefined })
    await expect(run(event('https://example.com/'), { do: 'browse', url: 'https://example.com/' })).resolves.toMatchObject({ ok: false })
    await expect(run(event(), { do: 'browse', url: 'file:///etc/passwd' })).resolves.toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(toPane).toEqual(asked)
    expect(commands).toEqual([])
  })

  it('saves an export through the saver and answers the window the path, never the text', async () => {
    const { handlers, event, saves } = harness()
    const answered = await handlers.get(CHANNEL.run)!(event(), { do: 'export', sessionId: 's1', format: 'md' }, 0)
    expect(saves).toEqual([{ filename: 'chat.md', content: '# Notes' }])
    expect(answered).toEqual({ ok: true, value: '/home/u/Downloads/chat.md' })
  })

  it.each([
    ['a cancelled dialog', { ok: true, value: { filename: 'chat.md', content: '# Notes' } }, null, { ok: true, value: null }, 1],
    ['a file it could not write', { ok: true, value: { filename: 'chat.md', content: '# Notes' } }, new Error('EACCES'), { ok: false, refusal: { kind: 'rejected', message: "Highwing couldn't write the file." } }, 1],
    ["Hermes's refusal, with nothing to save", { ok: false, refusal: { kind: 'rejected', message: 'This chat is too large for Hermes to export.' } }, null, { ok: false, refusal: { kind: 'rejected', message: 'This chat is too large for Hermes to export.' } }, 0]
  ] as const)('answers an export with %s', async (_, rendered, path, want, saved) => {
    const { handlers, event, saves, exportsAs } = harness()
    exportsAs(rendered, path)
    await expect(handlers.get(CHANNEL.run)!(event(), { do: 'export', sessionId: 's1', format: 'html' }, 0)).resolves.toEqual(want)
    expect(saves).toHaveLength(saved)
  })

  it('runs a valid command from the app page and refuses a malformed one or a foreign frame', async () => {
    const { handlers, event, commands } = harness()
    const run = handlers.get(CHANNEL.run)!
    await expect(run(event(), { do: 'stop', sessionId: 's1' }, 0)).resolves.toEqual({ ok: true, value: undefined })
    await expect(run(event(), { do: 'stop' }, 0)).resolves.toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    await expect(run(event('https://example.com/'), { do: 'stop', sessionId: 's1' }, 0)).resolves.toMatchObject({ ok: false })
    expect(commands).toEqual([{ do: 'stop', sessionId: 's1' }])
  })

  it('refuses a chat command a window sent for a connection that is no longer live, and passes setup, pane, mode and theme commands whatever it sent', async () => {
    let owner: ConnectionOwner | undefined
    const { handlers, event, commands, toPane, mode, theme } = harness(hermes => (owner = switchable(hermes)))
    const run = handlers.get(CHANNEL.run)!
    const pick = { do: 'open', ref: { kind: 'chat', sessionId: 'box-0001' } }
    await expect(run(event(), { do: 'editTarget' }, 1)).resolves.toEqual({ ok: true, value: undefined })
    await expect(run(event(), { do: 'checkTarget', target: { kind: 'local' } }, 1)).resolves.toEqual({ ok: true, value: undefined })
    await new Promise(resolve => setImmediate(resolve))
    expect(owner!.setup.get()).toMatchObject({ at: 'saved', live: { target: { kind: 'local' }, epoch: 2 } })

    for (const sent of [1, undefined, '2']) {
      await expect(run(event(), pick, sent)).resolves.toMatchObject({ ok: false, refusal: { kind: 'stale' } })
    }
    expect(commands, 'the old sidebar\'s chat never reaches the new Hermes').toEqual([])
    expect(owner!.setup.get(), 'a refused pick leaves Settings up').toMatchObject({ at: 'saved' })

    await expect(run(event(), { do: 'closePreview' }, 1)).resolves.toEqual({ ok: true, value: undefined })
    await expect(run(event(), { do: 'setMode', mode: 'bots' }, 1)).resolves.toEqual({ ok: true, value: undefined })
    await expect(run(event(), { do: 'setTheme', theme: 'light' }, 1)).resolves.toEqual({ ok: true, value: undefined })
    expect(toPane).toEqual([{ do: 'closePreview' }])
    expect(mode.get()).toBe('bots')
    expect(theme.get()).toBe('light')

    await expect(run(event(), pick, 2)).resolves.toEqual({ ok: true, value: undefined })
    expect(commands).toEqual([pick])
    expect(owner!.setup.get()).toEqual({ at: 'chat', live: { target: { kind: 'local' }, epoch: 2 } })
    await expect(run(event(), { do: 'editTarget' }, 1)).resolves.toEqual({ ok: true, value: undefined })
  })

  it("refuses the bot menu's mark and New chat sent for an older connection, and passes them for the live one", async () => {
    let owner: ConnectionOwner | undefined
    const { handlers, event, commands } = harness(hermes => (owner = switchable(hermes)))
    const run = handlers.get(CHANNEL.run)!
    await run(event(), { do: 'editTarget' }, 1)
    await run(event(), { do: 'checkTarget', target: { kind: 'local' } }, 1)
    await new Promise(resolve => setImmediate(resolve))
    const mark = { do: 'markBot', bot: 'box-bot', mark: 'pin' }
    const fresh = { do: 'open', ref: { kind: 'new', bot: 'box-bot', draftId: 'd1' }, upFront: true }

    for (const command of [mark, fresh]) {
      await expect(run(event(), command, 1)).resolves.toMatchObject({ ok: false, refusal: { kind: 'stale' } })
    }
    expect(commands, "the old sidebar's bot never reaches the new Hermes").toEqual([])

    await expect(run(event(), mark, 2)).resolves.toMatchObject({ ok: true })
    expect(owner!.setup.get(), 'a mark leaves Settings up').toMatchObject({ at: 'saved' })
    await expect(run(event(), fresh, 2)).resolves.toMatchObject({ ok: true })
    expect(commands).toEqual([mark, fresh])
    expect(owner!.setup.get()).toEqual({ at: 'chat', live: { target: { kind: 'local' }, epoch: 2 } })
  })

  it("refuses a group chat's send, stop and open sent for an older connection, and passes them for the live one", async () => {
    let owner: ConnectionOwner | undefined
    const { handlers, event, commands } = harness(hermes => (owner = switchable(hermes)))
    const run = handlers.get(CHANNEL.run)!
    await run(event(), { do: 'editTarget' }, 1)
    await run(event(), { do: 'checkTarget', target: { kind: 'local' } }, 1)
    await new Promise(resolve => setImmediate(resolve))
    const send = { do: 'sendToGroup', group: 'launch-plan', text: '@sam ship it' }
    const stop = { do: 'stopGroup', group: 'launch-plan' }
    const open = { do: 'open', ref: { kind: 'group', group: 'launch-plan' } }

    for (const command of [send, stop, open]) {
      await expect(run(event(), command, 1)).resolves.toMatchObject({ ok: false, refusal: { kind: 'stale' } })
    }
    expect(commands, "the old connection's group never reaches the new Hermes").toEqual([])

    await expect(run(event(), send, 2)).resolves.toMatchObject({ ok: true })
    await expect(run(event(), stop, 2)).resolves.toMatchObject({ ok: true })
    expect(owner!.setup.get(), 'a send or a stop leaves Settings up').toMatchObject({ at: 'saved' })
    await expect(run(event(), open, 2)).resolves.toMatchObject({ ok: true })
    expect(commands).toEqual([send, stop, open])
    expect(owner!.setup.get()).toEqual({ at: 'chat', live: { target: { kind: 'local' }, epoch: 2 } })
  })
})

describe('isWebLink', () => {
  it.each(['https://example.com/style-guide', 'http://localhost:8080/', 'mailto:someone@example.com'])('opens %s', url => {
    expect(isWebLink(url)).toBe(true)
  })

  it.each(['javascript:alert(1)', 'file:///etc/passwd', '/style-guide', 'style-guide.md', '', 'http//missing-colon'])('refuses %s', url => {
    expect(isWebLink(url)).toBe(false)
  })
})

describe('the file call', () => {
  const NOTES = '/tmp/hermes-proto-work/notes.md'
  const diffMoment = () => moments.find(session => itemsOf(session).some(item => item.kind === 'tool' && item.status.s === 'done' && item.status.diffs.some(diff => diff.path === NOTES)))!
  const asked = (action: 'open' | 'show', path: string, sessionId: string = fixture.header.sessionId) => ({ action, sessionId, path })

  function watching(senderId = 1) {
    const rig = harness()
    rig.listeners.get(CHANNEL.watch)!(rig.event(undefined, senderId), 1, topic)
    rig.emit(diffMoment())
    const file = rig.handlers.get(CHANNEL.file)!
    return { ...rig, file: (raw: unknown, event = rig.event(undefined, senderId)) => file(event, raw) as Promise<FileOutcome> }
  }

  it('opens a path a step of the watched session named, once, with the absolute path', async () => {
    const { file, opened } = watching()
    await expect(file(asked('open', NOTES))).resolves.toEqual({ ok: true })
    expect(opened).toEqual([{ action: 'open', path: NOTES }])
    await expect(file(asked('show', NOTES))).resolves.toEqual({ ok: true })
    expect(opened).toEqual([{ action: 'open', path: NOTES }, { action: 'show', path: NOTES }])
  })

  it.each([
    ['a path no step named', '/tmp/hermes-proto-work/other.md'],
    ['a path that climbs out of what a step named', '/tmp/hermes-proto-work/../../etc/passwd'],
    ['the folder that holds what a step named', '/tmp/hermes-proto-work'],
    ['a file url for a path a step named', `file://${NOTES}`],
    ['a web url', 'https://example.com/notes.md'],
    ['a relative path', 'notes.md']
  ])('refuses %s', async (_, path) => {
    const { file, opened } = watching()
    await expect(file(asked('open', path))).resolves.toEqual({ ok: false, reason: 'refused' })
    await expect(file(asked('show', path))).resolves.toEqual({ ok: false, reason: 'refused' })
    expect(opened).toEqual([])
  })

  it('refuses a path before any step has named it', async () => {
    const rig = harness()
    rig.listeners.get(CHANNEL.watch)!(rig.event(), 1, topic)
    await expect(rig.handlers.get(CHANNEL.file)!(rig.event(), asked('open', NOTES))).resolves.toEqual({ ok: false, reason: 'refused' })
    expect(rig.opened).toEqual([])
  })

  it('refuses a session this window does not watch, whatever another window watches', async () => {
    const { file, opened, listeners, event } = watching()
    await expect(file(asked('open', NOTES, 'someone-else'))).resolves.toEqual({ ok: false, reason: 'refused' })
    await expect(file(asked('open', NOTES), event(undefined, 2))).resolves.toEqual({ ok: false, reason: 'refused' })
    listeners.get(CHANNEL.unwatch)!(event(), 1)
    await expect(file(asked('open', NOTES))).resolves.toEqual({ ok: false, reason: 'refused' })
    expect(opened).toEqual([])
  })

  it('refuses a foreign frame and a malformed request', async () => {
    const { file, opened, event } = watching()
    await expect(file(asked('open', NOTES), event('https://example.com/'))).resolves.toEqual({ ok: false, reason: 'refused' })
    for (const raw of [null, 'open', { ...asked('open', NOTES), action: 'delete' }, asked('open', '  '), { action: 'open', path: NOTES }]) {
      await expect(file(raw)).resolves.toEqual({ ok: false, reason: 'refused' })
    }
    expect(opened).toEqual([])
  })

  it('previews a path with the watched session, which the pane judges, and refuses what the pane refuses', async () => {
    const { file, previewed, opened } = watching()
    await expect(file({ ...asked('open', NOTES), action: 'preview' })).resolves.toEqual({ ok: true })
    await expect(file({ ...asked('open', 'notes.md'), action: 'preview' })).resolves.toEqual({ ok: false, reason: 'refused' })
    expect(previewed).toEqual([{ request: NOTES, label: null, session: diffMoment() }, { request: 'notes.md', label: null, session: diffMoment() }])
    expect(opened).toEqual([])
  })

  it('stops answering once disposed', () => {
    const { handlers, served } = watching()
    served.dispose()
    expect(handlers.has(CHANNEL.file)).toBe(false)
  })

  it('refuses open, show and preview for a session the live Hermes is serving on another machine', async () => {
    const rig = harness(switchable)
    rig.listeners.get(CHANNEL.watch)!(rig.event(), 1, topic)
    rig.emit(diffMoment())
    const file = rig.handlers.get(CHANNEL.file)!
    for (const action of ['open', 'show', 'preview'] as const) {
      await expect(file(rig.event(), { ...asked('open', NOTES), action })).resolves.toEqual({ ok: false, reason: 'refused' })
    }
    expect(rig.opened).toEqual([])
    expect(rig.previewed).toEqual([])
  })

  it('refuses a path a remote Hermes served after the connection moves to this computer, until the window watches the session again', async () => {
    let owner: ConnectionOwner | undefined
    const rig = harness(hermes => (owner = switchable(hermes)))
    rig.listeners.get(CHANNEL.watch)!(rig.event(), 1, topic)
    rig.emit(diffMoment())
    await owner!.run({ do: 'editTarget' })
    await owner!.run({ do: 'checkTarget', target: { kind: 'local' } })
    await new Promise(resolve => setImmediate(resolve))
    const file = rig.handlers.get(CHANNEL.file)!
    await expect(file(rig.event(), asked('open', NOTES))).resolves.toEqual({ ok: false, reason: 'refused' })
    expect(rig.opened).toEqual([])

    rig.listeners.get(CHANNEL.watch)!(rig.event(), 1, topic)
    rig.emit(diffMoment())
    await expect(file(rig.event(), asked('open', NOTES))).resolves.toEqual({ ok: true })
    expect(rig.opened).toEqual([{ action: 'open', path: NOTES }])
  })
})

describe('the image call', () => {
  const asked = { kind: 'tool', sessionId: fixture.header.sessionId, path: '/tmp/shot.png' }

  it('judges a tool image against the session this window watches, and says a pinned connection is local', async () => {
    const rig = harness()
    rig.listeners.get(CHANNEL.watch)!(rig.event(), 1, topic)
    rig.emit(moments[3]!)
    const call = rig.handlers.get(CHANNEL.image)!
    await expect(call(rig.event(), asked)).resolves.toEqual({ ok: false })
    expect(rig.loaded).toEqual([{ request: asked, context: { session: moments[3], local: true } }])
  })

  it('says not local for a session a remote Hermes served after the connection moves to this computer, until the window watches it again', async () => {
    let owner: ConnectionOwner | undefined
    const rig = harness(hermes => (owner = switchable(hermes)))
    rig.listeners.get(CHANNEL.watch)!(rig.event(), 1, topic)
    rig.emit(moments[3]!)
    await owner!.run({ do: 'editTarget' })
    await owner!.run({ do: 'checkTarget', target: { kind: 'local' } })
    await new Promise(resolve => setImmediate(resolve))
    expect(owner!.setup.get()).toMatchObject({ at: 'saved', live: { target: { kind: 'local' } } })
    await rig.handlers.get(CHANNEL.image)!(rig.event(), asked)
    expect(rig.loaded).toEqual([{ request: asked, context: { session: moments[3], local: false } }])

    rig.listeners.get(CHANNEL.watch)!(rig.event(), 1, topic)
    rig.emit(moments[3]!)
    await rig.handlers.get(CHANNEL.image)!(rig.event(), asked)
    expect(rig.loaded[1]).toEqual({ request: asked, context: { session: moments[3], local: true } })
  })

  it('gives the loader no session for one this window does not watch', async () => {
    const rig = harness()
    await rig.handlers.get(CHANNEL.image)!(rig.event(), asked)
    expect(rig.loaded[0]?.context.session).toBeUndefined()
  })

  it('refuses a foreign frame and a malformed request without asking the loader', async () => {
    const rig = harness()
    const call = rig.handlers.get(CHANNEL.image)!
    const refused: ImageOutcome = { ok: false }
    await expect(call(rig.event('https://example.com/'), { kind: 'web', url: 'https://example.com/c.png' })).resolves.toEqual(refused)
    for (const raw of [null, 'x', { kind: 'web', url: 'file:///etc/passwd' }, { kind: 'tool', path: '/tmp/shot.png' }]) {
      await expect(call(rig.event(), raw)).resolves.toEqual(refused)
    }
    expect(rig.loaded).toEqual([])
  })

  it('stops answering once disposed', () => {
    const { handlers, served } = harness()
    served.dispose()
    expect(handlers.has(CHANNEL.image)).toBe(false)
  })
})

describe('the attach calls', () => {
  it('hold each picked file in the order picked, and say which were refused', async () => {
    const rig = harness()
    await expect(rig.handlers.get(CHANNEL.attachPick)!(rig.event())).resolves.toEqual([
      { ok: true, attachment: { id: 'id-1', name: 'error.png', kind: 'image', size: 3 } },
      { ok: false, name: 'big.zip', reason: 'big.zip is too big.' }
    ])
    expect(rig.staged).toEqual(['/home/me/error.png', '/home/me/big.zip'])
  })

  it('hold the clipboard image, and the dropped files that have a path on this computer', async () => {
    const rig = harness()
    await expect(rig.handlers.get(CHANNEL.attachPaste)!(rig.event())).resolves.toMatchObject([{ ok: true, attachment: { name: 'Pasted image 1.png' } }])
    await expect(rig.handlers.get(CHANNEL.attachDrop)!(rig.event(), [{ name: 'shot.png', path: '/tmp/shot.png' }, { name: 'web.png', path: null }])).resolves.toEqual([
      { ok: true, attachment: { id: 'id-2', name: 'shot.png', kind: 'image', size: 3 } },
      { ok: false, name: 'web.png', reason: "web.png isn't a file on this computer, so Highwing can't attach it." }
    ])
  })

  it('hold no more of a large drop than one message carries, copy none of the rest, and name each one left out', async () => {
    const rig = harness()
    const dropped = Array.from({ length: MAX_ATTACHMENTS + 2 }, (_, index) => ({ name: `f${index}.png`, path: `/tmp/f${index}.png` }))
    const results = await rig.handlers.get(CHANNEL.attachDrop)!(rig.event(), dropped) as readonly { readonly ok: boolean }[]
    expect(results.filter(result => result.ok)).toHaveLength(MAX_ATTACHMENTS)
    expect(results.slice(MAX_ATTACHMENTS)).toEqual([MAX_ATTACHMENTS, MAX_ATTACHMENTS + 1].map(index => (
      { ok: false, name: `f${index}.png`, reason: `A message holds up to ${MAX_ATTACHMENTS} attachments, so f${index}.png wasn't attached.` }
    )))
    expect(rig.staged).toHaveLength(MAX_ATTACHMENTS)
  })

  it('hold nothing for a foreign frame or a drop that names a relative path', async () => {
    const rig = harness()
    for (const channel of [CHANNEL.attachPick, CHANNEL.attachPaste]) await expect(rig.handlers.get(channel)!(rig.event('https://example.com/'))).resolves.toEqual([])
    await expect(rig.handlers.get(CHANNEL.attachDrop)!(rig.event(), [{ name: 'x', path: 'x' }])).resolves.toEqual([])
    await expect(rig.handlers.get(CHANNEL.attachDrop)!(rig.event('https://example.com/'), [{ name: 'shot.png', path: '/tmp/shot.png' }])).resolves.toEqual([])
    expect(rig.staged).toEqual([])
  })

  it('draw an image attachment from the store, and refuse a file or an id it does not hold', async () => {
    const rig = harness()
    const call = rig.handlers.get(CHANNEL.image)!
    await expect(call(rig.event(), { kind: 'attachment', id: HELD.id })).resolves.toEqual({ ok: true, type: 'image/png', bytes: PNG })
    await expect(call(rig.event(), { kind: 'attachment', id: 'gone' })).resolves.toEqual({ ok: false })
    expect(rig.loaded).toEqual([])
  })

  it('stop answering once disposed', () => {
    const { handlers, served } = harness()
    served.dispose()
    for (const channel of [CHANNEL.attachPick, CHANNEL.attachPaste, CHANNEL.attachDrop]) expect(handlers.has(channel)).toBe(false)
  })
})

describe('the draft calls', () => {
  const draft = { key: 'chat:local-0102', bot: 'research', text: 'half a thought', attachments: [] }

  it('keep a draft from the app page and hand back the stored ones', async () => {
    const rig = harness()
    rig.listeners.get(CHANNEL.keepDraft)!(rig.event(), draft)
    rig.listeners.get(CHANNEL.keepDraft)!(rig.event(), { ...draft, text: '' })
    expect(rig.kept).toEqual([draft, { ...draft, text: '' }])
    await expect(rig.handlers.get(CHANNEL.drafts)!(rig.event())).resolves.toEqual(rig.stored)
  })

  it('refuse a foreign frame and a malformed draft', async () => {
    const rig = harness()
    const keep = rig.listeners.get(CHANNEL.keepDraft)!
    keep(rig.event('https://example.com/'), draft)
    for (const raw of [null, 'x', { ...draft, key: 'session:local-0102' }, { ...draft, key: 'bot:' }, { ...draft, text: 7 }, { ...draft, bot: '' }]) keep(rig.event(), raw)
    expect(rig.kept).toEqual([])
    await expect(rig.handlers.get(CHANNEL.drafts)!(rig.event('https://example.com/'))).resolves.toEqual([])
  })

  it('stop answering once disposed', () => {
    const { handlers, listeners, served } = harness()
    served.dispose()
    expect(handlers.has(CHANNEL.drafts)).toBe(false)
    expect(listeners.has(CHANNEL.keepDraft)).toBe(false)
  })
})

describe('the picture call', () => {
  it("asks main's picker for the named bot, and refuses a foreign frame or a bot with no name without asking", async () => {
    const rig = harness()
    const call = rig.handlers.get(CHANNEL.pickPicture)!
    await expect(call(rig.event(), 'rae', 0)).resolves.toEqual({ ok: true, value: 'cancelled' })
    for (const [event, raw] of [[rig.event('https://example.com/'), 'rae'], [rig.event(), ' '], [rig.event(), { bot: 'rae' }]] as const) {
      await expect(call(event, raw, 0)).resolves.toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    }
    expect(rig.picked).toEqual(['rae'])
  })

  it('refuses a bot of a connection that is no longer live, and tells a picker left open across the switch', async () => {
    let owner: ConnectionOwner | undefined
    const rig = harness(hermes => (owner = switchable(hermes)))
    const run = rig.handlers.get(CHANNEL.run)!
    const call = rig.handlers.get(CHANNEL.pickPicture)!
    await expect(call(rig.event(), 'rae', 1)).resolves.toEqual({ ok: true, value: 'cancelled' })
    const [openAcrossTheSwitch] = rig.lives
    expect(openAcrossTheSwitch!()).toBe(true)
    await run(rig.event(), { do: 'editTarget' }, 1)
    await run(rig.event(), { do: 'checkTarget', target: { kind: 'local' } }, 1)
    await new Promise(resolve => setImmediate(resolve))
    expect(owner!.setup.get()).toMatchObject({ live: { target: { kind: 'local' }, epoch: 2 } })
    expect(openAcrossTheSwitch!()).toBe(false)

    for (const sent of [1, undefined, '2']) {
      await expect(call(rig.event(), 'rae', sent)).resolves.toMatchObject({ ok: false, refusal: { kind: 'stale' } })
    }
    expect(rig.picked, 'no picker opens for a bot of the old connection').toEqual(['rae'])
    await expect(call(rig.event(), 'rae', 2)).resolves.toEqual({ ok: true, value: 'cancelled' })
    expect(rig.lives[1]!()).toBe(true)
  })

  it("answers main's chosen picture to the window, and refuses a foreign frame without asking", async () => {
    const rig = harness()
    const call = rig.handlers.get(CHANNEL.choosePicture)!
    await expect(call(rig.event())).resolves.toEqual({ ok: true, value: PICTURE })
    await expect(call(rig.event('https://example.com/'))).resolves.toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(rig.picked).toEqual(['chosen'])
  })

  it('stops answering once disposed', () => {
    const { handlers, served } = harness()
    served.dispose()
    expect(handlers.has(CHANNEL.pickPicture)).toBe(false)
    expect(handlers.has(CHANNEL.choosePicture)).toBe(false)
  })
})

describe('parseDraft', () => {
  it('keeps the known fields of each kind of key, and no attachments for a draft an earlier build wrote', () => {
    expect(parseDraft({ key: 'bot:research', bot: 'research', text: 'x', extra: 1 })).toEqual({ key: 'bot:research', bot: 'research', text: 'x', attachments: [] })
    expect(parseDraft({ key: 'new', bot: null, text: '' })).toEqual({ key: 'new', bot: null, text: '', attachments: [] })
    expect(parseDraft({ key: 'group:launch-plan', bot: null, text: '@sam go' })).toEqual({ key: 'group:launch-plan', bot: null, text: '@sam go', attachments: [] })
  })

  it('refuses a key of a kind no place to type has', () => {
    for (const key of ['room:launch-plan', 'group:', 'chat', ':x', 'newer']) expect(parseDraft({ key, bot: null, text: 'x' }), key).toBeNull()
  })

  it('keeps the known fields of each attachment, and refuses a draft with one it cannot read', () => {
    const held = { id: 'a-1', name: 'error.png', kind: 'image', size: 2048 }
    expect(parseDraft({ key: 'new', bot: null, text: '', attachments: [{ ...held, path: '/etc/passwd' }] })).toEqual({ key: 'new', bot: null, text: '', attachments: [held] })
    for (const attachments of ['a-1', [{ ...held, kind: 'pdf' }], [{ ...held, size: -1 }], [{ ...held, name: '' }]]) {
      expect(parseDraft({ key: 'new', bot: null, text: '', attachments })).toBeNull()
    }
  })
})

describe('parseFileRequest', () => {
  it('keeps the three known fields', () => {
    expect(parseFileRequest({ action: 'show', sessionId: 's1', path: '/a/b', extra: 1 })).toEqual({ action: 'show', sessionId: 's1', path: '/a/b' })
  })
})
