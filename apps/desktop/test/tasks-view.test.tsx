import type { BotId, CommandOutcome, SessionId, TaskBoard, TaskChat } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/store', () => ({ Epoch: {}, run: async () => ({ ok: true, value: undefined }), useTopic: () => undefined }))

const { Board, cardPicks } = await import('../src/renderer/tasks/Tasks')

const BOARD: TaskBoard = {
  columns: [
    { name: 'todo', cards: [{ id: 't_1', title: 'Sweep the logs', assignee: null, summary: null }] },
    { name: 'running', cards: [{ id: 't_2', title: 'Fix <the> build', assignee: 'ada', summary: 'Reading the failing job' }] },
    { name: 'done', cards: [] }
  ]
}

const draw = (board: TaskBoard, note: { id: string; words: string } | null = null) => renderToStaticMarkup(<Board board={board} note={note} onPick={() => {}} />)

describe('the task board', () => {
  it('draws each column that holds a card in order with its count, leaving out empty ones, and each card as a button naming its title, assignee and summary', () => {
    const html = draw(BOARD)
    expect(Array.from(html.matchAll(/<section class="lane" aria-label="(\w+)"><h3>\w+ <span>(\d)<\/span>/g), ([, name, count]) => `${name} ${count}`)).toEqual(['todo 1', 'running 1'])
    expect(html).toContain('<button type="button"><span class="title">Sweep the logs</span></button>')
    expect(html).toContain('<button type="button"><span class="title">Fix &lt;the&gt; build</span><span class="by">ada</span><span class="summary">Reading the failing job</span></button>')
  })

  it('says a card has no chat yet under that card only', () => {
    const html = draw(BOARD, { id: 't_1', words: 'This task has no chat yet.' })
    expect(html.match(/This task has no chat yet\./g)).toHaveLength(1)
    expect(html).toMatch(/Sweep the logs<\/span><\/button><p class="notice caution" role="status">This task has no chat yet\.<\/p>/)
  })

  it('says there are no tasks when every column is empty', () => {
    expect(draw({ columns: [{ name: 'todo', cards: [] }, { name: 'done', cards: [] }] })).toBe('<p class="notice">No tasks yet.</p>')
  })
})

describe('picking cards', () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void
    return { promise: new Promise<T>(done => { resolve = done }), resolve }
  }
  const CHAT = (sessionId: string) => ({ ok: true, value: { bot: 'research' as BotId, sessionId: sessionId as SessionId } }) as const
  const rig = () => {
    const asked = new Map<string, ReturnType<typeof deferred<CommandOutcome<TaskChat | null>>>>()
    const opened: string[] = []
    let closes = 0
    const picks = cardPicks({
      chatOf: id => { const answer = deferred<CommandOutcome<TaskChat | null>>(); asked.set(id, answer); return answer.promise },
      open: async chat => (opened.push(chat.sessionId), { ok: true, value: undefined }),
      opened: () => void closes++,
      note: () => {}
    })
    return { picks, asked, opened, closes: () => closes }
  }
  const card = (id: string) => ({ id, title: id, assignee: null, summary: null })

  it('opens only the newest pick when an earlier card answers last', async () => {
    const { picks, asked, opened, closes } = rig()
    const a = picks.pick(card('t_a'))
    const b = picks.pick(card('t_b'))
    asked.get('t_b')!.resolve(CHAT('chat-b'))
    await b
    asked.get('t_a')!.resolve(CHAT('chat-a'))
    await a
    expect(opened).toEqual(['chat-b'])
    expect(closes()).toBe(1)
  })

  it('opens nothing for a pick answered after the view dropped it', async () => {
    const { picks, asked, opened, closes } = rig()
    const a = picks.pick(card('t_a'))
    picks.drop()
    asked.get('t_a')!.resolve(CHAT('chat-a'))
    await a
    expect(opened).toEqual([])
    expect(closes()).toBe(0)
  })
})
