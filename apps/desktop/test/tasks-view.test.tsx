import type { TaskBoard } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/store', () => ({ Epoch: {}, run: async () => ({ ok: true, value: undefined }), useTopic: () => undefined }))

const { Board } = await import('../src/renderer/tasks/Tasks')

const BOARD: TaskBoard = {
  columns: [
    { name: 'todo', cards: [{ id: 't_1', title: 'Sweep the logs', assignee: null, summary: null }] },
    { name: 'running', cards: [{ id: 't_2', title: 'Fix <the> build', assignee: 'ada', summary: 'Reading the failing job' }] },
    { name: 'done', cards: [] }
  ]
}

const draw = (board: TaskBoard, note: { id: string; words: string } | null = null) => renderToStaticMarkup(<Board board={board} note={note} onPick={() => {}} />)

describe('the task board', () => {
  it('draws each column in order with its count, and each card as a button naming its title, assignee and summary', () => {
    const html = draw(BOARD)
    expect(Array.from(html.matchAll(/<section class="lane" aria-label="(\w+)"><h3>\w+ <span>(\d)<\/span>/g), ([, name, count]) => `${name} ${count}`)).toEqual(['todo 1', 'running 1', 'done 0'])
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
