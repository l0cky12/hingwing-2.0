import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CommandOutcome, Session } from '../src/domain'
import { loadFixture, play, type Moment } from '../src/testing/fixture'
import { fold, ignoringClocks, panels } from './support/story'

const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/panels.jsonl', import.meta.url)))
const want = fold(panels()).content
const pushes = fixture.steps.filter(step => 'push' in step).length
const calls = fixture.steps.flatMap(step => ('await' in step ? [step] : []))
const paramsOf = (method: string) => calls.filter(step => step.await === method).map(step => step.params as Record<string, unknown>)
const replyOf = (method: string) => calls.find(step => step.await === method)?.reply as Record<string, unknown>
// The fold applies the restore's re-read before its rewind receipt, so it never sees the cut the client records.
const comparable = (session: Session | typeof want) => ignoringClocks({ ...session, tuning: { ...session.tuning, reasoning: null, busy: null }, sync: null, rewound: {} })
const SESSION = { session_id: fixture.header.sessionId }

interface Played { readonly seen: readonly Moment[]; readonly outcomes: readonly (readonly [string, CommandOutcome<unknown>])[] }

async function played(options?: Parameters<typeof play>[1]): Promise<Played> {
  const seen: Moment[] = []
  const outcomes: [string, CommandOutcome<unknown>][] = []
  for await (const moment of play(fixture, { ...options, answered: (command, outcome) => outcomes.push([command.do, outcome]) })) seen.push(moment)
  return { seen, outcomes }
}

const sentBy = (moment: Moment, method: string) => moment.script.received.flatMap(frame => {
  const sent = frame as { method?: string; params?: unknown }
  return sent.method === method ? [sent.params] : []
})
const changes = <T>(seen: readonly Moment[], of: (session: Session) => T) =>
  seen.map(moment => of(moment.session)).filter((said, index, all) => JSON.stringify(said) !== JSON.stringify(all[index - 1]))

describe('the session panels, from Hermes\'s own gateway', () => {
  it('folds to the first turn with the reaction on its answer, the killed server and the paused goal', () => {
    expect(want.history.map(turn => [turn.request?.text, turn.outcome.kind, turn.reply?.reactions])).toEqual([
      ['Start the docs server, then write the release notes in release.md.', 'complete', [{ emoji: '👍', by: 'user' }]]
    ])
    expect(want.processes).toEqual([{
      id: 'proc_83f11b2d9bbc', command: "echo 'serving the docs on :8000'; exec sleep 600", startedAt: expect.any(Number),
      state: { s: 'exited', code: -15, why: 'killed', at: expect.any(Number) }, tail: 'serving the docs on :8000\n'
    }])
    expect(want.control).toEqual({
      goal: {
        title: 'Ship the release notes', status: 'paused', turns: { used: 0, max: 20 }, subgoals: ['each change names its pull request'], gates: [],
        contract: { outcome: 'release.md lists every change in the release', verification: null, constraints: null, boundaries: null, stopWhen: null },
        pausedWhy: expect.any(String), verdict: null, waiting: null
      },
      loop: null,
      heartbeat: null
    })
  })

  it('records the closed key set of every call, and what Hermes answered', () => {
    expect(paramsOf('process.kill')).toEqual([{ ...SESSION, process_id: 'proc_83f11b2d9bbc' }])
    expect(replyOf('process.kill')).toMatchObject({ status: 'killed', completion_reason: 'killed' })
    expect(paramsOf('session.control').map(params => [params.action, params.args])).toEqual([['subgoal.add', { text: 'each change names its pull request' }], ['goal.pause', {}]])
    expect(paramsOf('rollback.list')).toEqual([SESSION])
    expect(replyOf('rollback.list')).toMatchObject({ enabled: true, checkpoints: [{ message: 'before patch' }, { message: 'before write_file' }] })
    expect(replyOf('rollback.diff')).toMatchObject({ stat: expect.stringContaining('release.md'), diff: expect.stringContaining('+# Release notes') })
    expect(replyOf('rollback.restore')).toMatchObject({ success: true, history_removed: 4 })
    expect(paramsOf('message.react')).toEqual([{ ...SESSION, row_id: 6, emoji: '👍' }])
  })
})

describe('the panels story, played through the real client', () => {
  it('ends in the session the direct fold gives', async () => {
    const { seen } = await played()
    expect(comparable(seen.at(-1)!.session)).toEqual(comparable(want))
    expect(seen.at(-1)!.session.rewound, 'the turn the restore took back sends what sat after it to the turn before').toEqual({ 'run:2': 'run:1' })
  })

  it('makes each call as Hermes recorded it, from the commands', async () => {
    const last = (await played()).seen.at(-1)!
    for (const method of ['process.kill', 'session.control', 'rollback.list', 'rollback.diff', 'rollback.restore', 'message.react']) {
      expect(sentBy(last, method), method).toEqual(paramsOf(method))
    }
  })

  it('answers each command with what Hermes said', async () => {
    const { outcomes } = await played()
    expect(outcomes.every(([, outcome]) => outcome.ok)).toBe(true)
    expect(outcomes.filter(([command]) => command === 'control').map(([, outcome]) => outcome)).toEqual([
      { ok: true, value: expect.stringContaining('each change names its pull request') }, { ok: true, value: expect.stringMatching(/paused/i) }
    ])
    expect(outcomes.find(([command]) => command === 'checkpoints')?.[1]).toMatchObject({ ok: true, value: { kept: 'on', items: [{ reason: 'before patch' }, { reason: 'before write_file' }] } })
    expect(outcomes.find(([command]) => command === 'checkpointDiff')?.[1]).toMatchObject({ ok: true, value: { patch: expect.stringContaining('+# Release notes') } })
    expect(outcomes.find(([command]) => command === 'restore')?.[1]).toEqual({ ok: true, value: { files: null, kept: [], lastTurn: 'removed' } })
  })

  it('reads the process list when the chat is watched, at each turn\'s end and after the kill, and nothing else', async () => {
    const { seen } = await played()
    expect(changes(seen, session => session.processes?.map(process => process.state.s) ?? null)).toEqual([null, [], ['running'], ['exited']])
    expect(sentBy(seen.at(-1)!, 'process.list')).toHaveLength(5)
  })

  it('shows the reaction from Hermes\'s answer at once, and again from the stored rows after the restore\'s rebuild', async () => {
    const { seen } = await played()
    const reacted = seen.findIndex(moment => moment.session.history[0]?.reply?.reactions.length === 1)
    const rebuilt = seen.findIndex(moment => moment.session.sync.state === 'rebuilding')
    expect(reacted).toBeGreaterThan(-1)
    expect(reacted, 'before the restore').toBeLessThan(rebuilt)
    expect(seen.at(-1)!.session.history.map(turn => turn.reply?.reactions)).toEqual([[{ emoji: '👍', by: 'user' }]])
    expect(sentBy(seen.at(-1)!, 'session.resume')).toHaveLength(2)
  })

  it('follows the goal through every update Hermes published', async () => {
    const { seen } = await played()
    expect(changes(seen, session => session.control?.goal?.status ?? null)).toEqual([null, 'active', 'paused'])
  })
})

describe('a socket drop after every push of the panels story', () => {
  it.each(Array.from({ length: pushes }, (_, index) => index + 1))('drop after push %i, 3 missed, ends in the undisturbed session', async afterPush => {
    const { seen } = await played({ drop: { afterPush, missed: 3 } })
    expect(seen.at(-1)!.script.dials).toBe(2)
    expect(comparable(seen.at(-1)!.session)).toEqual(comparable(want))
  })
})
