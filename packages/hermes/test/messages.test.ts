import { describe, expect, it } from 'vitest'
import type { SessionId } from '../src/domain/session'
import { readMessages } from '../src/messages'
import type { Calls } from '../src/wire/link'

const CHAT = 'chat-1' as SessionId
const row = (role: string, text: string, rowId: number) => ({ role, text, row_id: rowId, timestamp: 1000 + rowId, row_kind: 'message' })
const OLDER = [row('user', 'Plan the trip', 1), row('assistant', 'Planned it.', 2)]
const NEWER = [row('user', 'Book the train', 3), row('assistant', 'Booked it.', 4)]

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

const oneChat = { sessions: [{ session_id: CHAT, id: CHAT, title: 'Trip', source: null }], scope: 'stored', next_cursor: null }

describe('reading a chat for message search', () => {
  it('starts again from the page Hermes answers with reset, so no message is read twice', async () => {
    const { via } = hermes((method, params) => {
      if (method === 'session.list') return oneChat
      if (params.cursor === undefined) return { session_id: CHAT, rows: NEWER, next_cursor: 'older', reset: false }
      return { session_id: CHAT, rows: [...OLDER, ...NEWER], next_cursor: null, reset: true }
    })
    const read = await readMessages([{ bot: null, via }], 0, () => {})
    expect(read.ok && read.value.messages.map(message => [message.rowId, message.landing])).toEqual([[1, 1], [2, 1], [3, 3], [4, 3]])
  })

  it('ends a bot\'s list at an empty page, whatever cursor it carries', async () => {
    const { via, calls } = hermes(method => (method === 'session.list' ? { sessions: [], scope: 'stored', next_cursor: 'more' } : null))
    expect(await readMessages([{ bot: null, via }], 0, () => {})).toEqual({ ok: true, value: { messages: [], reach: 'all', unread: 0 } })
    expect(calls).toHaveLength(1)
  })
})
