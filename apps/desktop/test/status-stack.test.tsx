import type { BackgroundProcess, Goal, Heartbeat, Loop, ProcessId } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { every, goalParts, heartbeatParts, loopParts, pressesOf, processesWords, processState } from '../src/renderer/composer/stack'
import { StatusStack } from '../src/renderer/composer/StatusStack'

const process = (state: BackgroundProcess['state']): BackgroundProcess => ({ id: 'proc_1' as ProcessId, command: 'npm run dev', state, startedAt: null, tail: '' })
const RUNNING = process({ s: 'running' })
const ended = (code: number | null, why: string | null) => process({ s: 'exited', code, why, at: null })

const GOAL: Goal = {
  title: 'Ship the release notes', status: 'active', turns: { used: 3, max: 20 },
  contract: { outcome: null, verification: null, constraints: null, boundaries: null, stopWhen: null },
  subgoals: [], gates: [], pausedWhy: null, verdict: null, waiting: null
}
const LOOP: Loop = { prompt: 'Check the build', status: 'active', mode: 'interval', everyS: 300, ticks: { fired: 2, max: 0 }, nextAt: null, heldByGoal: false, pausedWhy: null, stoppedWhy: null }
const HEARTBEAT: Heartbeat = { prompt: 'Any news?', status: 'active', everyS: 1800, fired: 0, lastAt: null }
const NOW = 1_800_000_000_000

const draw = (more: Partial<Parameters<typeof StatusStack>[0]>) => renderToStaticMarkup((
  <StatusStack processes={[]} control={null} disabled={false} onKill={() => new Promise(() => {})} onControl={() => new Promise(() => {})} {...more} />
))

describe('the status stack', () => {
  it('draws no row for a chat with no process, goal, loop or heartbeat, and keeps its status line', () => {
    expect(draw({})).toBe('<p class="stack-said" role="status"></p>')
  })

  it('draws a closed row for each thing Hermes holds, processes first', () => {
    const markup = draw({ processes: [RUNNING], control: { goal: GOAL, loop: LOOP, heartbeat: HEARTBEAT } })
    const rows = [...markup.matchAll(/<button type="button" class="head" aria-expanded="false">(.*?)<span class="chev"/g)].map(match => match[1]?.replace(/<[^>]*>/g, ''))
    expect(rows).toEqual(['1 running in the background', 'Goal Turn 3 of 20 Working', 'Loop Every 5 min', 'Heartbeat Every 30 min'])
  })

  it('counts the processes still running, or the ones that ended when none runs', () => {
    expect(processesWords([RUNNING, RUNNING])).toBe('2 running in the background')
    expect(processesWords([RUNNING, ended(0, 'exited')])).toBe('1 running in the background')
    expect(processesWords([ended(0, 'exited')])).toBe('1 ended in the background')
  })

  it('says how a process ended in Hermes\'s words', () => {
    expect(processState(RUNNING)).toBe('Running')
    expect(processState(ended(1, 'exited'))).toBe('Exited 1')
    expect(processState(ended(-15, 'killed'))).toBe('Stopped')
    expect(processState(ended(null, 'lost'))).toBe('Lost')
    expect(processState(ended(null, null))).toBe('Exited')
  })

  it('names the goal\'s turn and its state, a blocked check over the status', () => {
    expect(goalParts({ ...GOAL, status: 'paused' })).toEqual(['Turn 3 of 20', 'Paused'])
    expect(goalParts({ ...GOAL, verdict: { is: 'blocked', why: 'tests fail' } })).toEqual(['Turn 3 of 20', 'Blocked'])
    expect(goalParts({ ...GOAL, turns: { used: 3, max: 0 }, status: 'done' })).toEqual(['Turn 3', 'Done'])
  })

  it('counts a loop down to Hermes\'s next time on this clock', () => {
    expect(loopParts({ ...LOOP, nextAt: NOW + 245_000 }, NOW)).toEqual(['Every 5 min', 'Next in 4:05'])
    expect(loopParts({ ...LOOP, nextAt: NOW + 3_725_000 }, NOW)).toEqual(['Every 5 min', 'Next in 1:02:05'])
    expect(loopParts({ ...LOOP, nextAt: NOW - 1 }, NOW)).toEqual(['Every 5 min', 'Due'])
    expect(loopParts({ ...LOOP, nextAt: NOW + 245_000, heldByGoal: true }, NOW)).toEqual(['Every 5 min', 'Waiting for the goal'])
    expect(loopParts({ ...LOOP, mode: 'self-paced' }, NOW)).toEqual(['Self-paced'])
    expect(heartbeatParts({ ...HEARTBEAT, status: 'paused' })).toEqual(['Every 30 min', 'Paused'])
    expect([30, 3600, 5400].map(every)).toEqual(['30 s', '1 h', '1 h 30 min'])
  })

  it('offers Pause or Resume as the card stands, and a Clear or Stop that asks first', () => {
    const offered = (...args: Parameters<typeof pressesOf>) => pressesOf(...args).map(({ act, ask }) => [act, ask !== null])
    expect(offered('goal', 'active')).toEqual([['goal.pause', false], ['goal.clear', true]])
    expect(offered('goal', 'paused')).toEqual([['goal.resume', false], ['goal.clear', true]])
    expect(offered('goal', 'done')).toEqual([['goal.clear', true]])
    expect(offered('loop', 'active')).toEqual([['loop.pause', false], ['loop.stop', true]])
    expect(offered('heartbeat', 'paused')).toEqual([['heartbeat.resume', false], ['heartbeat.clear', true]])
  })
})
