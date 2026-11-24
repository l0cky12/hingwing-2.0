import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Session } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { reduce, sessionOf, type Tracked } from '../../hermes/src/domain/reduce'
import type { Link } from '../../hermes/src/domain/session'
import { delegate, fold, foldWithDrop, type Moment } from '../../hermes/test/support/story'
import { checkThread, outline, threadView, type ThreadNode, type ThreadView } from '../src/thread-view'

const CLOCK = { now: 0, timeZone: 'UTC' }
const ONLINE: Link = { state: 'online' }
const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/delegate.jsonl', import.meta.url)))
const pushes = fixture.steps.filter(step => 'push' in step).length
const story = delegate()
const view = (state: Tracked) => threadView(sessionOf(state, ONLINE, null), CLOCK)

const SETTLED = [
  '> Find why the nightly backup in this folder failed. First write a three-item plan with your todo tool. Then use delegate_task to have one helper ' +
    'check how much space backups/ uses (du -sh backups and df -h .) while you read cron.txt and backup.log yourself. Tick items off in the todo list ' +
    'as you finish them, and end with one sentence on the cause.',
  '▸ Thought',
  '■ Ran `ls -la /tmp/highwing-backup-work/` · 2 steps',
  '    ● Used `tool_describe`',
  '    ● Ran `ls -la /tmp/highwing-backup-work/`',
  '☐ Plan · 1 of 3 done',
  '■ Used 3 tools · 3 steps',
  '    ● Used `tool_call`',
  '    ● Used `tool_call`',
  '    ● Used `tool_call`',
  '◆ Helper In the folder /tmp/highwing-backup-work, run `du -sh /tmp/highwing-backup-work/backups` and `df -h /tmp/highwing-backup… · 1 step  3.3 s',
  '■ Used 2 tools · 2 steps',
  '    ● Read `cron.txt`',
  '    ● Read `backup.log`',
  '▸ Thought',
  '| **Plan (3 items):** 1. delegated space check (du -sh backups, df -h .) — helper running now · 2. cron.txt + backup.log read — done · ' +
    '3. correlate and state cause — pending helper result.',
  '✓ Done',
  '',
  '> Subagent Task Completed: In the folder /tmp/highwing-backup-work, run `du -sh /tmp/highwing-backup-work/backups` and `df -h /tmp/highwing-backup-work` ' +
    "and report the exact output of both commands, including the filesystem'...",
  '▸ Thought',
  '● Ran `ls -la /tmp/highwing-backup-work/backups/`',
  '▸ Thought',
  '☑ Plan · 3 of 3 done',
  '| **Cause (one sentence):** The nightly backup died on 2026-11-23 at 02:31 because tar hit a disk-space short write (`Wrote only 4096 of 10240 bytes`, ' +
    'exit 2) while creating `home-2026-11-23.tar.gz` — the storage backing the backups folder was full at backup time, even though the filesystem shows 24G free now.',
  '✓ Done',
  '  58,711 in, 1,226 out, 831 reasoning'
].join('\n')

async function sessions(options?: Parameters<typeof play>[1]): Promise<Session[]> {
  const seen: Session[] = []
  for await (const { session } of play(fixture, options)) seen.push(session)
  return seen
}

function unsound(seen: readonly Session[]): string[] {
  return seen.flatMap((session, index) => checkThread(threadView(session, CLOCK)).map(problem => `moment ${index}: ${problem}`))
}

const kindsPerTurn = (shown: ThreadView, kind: ThreadNode['kind']) => shown.turns.map(turn => turn.nodes.filter(node => node.kind === kind).length)

describe('the delegating errand played through the real client', () => {
  it('shows the helper, each turn\'s plan and every reasoning block once settled', async () => {
    const settled = threadView((await sessions()).at(-1) as Session, CLOCK)
    expect(outline(settled)).toBe(SETTLED)
    expect(kindsPerTurn(settled, 'helper')).toEqual([1, 0])
    expect(kindsPerTurn(settled, 'plan')).toEqual([1, 1])
    expect(kindsPerTurn(settled, 'reasoning')).toEqual([2, 2])
  })

  it('draws the outline of the direct fold', () => {
    expect(outline(view(fold(story)))).toBe(SETTLED)
  })

  it('never holds two plan nodes in a turn, and is a sound thread at every moment', async () => {
    const seen = await sessions()
    expect(seen.flatMap(session => kindsPerTurn(threadView(session, CLOCK), 'plan')).every(count => count <= 1)).toBe(true)
    expect(unsound(seen)).toEqual([])
  })

  it('carries the live end on a reasoning block, the helper and the plan as the turn moves on', async () => {
    const carriers = (await sessions()).flatMap(session => threadView(session, CLOCK).turns.flatMap(turn => {
      const { end } = turn
      return end.kind === 'at' && end.tone === 'live' ? turn.nodes.filter(node => node.key === end.nodeKey).map(node => node.kind) : []
    }))
    expect(new Set(carriers)).toEqual(new Set(['step', 'group', 'reasoning', 'helper', 'plan']))
  })

  it.each(Array.from({ length: pushes }, (_, index) => index + 1))('a drop after push %i, 3 missed, ends in the same outline and stays sound', async afterPush => {
    const seen = await sessions({ drop: { afterPush, missed: 3 } })
    expect(unsound(seen)).toEqual([])
    expect(outline(threadView(seen.at(-1) as Session, CLOCK))).toBe(SETTLED)
  })
})

describe('soundness of the delegating errand view, folded directly', () => {
  const moments: Moment[] = []
  fold(story, moment => moments.push(moment))

  it.each(moments.map(({ beat }) => beat))('holds at beat %i, live, offline and catching up', beat => {
    const { state } = moments[beat]!
    const offline = reduce(state, { in: 'link.lost' })
    const catchingUp = reduce(offline, { in: 'attach' })
    expect(checkThread(view(state))).toEqual([])
    expect(checkThread(threadView(sessionOf(offline, { state: 'connecting', attempt: 1 }, null), CLOCK))).toEqual([])
    expect(checkThread(view(catchingUp))).toEqual([])
  })

  it.each(Array.from({ length: story.frames.length }, (_, i) => i + 1))('holds after a drop after frame %i, and ends in the same outline', afterFrame => {
    const got = view(foldWithDrop(story, afterFrame, 3))
    expect(checkThread(got)).toEqual([])
    expect(outline(got)).toBe(SETTLED)
  })
})
