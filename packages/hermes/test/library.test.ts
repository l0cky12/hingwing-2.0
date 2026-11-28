import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import type { StoredTranscriptResult } from '../src/wire/contract.generated'
import type { SessionId } from '../src/domain/session'
import { openHermes } from '../src/hub'
import { readMade } from '../src/library'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type Fixture } from '../src/testing/fixture'
import { RpcRefusal, type Calls } from '../src/wire/link'
import { parseMade } from '../src/wire/parse'
import { callsIn, ERRAND } from './support/errand'

const RAE = 'rae' as BotId
const LIBRARY = JSON.parse(readFileSync(fileURLToPath(new URL('../../../fixtures/profiles/library.json', import.meta.url)), 'utf8')) as {
  readonly profiles: unknown; readonly bot_mode_protocol: boolean; readonly install_id: string; readonly chats: NonNullable<Fixture['header']['chats']>
}
const WITH_LIBRARY: Fixture = {
  ...ERRAND,
  header: { ...ERRAND.header, profiles: { profiles: LIBRARY.profiles, bot_mode_protocol: LIBRARY.bot_mode_protocol, install_id: LIBRARY.install_id }, chats: LIBRARY.chats }
}

const wrote = (paths: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ bytes_written: 3, files_modified: paths, ...extra })
const page = (rows: readonly unknown[]) => ({ session_id: 'c', rows, next_cursor: null, reset: false }) as unknown as StoredTranscriptResult

describe('parseMade', () => {
  it('takes the absolute files a write_file or patch that worked modified, as Hermes reports them', () => {
    const made = parseMade(page([
      { role: 'tool', name: 'write_file', content: wrote(['/home/rae/notes.md']), row_kind: 'message' },
      { role: 'tool', name: 'patch', content: wrote(['/home/rae/a.md', 'C:\\Users\\rae\\b.md', '\\\\share\\c.md', 'relative/d.md']), row_kind: 'message' }
    ]))
    expect(made?.rows.map(row => row.wrote)).toEqual([['/home/rae/notes.md'], ['/home/rae/a.md', 'C:\\Users\\rae\\b.md', '\\\\share\\c.md']])
  })

  it('falls back to resolved_path when no files_modified is named', () => {
    expect(parseMade(page([{ role: 'tool', name: 'write_file', content: JSON.stringify({ resolved_path: '/home/rae/x.md' }), row_kind: 'message' }]))?.rows[0]?.wrote).toEqual(['/home/rae/x.md'])
  })

  it('takes nothing from a write that failed, another tool, or a result that is not JSON', () => {
    const made = parseMade(page([
      { role: 'tool', name: 'write_file', content: wrote(['/home/rae/x.md'], { error: 'Permission denied' }), row_kind: 'message' },
      { role: 'tool', name: 'terminal', content: wrote(['/home/rae/y.md']), row_kind: 'message' },
      { role: 'tool', name: 'patch', content: 'not json', row_kind: 'message' },
      { role: 'tool', name: 'patch', row_kind: 'message' }
    ]))
    expect(made?.rows.map(row => row.wrote)).toEqual([[], [], [], []])
  })

  it("says a reply's markdown and every row's time, and nothing for a user row", () => {
    const made = parseMade(page([
      { role: 'user', text: 'see https://example.com', timestamp: 1000, row_kind: 'message' },
      { role: 'assistant', text: 'Here: [docs](https://example.com/docs)', timestamp: 1000.5, row_kind: 'message' },
      { role: 'assistant', text: '   ', row_kind: 'message' }
    ]))
    expect(made?.rows).toEqual([
      { at: 1_000_000, wrote: [], said: null },
      { at: 1_000_500, wrote: [], said: 'Here: [docs](https://example.com/docs)' },
      { at: null, wrote: [], said: null }
    ])
  })
})

function hermes(answer: (method: string, params: Record<string, unknown>) => unknown) {
  const calls: { readonly method: string; readonly params: Record<string, unknown> }[] = []
  const via: Calls = {
    link: { state: 'online' },
    respond: () => {},
    clarifyBatch: false,
    call: (async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params })
      return answer(method, params)
    }) as Calls['call']
  }
  return { via, calls }
}

const listed = (count: number) => ({
  sessions: Array.from({ length: count }, (_, at) => ({ session_id: `chat-${at}`, id: `chat-${at}`, title: `Chat ${at}`, source: null, last_active_at: 5000 - at })),
  scope: 'stored', next_cursor: null
})

describe('readMade', () => {
  it("dates each row by its own time, else the row before it, else the chat's last activity, and keeps only the rows that made something", async () => {
    const { via } = hermes(method => (method === 'session.list' ? listed(1) : page([
      { role: 'tool', name: 'write_file', content: wrote(['/a.md']), row_kind: 'message' },
      { role: 'user', text: 'more', timestamp: 2000, row_kind: 'message' },
      { role: 'tool', name: 'patch', content: wrote(['/b.md']), row_kind: 'message' },
      { role: 'assistant', text: 'done', row_kind: 'message' }
    ])))
    expect(await readMade({ bot: RAE, via }, 0, () => {})).toEqual({
      ok: true,
      value: {
        chats: [{ sessionId: 'chat-0', title: 'Chat 0', rows: [{ at: 5_000_000, wrote: ['/a.md'] }, { at: 2_000_000, wrote: ['/b.md'] }, { at: 2_000_000, said: 'done' }] }],
        reach: 'all', unread: 0
      }
    })
  })

  it('reads ten chats a step, says when there are older ones, and counts a chat Hermes refuses as unread', async () => {
    const { via, calls } = hermes((method, params) => {
      if (method === 'session.list') return listed(12)
      if (params.session_id === 'chat-3') throw new RpcRefusal(4003, 'permission_denied', 'no')
      return page([])
    })
    const owned: SessionId[] = []
    const first = await readMade({ bot: RAE, via }, 0, (_bot, ids) => owned.push(...ids))
    expect(first).toMatchObject({ ok: true, value: { reach: 'more', unread: 1 } })
    expect(first.ok && first.value.chats.map(chat => chat.sessionId)).toEqual(['chat-0', 'chat-1', 'chat-2', 'chat-4', 'chat-5', 'chat-6', 'chat-7', 'chat-8', 'chat-9'])
    expect(owned, 'botOf knows the chats it read').toHaveLength(10)
    expect(calls[0]).toEqual({ method: 'session.list', params: { scope: 'stored', include_hidden: true, limit: 11 } })
    const second = await readMade({ bot: RAE, via }, 1, () => {})
    expect(second.ok && second.value.chats.map(chat => chat.sessionId)).toEqual(['chat-10', 'chat-11'])
    expect(second).toMatchObject({ ok: true, value: { reach: 'all' } })
  })

  it("is the refusal itself when Hermes won't list the bot's chats", async () => {
    const { via } = hermes(() => { throw new RpcRefusal(-32601, 'unknown_method', 'unknown method: session.list') })
    expect(await readMade({ bot: RAE, via }, 0, () => {})).toMatchObject({ ok: false })
  })
})

describe('readMade through the hub', () => {
  it("lists and reads the bot's stored chats under its profile, hidden ones too, without images", async () => {
    const clock = manualClock()
    const script = scriptedDialer(WITH_LIBRARY, { clock })
    const hub = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
    await clock.advance(0)
    const read = await hub.run({ do: 'readMade', bot: RAE, step: 0 })
    expect(read.ok && read.value.chats.map(chat => [chat.sessionId, chat.rows.length]), "the failed write is left out, and Rae's Bot Chat is read too").toEqual([['local-0301', 3], ['local-0007', 1], ['local-0302', 2]])
    const asked = callsIn(script.received).filter(call => call.method === 'session.list' || call.method === 'session.transcript')
    expect(asked.filter(call => call.params?.profile === 'rae' && (call.method === 'session.transcript' || call.params.limit === 11))).toEqual([
      { method: 'session.list', params: { scope: 'stored', include_hidden: true, limit: 11, profile: 'rae' } },
      { method: 'session.transcript', params: { session_id: 'local-0301', order: 'latest', limit: 500, inline_images: false, profile: 'rae' } },
      { method: 'session.transcript', params: { session_id: 'local-0007', order: 'latest', limit: 500, inline_images: false, profile: 'rae' } },
      { method: 'session.transcript', params: { session_id: 'local-0302', order: 'latest', limit: 500, inline_images: false, profile: 'rae' } }
    ])
  })
})
