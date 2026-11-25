import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Command, CommandOutcome, Session } from '@highwing/hermes/domain'
import { loadFixture, play, playToEnd, type Moment } from '@highwing/hermes/testing'
import { checkThread, outline, threadView, type HelperView, type ThreadView } from '../src/thread-view'

const CLOCK = { now: 0, timeZone: 'UTC' }
const fixture = (name: string) => loadFixture(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url)))
const HELPER = 'sa-0-13199361'

const helpersOf = (view: ThreadView): HelperView[] => view.turns.flatMap(turn => turn.nodes.flatMap(node => (node.kind === 'helper' ? [node.helper] : [])))

async function played(name: string) {
  const moments: Moment[] = []
  const answered: [Command, CommandOutcome<unknown>][] = []
  for await (const moment of play(fixture(name), { answered: (command, outcome) => answered.push([command, outcome]) })) moments.push(moment)
  const calls = moments.at(-1)!.script.received.flatMap(frame => {
    const { method, params } = frame as { method?: string; params?: unknown }
    return method === 'subagent.interrupt' ? [params] : []
  })
  return { moments, answered, calls, last: threadView(moments.at(-1)!.session, CLOCK) }
}

describe('a helper stopped from its row, through the real client', () => {
  it('asks Hermes to stop that helper alone, and ends it Stopped in a first turn that settles', async () => {
    const { calls, last, answered } = await played('stop-helper.jsonl')
    expect(calls).toEqual([{ session_id: fixture('stop-helper.jsonl').header.sessionId, subagent_id: HELPER }])
    expect(answered.find(([command]) => command.do === 'stopHelper')?.[1]).toEqual({ ok: true, value: undefined })
    expect(helpersOf(last)).toMatchObject([{ state: 'failed', ended: 'Stopped', stop: null }])
    expect(outline(last)).toMatch(/^◆ Helper In the folder .*\(Stopped\)/m)
    expect(last.turns.map(turn => turn.end.kind)).toEqual(['done'])
    expect(checkThread(last)).toEqual([])
  })

  it('offers the stop while the helper works, and not once Hermes ended it', async () => {
    const { moments } = await played('stop-helper.jsonl')
    const stops = moments.map(({ session }) => helpersOf(threadView(session, CLOCK)).map(helper => helper.stop))
    expect(stops.filter(seen => seen.length > 0).map(([stop]) => stop).filter((stop, index, all) => stop !== all[index - 1])).toEqual([HELPER, null])
  })

  it('is refused in words when Hermes no longer runs the helper, which then ends as recorded', async () => {
    const { calls, last, answered } = await played('stop-helper-gone.jsonl')
    expect(calls).toHaveLength(1)
    expect(answered.find(([command]) => command.do === 'stopHelper')?.[1]).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Hermes is no longer running that helper.' } })
    expect(helpersOf(last)).toMatchObject([{ state: 'done', ended: null, stop: null }])
  })
})

describe('the delegating chat, opened again after its story', () => {
  it('shows the plan Hermes keeps in the turn that last called the todo tool, finished, and no plan in the turn before', async () => {
    const view = threadView(await playToEnd(fixture('delegate-reopened.jsonl')) as Session, CLOCK)
    expect(view.turns.map(turn => turn.nodes.filter(node => node.kind === 'plan').map(node => node.kind === 'plan' && `${node.plan.done} of ${node.plan.total}`))).toEqual([[], ['3 of 3']])
    expect(outline(view)).toContain('☑ Plan · 3 of 3 done')
  })
})
