import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Session } from '../src/domain/session'
import { loadFixture, play, playToEnd, type Moment } from '../src/testing/fixture'
import { fold, ignoringClocks, says } from './support/story'

const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/says.jsonl', import.meta.url)))
const want = fold(says()).content
const pushes = fixture.steps.filter(step => 'push' in step).length
const LIVE: Session = { ...want, tuning: { reasoning: true, busy: null }, sync: { state: 'live' } }

async function moments(options?: Parameters<typeof play>[1]): Promise<Moment[]> {
  const seen: Moment[] = []
  for await (const moment of play(fixture, options)) seen.push(moment)
  return seen
}

const sentOf = (moment: Moment) => moment.script.received.flatMap(frame => {
  const { method, params } = frame as { method?: string; params?: unknown }
  return method === undefined ? [] : [{ method, params }]
})

describe('what Hermes says, from its own emitters', () => {
  it('folds to one settled turn holding reasoning, a MoA round, the tool image, status lines and a cleared notice, then the verdict in the interlude', () => {
    expect(want.run).toEqual({ state: 'idle' })
    expect(want.history).toHaveLength(1)
    const items = want.history[0]!.items
    expect(items.map(item => (item.kind === 'status' ? `${item.what}:${item.what === 'line' ? item.about : item.state}` : item.kind))).toEqual([
      'moa', 'reasoning', 'text', 'tool', 'line:compacted', 'line:print', 'notice:cleared', 'reasoning', 'text', 'tool', 'prompt', 'text'
    ])
    expect(items.find(item => item.kind === 'tool')).toMatchObject({ name: 'vision_analyze', status: { s: 'done', image: '/tmp/hermes-proto-work/chart.png' } })
    expect(items[0]).toMatchObject({ kind: 'moa', progress: { done: 2, total: 2 }, references: [{ label: 'fast-small' }, { label: 'careful-large' }], phase: { is: 'aggregating', by: 'judge-large' } })
    expect(want.interlude).toEqual([{ kind: 'status', what: 'line', about: 'goal', text: '✓ Goal achieved: the chart was read and the scratch folder is gone.' }])
  })
})

describe('the says story, played through the real client', () => {
  it('ends in the session the direct fold gives, with the reasoning switch Hermes answered', async () => {
    expect(ignoringClocks(await playToEnd(fixture))).toEqual(ignoringClocks(LIVE))
  })

  it('reads the chat\'s switches once, for the window that watches', async () => {
    const seen = await moments()
    expect(sentOf(seen.at(-1)!).filter(call => call.method === 'config.get')).toEqual(
      ['show_reasoning', 'busy'].map(key => ({ method: 'config.get', params: { session_id: fixture.header.sessionId, key } })))
  })

  it('counts the approval down from when it came off the socket, and keeps the notice\'s arrival time', async () => {
    const seen = await moments()
    const asking = seen.find(moment => moment.session.run.state === 'running' && moment.session.run.turn.items.some(item => item.kind === 'prompt'))!
    const turn = asking.session.run.state === 'running' ? asking.session.run.turn : null
    expect(turn?.items.find(item => item.kind === 'prompt')).toMatchObject({ deadline: expect.any(Number) })
    const prompt = turn?.items.find(item => item.kind === 'prompt')
    const notice = turn?.items.find(item => item.kind === 'status' && item.what === 'notice')
    expect(prompt?.kind === 'prompt' && notice?.kind === 'status' && notice.what === 'notice' && prompt.deadline! - notice.seenAt!).toBeGreaterThanOrEqual(300_000)
  })

  it('never opens a turn for the verdict said after the turn ended', async () => {
    const seen = await moments()
    const after = seen.filter(moment => moment.session.interlude.length > 0)
    expect(after.length).toBeGreaterThan(0)
    expect(after.every(moment => moment.session.run.state === 'idle')).toBe(true)
  })
})

describe('a socket drop after every push of the says story', () => {
  it.each(Array.from({ length: pushes }, (_, index) => index + 1))('drop after push %i, 3 missed, ends in the undisturbed session', async afterPush => {
    const seen = await moments({ drop: { afterPush, missed: 3 } })
    expect(seen.at(-1)!.script.dials).toBe(2)
    expect(seen.map(moment => moment.session.sync.state)).not.toContain('rebuilding')
    expect(ignoringClocks(seen.at(-1)!.session)).toEqual(ignoringClocks(LIVE))
  })

  it('rebuilds from the stored rows when the ring is too small, reading the reasoning they kept and dropping what lived only on the stream', async () => {
    const seen = await moments({ drop: { afterPush: 41, missed: 4 }, ringFrames: 1 })
    const { session } = seen.at(-1)!
    expect(seen.map(moment => moment.session.sync.state)).toContain('rebuilding')
    expect(session.history).toHaveLength(1)
    const items = session.history[0]!.items
    expect(items.filter(item => item.kind === 'reasoning').map(item => item.kind === 'reasoning' && item.text)).toEqual([
      'The user wants the chart read first, then the scratch folder removed. The reference models have read it.',
      'The chart is read. Only the scratch folder is left.'
    ])
    expect(items.some(item => item.kind === 'moa' || item.kind === 'status')).toBe(false)
    expect(session.interlude, 'the verdict was said inside the gap, so only the stream held it').toEqual([])
  })
})
