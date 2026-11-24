import { describe, expect, it } from 'vitest'
import { activityOf } from '../src/domain/reduce'
import type { HelperItem, Item, PlanItem, ReasoningItem, SettledTurn } from '../src/domain/session'
import { delegate, fold, foldWithDrop, type Beat, type Moment } from './support/story'

const story = delegate()

const shape = (item: Item) => (item.kind === 'tool' ? `tool:${item.name}` : item.kind)
const reasoningSent = (from: number, to: number) => story.frames
  .filter(({ stamp, event }) => stamp.seq >= from && stamp.seq <= to && event?.type === 'reasoning')
  .map(({ event }) => (event?.type === 'reasoning' ? event.text : ''))
  .join('')

describe('the delegating errand, folded through parse and reduce', () => {
  const end = fold(story)
  const [first, second] = end.content.history as [SettledTurn, SettledTurn]

  it('settles two complete turns, the second started by Hermes when the helper reported back', () => {
    expect(end.content.run).toEqual({ state: 'idle' })
    expect(end.content.history.map(turn => turn.outcome.kind)).toEqual(['complete', 'complete'])
    expect(second.request?.text).toMatch(/^Subagent Task Completed: In the folder \/tmp\/highwing-backup-work/)
  })

  it('keeps each reasoning block, the plan and the helper where they happened', () => {
    expect(first.items.map(shape)).toEqual([
      'reasoning', 'tool:tool_describe', 'tool:terminal', 'tool:todo_list', 'plan', 'tool:tool_call', 'tool:tool_call', 'tool:tool_call',
      'tool:delegate_task', 'helper', 'tool:read_file', 'tool:read_file', 'reasoning', 'tool:todo_list', 'text'
    ])
    expect(second.items.map(shape)).toEqual(['reasoning', 'tool:terminal', 'reasoning', 'tool:todo_list', 'plan', 'text'])
  })

  it('reads a block the helper interrupted as one block', () => {
    const blocks = first.items.filter((item): item is ReasoningItem<'settled'> => item.kind === 'reasoning')
    expect(blocks.map(block => block.text)).toEqual([reasoningSent(9, 23), reasoningSent(71, 78)])
    expect(blocks.every(block => block.sealed)).toBe(true)
  })

  it('holds one plan per turn at its newest revision', () => {
    const plans = [first, second].map(turn => turn.items.filter((item): item is PlanItem => item.kind === 'plan'))
    expect(plans.map(plan => plan.map(({ revision }) => revision))).toEqual([[2], [3]])
    expect(plans[0]?.[0]?.entries).toEqual([
      { id: '2', text: 'Read cron.txt and backup.log for the failure', status: 'completed', parentId: null },
      { id: '1', text: 'Delegate space check: du -sh backups and df -h .', status: 'in_progress', parentId: null },
      { id: '3', text: 'Correlate findings and state the cause', status: 'pending', parentId: null }
    ])
  })

  it('ends the helper completed, with its one tool and its summary', () => {
    const helper = first.items.find((item): item is HelperItem => item.kind === 'helper')
    expect(helper).toMatchObject({
      id: 'sa-0-13199361', parentId: null, depth: 0, toolCount: 1,
      goal: expect.stringMatching(/^In the folder \/tmp\/highwing-backup-work, run `du -sh/),
      steps: [{ kind: 'tool', name: 'terminal', preview: 'du -sh /tmp/highwing-backup-work/backups + 1 command' }],
      state: { s: 'ended', status: 'completed', durationS: 3.27, summary: expect.stringContaining('"interpretation": "Disk is not the cause') }
    })
  })

  it('reasons, then helps while the agent waits, then writes', () => {
    const moments: Moment[] = []
    fold(story, moment => moments.push(moment))
    const kinds = moments
      .map(({ state }) => activityOf(state.content).kind)
      .filter(kind => kind === 'reasoning' || kind === 'helping' || kind === 'writing' || kind === 'idle')
      .filter((kind, index, all) => kind !== all[index - 1])
    expect(kinds).toEqual(['idle', 'reasoning', 'helping', 'reasoning', 'helping', 'writing', 'idle', 'reasoning', 'writing', 'idle'])
  })

  it('ignores every frame delivered a second time', () => {
    const doubled = { ...story, beats: story.beats.flatMap((beat): Beat[] => (beat.kind === 'frame' ? [beat, beat] : [beat])) }
    expect(fold(doubled).content).toEqual(end.content)
  })
})

describe('a socket drop after every frame of the delegating errand', () => {
  const want = fold(story).content

  it.each(Array.from({ length: story.frames.length }, (_, i) => i + 1))('drop after frame %i, 3 missed, ends in the undisturbed session', afterFrame => {
    const got = foldWithDrop(story, afterFrame, 3)
    expect(got.gate.at).toBe('live')
    expect(got.content).toEqual(want)
  })
})
