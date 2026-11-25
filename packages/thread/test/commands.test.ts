import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Session } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { sessionOf } from '../../hermes/src/domain/reduce'
import { commands, fold } from '../../hermes/test/support/story'
import { checkThread, outline, threadView } from '../src/thread-view'

const AT_PLAY_START = { now: 0, timeZone: 'UTC' }
const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/commands.jsonl', import.meta.url)))
const pushes = fixture.steps.filter(step => 'push' in step).length
const want = outline(threadView(sessionOf(fold(commands()), { state: 'online' }, null), AT_PLAY_START))

async function sessions(options?: Parameters<typeof play>[1]): Promise<Session[]> {
  const seen: Session[] = []
  for await (const { session } of play(fixture, options)) seen.push(session)
  return seen
}

const unsound = (seen: readonly Session[]) =>
  seen.flatMap((session, index) => checkThread(threadView(session, AT_PLAY_START)).map(problem => `moment ${index}: ${problem}`))
const outlined = (session: Session) => outline(threadView(session, AT_PLAY_START)).split('\n').filter(line => !line.startsWith('@ ')).join('\n')

describe('the commands story in the thread view', () => {
  it('outlines the two turns as Hermes stores them after the compression, with no side answer among them', () => {
    expect(want.split('\n')).toEqual([
      '> What does notes.md say about the release?',
      '| notes.md lists three tasks for the release: sketch the chat view, wire the gateway socket and review the screenshots.',
      '✓ Done',
      '',
      '> Then outline docs/plan.md.',
      '| docs/plan.md has two parts: the release date and who signs it off.',
      '✓ Done'
    ])
  })

  it('draws the outline of the direct fold when played through the real client, and is sound at every moment', async () => {
    const seen = await sessions()
    expect(unsound(seen)).toEqual([])
    expect(outlined(seen.at(-1) as Session)).toBe(want)
  })

  it.each(Array.from({ length: pushes }, (_, index) => index + 1))('a drop after push %i, 3 missed, stays sound and ends in the same outline', async afterPush => {
    const seen = await sessions({ drop: { afterPush, missed: 3 } })
    expect(unsound(seen)).toEqual([])
    expect(outlined(seen.at(-1) as Session)).toBe(want)
  })
})
