import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Session } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { sessionOf } from '../../hermes/src/domain/reduce'
import { fold, panels } from '../../hermes/test/support/story'
import { checkThread, outline, threadView } from '../src/thread-view'

const AT_PLAY_START = { now: 0, timeZone: 'UTC' }
const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/panels.jsonl', import.meta.url)))
const pushes = fixture.steps.filter(step => 'push' in step).length
const want = outline(threadView(sessionOf(fold(panels()), { state: 'online' }, null), AT_PLAY_START))

async function sessions(options?: Parameters<typeof play>[1]): Promise<Session[]> {
  const seen: Session[] = []
  for await (const { session } of play(fixture, options)) seen.push(session)
  return seen
}

const unsound = (seen: readonly Session[]) =>
  seen.flatMap((session, index) => checkThread(threadView(session, AT_PLAY_START)).map(problem => `moment ${index}: ${problem}`))
const outlined = (session: Session) => outline(threadView(session, AT_PLAY_START)).split('\n').filter(line => !line.startsWith('@ ')).join('\n')

describe('the panels story in the thread view', () => {
  it('outlines the turn the restore kept, as Hermes stores it, and nothing of the panel', () => {
    expect(want.split('\n')).toEqual([
      '> Start the docs server, then write the release notes in release.md.',
      '| Starting the docs server first.',
      "■ Ran `echo 'serving the docs on :8000'; exec sleep 600` · 2 steps",
      "    ● Ran `echo 'serving the docs on :8000'; exec sleep 600`",
      '    ● Wrote `release.md`',
      '| The docs server is running, and release.md lists the two changes.',
      '✓ Done'
    ])
  })

  it('draws the outline of the direct fold when played through the real client, and is sound at every moment', async () => {
    const seen = await sessions()
    expect(unsound(seen)).toEqual([])
    expect(outlined(seen.at(-1) as Session)).toBe(want)
  })

  it('lets each settled turn take a reaction on its stored answer, shows the one given, and offers none on a running turn', async () => {
    const seen = await sessions()
    const running = seen.find(session => session.run.state === 'running') as Session
    expect(threadView(running, AT_PLAY_START).turns.at(-1)?.reactions).toBeNull()
    const reacted = seen.find(session => session.history.some(turn => (turn.reply?.reactions.length ?? 0) > 0)) as Session
    const turns = threadView(reacted, AT_PLAY_START).turns
    expect(turns.map(turn => turn.reactions?.given)).toEqual([[{ emoji: '👍', by: 'user' }], []])
    expect(turns.map(turn => turn.reactions?.turn)).toEqual(reacted.history.map(turn => turn.id))
  })

  it.each(Array.from({ length: pushes }, (_, index) => index + 1))('a drop after push %i, 3 missed, stays sound and ends in the same outline', async afterPush => {
    const seen = await sessions({ drop: { afterPush, missed: 3 } })
    expect(unsound(seen)).toEqual([])
    expect(outlined(seen.at(-1) as Session)).toBe(want)
  })
})
