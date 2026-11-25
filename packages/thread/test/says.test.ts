import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Session } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { sessionOf } from '../../hermes/src/domain/reduce'
import { fold, says } from '../../hermes/test/support/story'
import { checkThread, outline, threadView } from '../src/thread-view'

const AT_PLAY_START = { now: 0, timeZone: 'UTC' }
const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/says.jsonl', import.meta.url)))
const pushes = fixture.steps.filter(step => 'push' in step).length
const want = outline(threadView(sessionOf(fold(says()), { state: 'online' }, null), AT_PLAY_START))

async function sessions(options?: Parameters<typeof play>[1]): Promise<Session[]> {
  const seen: Session[] = []
  for await (const { session } of play(fixture, options)) seen.push(session)
  return seen
}

const unsound = (seen: readonly Session[]) =>
  seen.flatMap((session, index) => checkThread(threadView(session, AT_PLAY_START)).map(problem => `moment ${index}: ${problem}`))

describe('the says story in the thread view', () => {
  it('outlines the settled turn, then the verdict said after it as an interlude with no end mark', () => {
    expect(want.split('\n')).toEqual([
      '> In /tmp/hermes-proto-work: tell me what chart.png shows, then delete the scratch folder.',
      '≋ Asking 2 models · Combining their answers',
      '▸ Thought',
      '| The models agree it is a bar chart. Looking at it myself.',
      '● Used `vision_analyze`',
      '· compacted: ✓ Context compaction complete — continuing turn...',
      '· print: Subagent finished: 3 files checked.',
      '▸ Thought',
      '| It shows three weekly totals. Now removing the scratch folder.',
      '○ You allowed this once.',
      '● Ran `rm -rf /tmp/hermes-proto-work/scratch`',
      '| Done. The chart shows weekly totals of 4, 7 and 5, and the scratch folder is gone.',
      '✓ Done',
      '',
      '· goal: ✓ Goal achieved: the chart was read and the scratch folder is gone.'
    ])
  })

  it('draws the outline of the direct fold when played through the real client, and is sound at every moment', async () => {
    const seen = await sessions()
    expect(unsound(seen)).toEqual([])
    expect(outline(threadView(seen.at(-1) as Session, AT_PLAY_START))).toBe(want)
  })

  it.each(Array.from({ length: pushes }, (_, index) => index + 1))('a drop after push %i, 3 missed, ends in the same outline and stays sound', async afterPush => {
    const seen = await sessions({ drop: { afterPush, missed: 3 } })
    expect(unsound(seen)).toEqual([])
    expect(outline(threadView(seen.at(-1) as Session, AT_PLAY_START))).toBe(want)
  })
})
