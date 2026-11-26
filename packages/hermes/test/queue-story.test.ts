import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CommandOutcome, QueuedMessage, Session } from '../src/domain'
import { loadFixture, play, type Moment } from '../src/testing/fixture'
import { fold, ignoringClocks, queue } from './support/story'

const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/queue.jsonl', import.meta.url)))
const want = fold(queue()).content
const pushes = fixture.steps.filter(step => 'push' in step).length
const calls = fixture.steps.flatMap(step => ('await' in step ? [step] : []))
const paramsOf = (method: string) => calls.filter(step => step.await === method).map(step => step.params as Record<string, unknown>)
const replyOf = (method: string, nth = 0) => calls.filter(step => step.await === method)[nth]?.reply as Record<string, unknown>
const comparable = (session: Session | typeof want) => ignoringClocks({ ...session, tuning: null, sync: null })

interface Played { readonly seen: readonly Moment[]; readonly outcomes: readonly (readonly [string, CommandOutcome<unknown>])[] }

async function played(options?: Parameters<typeof play>[1]): Promise<Played> {
  const seen: Moment[] = []
  const outcomes: [string, CommandOutcome<unknown>][] = []
  for await (const moment of play(fixture, { ...options, answered: (command, outcome) => outcomes.push([command.do, outcome]) })) seen.push(moment)
  return { seen, outcomes }
}

const rowsOf = (session: Session) => session.queue.map((row: QueuedMessage) => [row.text, row.from, row.state.s] as const)
const sentBy = (moment: Moment, method: string) => moment.script.received.flatMap(frame => {
  const sent = frame as { method?: string; params?: unknown }
  return sent.method === method ? [sent.params] : []
})
const steersIn = (session: Pick<Session, 'history'>, turn: number) => session.history[turn]?.items.flatMap(item => (item.kind === 'steer' ? [item.text] : []))

describe("Hermes's queue, from its own authority", () => {
  it('opens on a turn Hermes lost to a restart, with the message behind it still queued', () => {
    expect(fixture.header.pending).toMatchObject([{ status: 'unknown', execution_generation: 1 }, { status: 'queued', controls: ['steer', 'replace'] }])
  })

  it('folds to the lost turn and three settled ones, with every word put into the second where the model read it', () => {
    expect(want.history.map(turn => [turn.request?.text, turn.outcome.kind])).toEqual([
      ['Rename every note to kebab-case.', 'lost'], ['Then list what changed.', 'complete'], ['Now draft the release notes.', 'complete'], ['Keep them to three lines.', 'complete']
    ])
    expect(steersIn(want, 1)).toEqual([
      'Also update the changelog, under Unreleased.', 'Use ISO dates in the changelog.', 'Skip the tag for now.', 'Move it to the trash instead of deleting it.'
    ])
    expect(want.queue).toEqual([])
    expect(want.outbox).toEqual([])
    expect(want.run).toEqual({ state: 'idle' })
  })

  it('records every verdict Hermes gave', () => {
    expect(replyOf('prompt.resolve_unknown')).toMatchObject({ status: 'terminal', outcome: 'interrupted' })
    expect(replyOf('prompt.cancel')).toMatchObject({ status: 'terminal', outcome: 'cancelled' })
    expect(replyOf('prompt.steer_queued')).toMatchObject({ status: 'started', execution_generation: 2 })
    expect(replyOf('session.steer')).toMatchObject({ status: 'queued' })
    expect(replyOf('session.redirect', 0)).toMatchObject({ status: 'redirected' })
    expect(replyOf('session.redirect', 1)).toMatchObject({ status: 'rejected', delivered: false })
  })
})

describe('the queue story, played through the real client', () => {
  it('ends in the session the direct fold gives', async () => {
    const { seen } = await played()
    expect(comparable(seen.at(-1)!.session)).toEqual(comparable(want))
  })

  it('shows the lost row first, and runs the message behind it once the row is released', async () => {
    const { seen } = await played()
    const first = seen.find(moment => moment.session.sync.state === 'live')!.session
    expect(first.queue).toMatchObject([
      { text: 'Rename every note to kebab-case.', from: 'elsewhere', state: { s: 'lost', generation: 1 } },
      { text: 'Then list what changed.', state: { s: 'queued', can: ['sendNow', 'edit'] } }
    ])
    expect(first.run).toEqual({ state: 'idle' })
    expect(first.history.at(-1)?.outcome).toEqual({ kind: 'lost' })
    const running = seen.find(moment => moment.session.run.state === 'running')!.session
    expect(running.queue).toEqual([])
    expect(running.run).toMatchObject({ turn: { request: { text: 'Then list what changed.' } } })
  })

  it("holds another client's message beside this one's, and follows each edit, cancel and send-now by Hermes's next list", async () => {
    const { seen } = await played()
    const lists = seen.map(moment => rowsOf(moment.session)).filter((rows, index, all) => JSON.stringify(rows) !== JSON.stringify(all[index - 1]))
    expect(lists).toContainEqual([['Also update the changelog.', 'here', 'queued'], ['And tag the release as v2.', 'elsewhere', 'queued']])
    expect(lists, 'the edit goes to the back').toContainEqual([['And tag the release as v2.', 'elsewhere', 'queued'], ['Also update the changelog, under Unreleased.', 'here', 'queued']])
    expect(lists).toContainEqual([['Also update the changelog, under Unreleased.', 'here', 'queued']])
    expect(lists).toContainEqual([['Also update the changelog, under Unreleased.', 'here', 'steering']])
    expect(seen.every(moment => moment.session.outbox.every(entry => !moment.session.queue.some(row => row.inputId === entry.inputId))), 'a message is in the outbox or in the queue').toBe(true)
  })

  it('never takes the message sent now for the request of the turn it went into', async () => {
    const { seen } = await played()
    const requests = seen.flatMap(({ session }) => (session.run.state === 'running' && session.queue.some(row => row.state.s === 'steering') ? [session.run.turn.request?.text] : []))
    expect(requests.length).toBeGreaterThan(0)
    expect(new Set(requests)).toEqual(new Set(['Then list what changed.']))
  })

  it('makes each queue call with the row it names, and the release with the generation the lost row ran as', async () => {
    const last = (await played()).seen.at(-1)!
    for (const method of ['prompt.resolve_unknown', 'prompt.replace_queued', 'prompt.cancel', 'prompt.steer_queued', 'session.steer', 'session.redirect']) {
      expect(sentBy(last, method), method).toEqual(paramsOf(method))
    }
    expect(paramsOf('prompt.resolve_unknown')).toMatchObject([{ execution_generation: 1 }])
    expect(sentBy(last, 'approval.respond')).toMatchObject([{ choice: 'deny' }])
  })

  it('submits the words of a redirect no agent saw, and says where the words of the denial went', async () => {
    const { seen, outcomes } = await played()
    expect(sentBy(seen.at(-1)!, 'prompt.submit').map(params => (params as { text: string }).text)).toEqual([
      'Also update the changelog.', 'Now draft the release notes.', 'Keep them to three lines.'
    ])
    expect(outcomes.filter(([command]) => command === 'answer')).toEqual([['answer', { ok: true, value: 'turn' }]])
    expect(outcomes.every(([, outcome]) => outcome.ok)).toBe(true)
  })

  it('reads the busy mode the fixture has, and leaves the chat in the mode of its last send', async () => {
    const { seen } = await played()
    expect(seen.find(moment => moment.session.tuning.busy !== null)?.session.tuning).toEqual({ reasoning: null, busy: 'queue', effort: null, fast: null, yolo: null, approvals: null })
    expect(sentBy(seen.at(-1)!, 'config.set').map(params => (params as { value: string }).value)).toEqual(['steer', 'queue', 'interrupt'])
  })
})

describe('a socket drop after every push of the queue story', () => {
  it.each(Array.from({ length: pushes }, (_, index) => index + 1))('drop after push %i, 3 missed, ends in the undisturbed session', async afterPush => {
    const { seen } = await played({ drop: { afterPush, missed: 3 } })
    expect(seen.at(-1)!.script.dials).toBe(2)
    expect(seen.map(moment => moment.session.sync.state)).not.toContain('rebuilding')
    expect(comparable(seen.at(-1)!.session)).toEqual(comparable(want))
  })

  it('rebuilds from the stored rows when the ring is too small, and reads the steered words from them', async () => {
    const { seen } = await played({ drop: { afterPush: pushes - 3, missed: 4 }, ringFrames: 1 })
    expect(seen.map(moment => moment.session.sync.state)).toContain('rebuilding')
    const last = seen.at(-1)!.session
    expect(last.history.map(turn => turn.request?.text)).toEqual(want.history.map(turn => turn.request?.text))
    expect(steersIn(last, 1)).toEqual(steersIn(want, 1))
    expect(last.queue).toEqual([])
  })
})

