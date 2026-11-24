import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Session } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { sessionOf } from '../../hermes/src/domain/reduce'
import { asks, fold } from '../../hermes/test/support/story'
import { checkThread, outline, threadView } from '../src/thread-view'

const AT_PLAY_START = { now: 0, timeZone: 'UTC' }
const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/asks.jsonl', import.meta.url)))
const pushes = fixture.steps.filter(step => 'push' in step).length
const want = outline(threadView(sessionOf(fold(asks()), { state: 'online' }, null), AT_PLAY_START))
const ANSWERED_ELSEWHERE = '◇ code: elsewhere'

async function sessions(options?: Parameters<typeof play>[1]): Promise<Session[]> {
  const seen: Session[] = []
  for await (const { session } of play(fixture, options)) seen.push(session)
  return seen
}

const unsound = (seen: readonly Session[]) =>
  seen.flatMap((session, index) => checkThread(threadView(session, AT_PLAY_START)).map(problem => `moment ${index}: ${problem}`))

describe('the asks story in the thread view', () => {
  it('outlines the turn with a line where each request closed, then the plugin choice as an interlude', () => {
    expect(want.split('\n')).toEqual([
      '> Install jq, find me a celebration gif, check my example.com account, then deploy the notes site.',
      "| I'll install jq first. That needs your sudo password.",
      '● Ran `sudo apt-get install -y jq`  3.9 s',
      '◇ sudo: answered',
      '| Now the gif. The gif-search skill needs a Tenor key.',
      '● Used `skill_view`  1.6 s',
      '◇ env: skipped',
      "| No key, so I'll skip the gif. Signing in to example.com.",
      '● Used `browser_navigate`  3.3 s',
      ANSWERED_ELSEWHERE,
      "| You're signed in. Before I deploy, two questions.",
      '● Used `clarify`  3.3 s',
      '◇ questions: answered',
      '| Production in two regions. The deploy needs GitHub connected.',
      '● Used `manage_connections`  1.6 s',
      '◇ connect: done',
      "| Skipped, so I'll deploy from the local checkout. Offering an accent colour while it runs.",
      '● Used `set_theme`  1.5 s',
      "! Hermes sent a request Highwing can't show yet (theme.pick), so it said no.",
      '| Done. jq is installed, the gif was skipped for want of a Tenor key, and the notes site is deployed to production.',
      '✓ Done',
      '',
      '◇ questions: answered'
    ])
  })

  it('draws the outline of the direct fold when played through the real client, and is sound at every moment', async () => {
    const seen = await sessions()
    expect(unsound(seen)).toEqual([])
    expect(outline(threadView(seen.at(-1) as Session, AT_PLAY_START))).toBe(want)
  })

  it.each(Array.from({ length: pushes }, (_, index) => index + 1))('a drop after push %i, 3 missed, stays sound and ends in the same outline, but for a code answered elsewhere meanwhile', async afterPush => {
    const seen = await sessions({ drop: { afterPush, missed: 3 } })
    expect(unsound(seen)).toEqual([])
    const seenHere = (text: string) => text.split('\n').filter(line => line !== ANSWERED_ELSEWHERE)
    expect(seenHere(outline(threadView(seen.at(-1) as Session, AT_PLAY_START)))).toEqual(seenHere(want))
  })
})
