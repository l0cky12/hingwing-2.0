import type { AskHermes, HttpAnswer } from '@highwing/hermes'
import { describe, expect, it } from 'vitest'
import { readTaskBoard, readTaskChat } from '../src/main/tasks'

const answering = (answer: HttpAnswer | Error): AskHermes => async () => {
  if (answer instanceof Error) throw answer
  return answer
}

const BOARD = { columns: [{ name: 'todo', tasks: [] }] }
const REFUSALS = {
  none: { kind: 'unsupported', message: 'This Hermes has no task board.' },
  unreached: { kind: 'offline', message: "Highwing couldn't reach Hermes's task board." },
  unreadable: { kind: 'unsupported', message: "Hermes answered with a task board Highwing can't read." },
  gone: { kind: 'stale', message: "That task isn't on the board any more." }
} as const

describe('readTaskBoard', () => {
  it('answers the board Hermes sent', async () => {
    expect(await readTaskBoard(answering({ status: 200, body: BOARD }))).toEqual({ ok: true, value: { columns: [{ name: 'todo', cards: [] }] } })
  })

  it.each<[string, HttpAnswer | Error, keyof typeof REFUSALS]>([
    ['a 404, as a Hermes without the kanban plugin answers', { status: 404, body: { detail: 'Not Found' } }, 'none'],
    ['a 401', { status: 401, body: null }, 'unreached'],
    ['a 500', { status: 500, body: null }, 'unreached'],
    ['no answer', new Error('connect ECONNREFUSED'), 'unreached'],
    ['a body that is no board', { status: 200, body: { columns: 'x' } }, 'unreadable']
  ])('refuses %s in plain words', async (_what, answer, refusal) => {
    expect(await readTaskBoard(answering(answer))).toEqual({ ok: false, refusal: REFUSALS[refusal] })
  })
})

describe('readTaskChat', () => {
  const DETAIL = { events: [{ id: 1, kind: 'owner_admitted', run_id: 4, payload: { session_id: 'w1' } }], runs: [{ id: 4, profile: 'ada' }] }

  it('answers the chat of the card, or null for a card that never ran', async () => {
    expect(await readTaskChat(answering({ status: 200, body: DETAIL }), 't_1')).toEqual({ ok: true, value: { bot: 'ada', sessionId: 'w1' } })
    expect(await readTaskChat(answering({ status: 200, body: { events: [], runs: [] } }), 't_1')).toEqual({ ok: true, value: null })
  })

  it('asks for the card by its path', async () => {
    const asked: unknown[] = []
    await readTaskChat(async request => (asked.push(request), { status: 404, body: null }), 't_ab12')
    expect(asked).toEqual([{ method: 'GET', path: '/api/plugins/kanban/tasks/t_ab12', bot: null }])
  })

  it.each<[string, HttpAnswer | Error, keyof typeof REFUSALS]>([
    ['a 404', { status: 404, body: null }, 'gone'],
    ['a 500', { status: 500, body: null }, 'unreached'],
    ['no answer', new Error('timed out'), 'unreached'],
    ['a body that is no card', { status: 200, body: [] }, 'unreadable']
  ])('refuses %s in plain words', async (_what, answer, refusal) => {
    expect(await readTaskChat(answering(answer), 't_1')).toEqual({ ok: false, refusal: REFUSALS[refusal] })
  })
})
