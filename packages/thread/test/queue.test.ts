import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Session } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { sessionOf } from '../../hermes/src/domain/reduce'
import { fold, queue } from '../../hermes/test/support/story'
import { checkThread, outline, threadView } from '../src/thread-view'

const AT_PLAY_START = { now: 0, timeZone: 'UTC' }
const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/queue.jsonl', import.meta.url)))
const pushes = fixture.steps.filter(step => 'push' in step).length
const want = outline(threadView(sessionOf(fold(queue()), { state: 'online' }, null), AT_PLAY_START))

async function sessions(options?: Parameters<typeof play>[1]): Promise<Session[]> {
  const seen: Session[] = []
  for await (const { session } of play(fixture, options)) seen.push(session)
  return seen
}

const unsound = (seen: readonly Session[]) =>
  seen.flatMap((session, index) => checkThread(threadView(session, AT_PLAY_START)).map(problem => `moment ${index}: ${problem}`))
/** A played turn begins on this client's clock, so its time line is not the fold's, which has none. */
const outlined = (session: Session) => outline(threadView(session, AT_PLAY_START)).split('\n').filter(line => !line.startsWith('@ ')).join('\n')
const pendingOf = (seen: readonly Session[]) => seen.map(session => threadView(session, AT_PLAY_START).pending.map(message => `${message.text} (${message.status})`))

describe('the queue story in the thread view', () => {
  it('outlines the lost turn, then the turn with each steered line where the model read it, then the two that followed', () => {
    expect(want.split('\n')).toEqual([
      '> Rename every note to kebab-case.',
      '| Renaming the notes to kebab-case.',
      '● Ran `ls /tmp/hermes-proto-work/notes`',
      '~ Ended while Highwing was disconnected.',
      '',
      '> Then list what changed.',
      '| Listing what changed in the notes folder.',
      '● Ran `ls /tmp/hermes-proto-work/notes`',
      '» Also update the changelog, under Unreleased.',
      "| Three notes were renamed. I'll update the changelog under Unreleased as well.",
      '● Ran `cat /tmp/hermes-proto-work/CHANGELOG.md`',
      '» Use ISO dates in the changelog.',
      '| Using ISO dates. Tagging the release next.',
      '● Ran `git tag --list`  2.8 s',
      '» Skip the tag for now.',
      '| Skipping the tag. Clearing the old drafts.',
      '○ You said no.',
      '● Ran `rm -rf /tmp/hermes-proto-work/drafts`',
      '» Move it to the trash instead of deleting it.',
      '| I left the drafts in place and moved nothing: there is no trash command here. The changelog is updated with ISO dates.',
      '✓ Done',
      '',
      '> Now draft the release notes.',
      '| Release notes: notes renamed to kebab-case, changelog updated under Unreleased, no tag yet.',
      '✓ Done',
      '',
      '> Keep them to three lines.',
      '| Renamed the notes.',
      '✓ Done'
    ])
  })

  it('draws the outline of the direct fold when played through the real client, and is sound at every moment', async () => {
    const seen = await sessions()
    expect(unsound(seen)).toEqual([])
    expect(outlined(seen.at(-1) as Session)).toBe(want)
  })

  it("lists this client's queued messages under the last turn as before, and never another client's or one queued before Highwing started", async () => {
    const pending = pendingOf(await sessions())
    expect(pending).toContainEqual(['Also update the changelog. (queued)'])
    expect(pending).toContainEqual(['Also update the changelog, under Unreleased. (queued)'])
    expect(pending).toContainEqual(['Now draft the release notes. (queued)'])
    const texts = new Set(pending.flat())
    expect([...texts].filter(text => text.startsWith('And tag the release') || text.startsWith('Rename every note') || text.startsWith('Then list what changed'))).toEqual([])
  })

  it.each(Array.from({ length: pushes }, (_, index) => index + 1))('a drop after push %i, 3 missed, stays sound and ends in the same outline', async afterPush => {
    const seen = await sessions({ drop: { afterPush, missed: 3 } })
    expect(unsound(seen)).toEqual([])
    expect(outlined(seen.at(-1) as Session)).toBe(want)
  })
})
