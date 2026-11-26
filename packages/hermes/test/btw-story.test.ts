import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CommandOutcome } from '../src/domain'
import { loadFixture, play, type Moment } from '../src/testing/fixture'
import { commands, fold, ignoringClocks } from './support/story'

const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/btw.jsonl', import.meta.url)))
const recorded = ignoringClocks(fold(commands()).content)

async function played() {
  const seen: Moment[] = []
  const outcomes: CommandOutcome<unknown>[] = []
  for await (const moment of play(fixture, { answered: (_, outcome) => outcomes.push(outcome) })) seen.push(moment)
  return { seen, outcomes, last: seen.at(-1)! }
}

describe('side questions asked while a turn runs, played through the real client', () => {
  it('answers every command and plays the story to its end', async () => {
    const { outcomes, last } = await played()
    expect(outcomes).toHaveLength(3)
    expect(outcomes.every(outcome => outcome.ok)).toBe(true)
    expect(last.script.finished).toBe(true)
  })

  it('settles the turn exactly as it does with no side questions', async () => {
    const { last } = await played()
    const items = ignoringClocks(last.session).history.map(turn => turn.items)
    expect(items[0]?.length).toBeGreaterThan(0)
    expect(items).toEqual(recorded.history.slice(0, 1).map(turn => turn.items))
  })

  it('keeps each answer with its own question, though they came in the other order', async () => {
    const { last } = await played()
    expect(last.session.sides, 'in the order answered, each after the turn that ran').toEqual([
      { id: 'btw_8e41d7', kind: 'btw', asked: 'what does this flag do?', state: { s: 'done', text: 'It turns on **dry-run** mode, so nothing is written.', after: 'run:1' } },
      { id: 'btw_1f0a2c', kind: 'btw', asked: 'why?', state: { s: 'done', text: expect.stringMatching(/^Because the release notes/), after: 'run:1' } },
      { id: 'btw_elsewhere', kind: 'btw', asked: 'Which branch is this on?', state: { s: 'done', text: 'main.', after: 'run:1' } }
    ])
  })

  it('sends prompt.btw once per question, with the chat and the words only', async () => {
    const { last } = await played()
    const sent = last.script.received.flatMap(frame => {
      const { method, params } = frame as { method?: string; params?: unknown }
      return method === 'prompt.btw' ? [params] : []
    })
    expect(sent).toEqual([
      { session_id: fixture.header.sessionId, text: 'why?' },
      { session_id: fixture.header.sessionId, text: 'what does this flag do?' }
    ])
  })

  it('shows the side questions waiting while the turn still runs', async () => {
    const { seen } = await played()
    const asking = seen.find(moment => moment.session.sides.length === 2)!.session
    expect(asking.run.state).toBe('running')
    expect(asking.sides.map(side => side.state.s)).toEqual(['running', 'running'])
  })
})
