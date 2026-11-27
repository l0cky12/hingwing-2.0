import { describe, expect, it } from 'vitest'
import { BOARD_PATH, isTaskId, parseTaskBoard, parseTaskChat, taskPath } from '../src/domain/tasks'

const task = (id: string, extra: object = {}) => ({ id, title: `Task ${id}`, body: null, assignee: null, status: 'todo', latest_summary: null, comment_count: 0, ...extra })
const board = (...columns: [string, object[]][]) => ({ columns: columns.map(([name, tasks]) => ({ name, tasks })), tenants: [], assignees: [], latest_event_id: 4, now: 1 })

describe('parseTaskBoard', () => {
  it('keeps Hermes columns in order, each card as the view draws it, empty columns included', () => {
    expect(parseTaskBoard(board(['todo', [task('t_1')]], ['running', [task('t_2', { assignee: 'ada', latest_summary: 'Reading the logs' })]], ['done', []]))).toEqual({
      columns: [
        { name: 'todo', cards: [{ id: 't_1', title: 'Task t_1', assignee: null, summary: null }] },
        { name: 'running', cards: [{ id: 't_2', title: 'Task t_2', assignee: 'ada', summary: 'Reading the logs' }] },
        { name: 'done', cards: [] }
      ]
    })
  })

  it('reads a blank assignee or summary as none', () => {
    expect(parseTaskBoard(board(['todo', [task('t_1', { assignee: '', latest_summary: '' })]]))?.columns[0]?.cards[0]).toEqual({ id: 't_1', title: 'Task t_1', assignee: null, summary: null })
  })

  it.each<[string, unknown]>([
    ['a string', 'board'],
    ['null', null],
    ['an array', []],
    ['no columns', {}],
    ['columns that are not a list', { columns: {} }],
    ['a column with no name', { columns: [{ tasks: [] }] }],
    ['a column whose tasks are not a list', { columns: [{ name: 'todo', tasks: null }] }],
    ['a card with no id', board(['todo', [{ title: 'x' }]])],
    ['a card whose id is a path', board(['todo', [task('t_1/../x')]])],
    ['a card with no title', board(['todo', [{ id: 't_1' }]])]
  ])('refuses %s', (_what, raw) => {
    expect(parseTaskBoard(raw)).toBeNull()
  })
})

const event = (id: number, kind: string, runId: number | null, payload: unknown = {}) => ({ id, task_id: 't_1', run_id: runId, kind, payload, created_at: id })
const run = (id: number, profile: string) => ({ id, task_id: 't_1', profile, status: 'running' })

describe('parseTaskChat', () => {
  it('names the session of the newest owner_admitted event, in the bot its run used', () => {
    const detail = {
      task: task('t_1'),
      events: [event(1, 'created', null), event(2, 'owner_admitted', 7, { session_id: 'old' }), event(3, 'claimed', 8), event(4, 'owner_admitted', 8, { session_id: 'new' })],
      runs: [run(7, 'ada'), run(8, ' Grace ')]
    }
    expect(parseTaskChat(detail)).toEqual({ bot: 'grace', sessionId: 'new' })
  })

  it('takes the newest by id, whatever order the events come in', () => {
    const events = [event(4, 'owner_admitted', 8, { session_id: 'new' }), event(2, 'owner_admitted', 7, { session_id: 'old' })]
    expect(parseTaskChat({ events, runs: [run(7, 'ada'), run(8, 'grace')] })).toEqual({ bot: 'grace', sessionId: 'new' })
  })

  it.each<[string, unknown]>([
    ['a card that never ran', { events: [event(1, 'created', null)], runs: [] }],
    ['an admission with no session', { events: [event(1, 'owner_admitted', 7, {})], runs: [run(7, 'ada')] }],
    ['an admission with no payload', { events: [event(1, 'owner_admitted', 7, null)], runs: [run(7, 'ada')] }],
    ['an admission whose run is not listed', { events: [event(1, 'owner_admitted', 9, { session_id: 's' })], runs: [run(7, 'ada')] }],
    ['a run with no profile', { events: [event(1, 'owner_admitted', 7, { session_id: 's' })], runs: [{ id: 7 }] }]
  ])('answers null for %s', (_what, raw) => {
    expect(parseTaskChat(raw)).toBeNull()
  })

  it.each<[string, unknown]>([['null', null], ['no events', { runs: [] }], ['no runs', { events: [] }], ['events that are not a list', { events: {}, runs: [] }]])('answers invalid for %s', (_what, raw) => {
    expect(parseTaskChat(raw)).toBe('invalid')
  })
})

describe('task ids and paths', () => {
  it.each([['t_ab12', true], ['abc-1', true], ['', false], ['a/b', false], ['..', false], ['a b', false], ['x'.repeat(65), false], [7, false], [null, false]])('takes %j as a task id: %s', (raw, is) => {
    expect(isTaskId(raw)).toBe(is)
  })

  it('names the plugin routes, and encodes the id it puts in a path', () => {
    expect(BOARD_PATH).toBe('/api/plugins/kanban/board')
    expect(taskPath('t_ab12')).toBe('/api/plugins/kanban/tasks/t_ab12')
    expect(taskPath('a/b')).toBe('/api/plugins/kanban/tasks/a%2Fb')
  })
})
