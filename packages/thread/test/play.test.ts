import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Session } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { sessionOf } from '../../hermes/src/domain/reduce'
import { errand, fold } from '../../hermes/test/support/story'
import { checkThread, outline, threadView } from '../src/thread-view'

const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/errand.jsonl', import.meta.url)))
const pushes = fixture.steps.filter(step => 'push' in step).length
const want = outline(threadView(sessionOf(fold(errand()), { state: 'online' }, null)))

async function sessions(options?: Parameters<typeof play>[1]): Promise<Session[]> {
  const seen: Session[] = []
  for await (const { session } of play(fixture, options)) seen.push(session)
  return seen
}

function unsound(seen: readonly Session[]): string[] {
  return seen.flatMap((session, index) => checkThread(threadView(session)).map(problem => `moment ${index}: ${problem}`))
}

describe('design C from the errand played through the real client', () => {
  it('draws the outline of the direct fold, which the settled-C golden pins', async () => {
    const seen = await sessions()
    expect(outline(threadView(seen.at(-1) as Session))).toBe(want)
    expect(want.split('\n').at(-1)).toBe('✓ Done')
  })

  it('is a sound thread at every moment', async () => {
    expect(unsound(await sessions())).toEqual([])
  })

  it.each(Array.from({ length: pushes }, (_, index) => index + 1))('a drop after push %i, 3 missed, ends in the same outline and stays sound', async afterPush => {
    const seen = await sessions({ drop: { afterPush, missed: 3 } })
    expect(unsound(seen)).toEqual([])
    expect(outline(threadView(seen.at(-1) as Session))).toBe(want)
  })

  it('a ring too small for the gap rebuilds into a sound, settled thread', async () => {
    const seen = await sessions({ drop: { afterPush: 12, missed: 6 }, ringFrames: 2 })
    expect(unsound(seen)).toEqual([])
    const rebuilt = outline(threadView(seen.at(-1) as Session))
    expect(rebuilt.split('\n')[0]).toBe(want.split('\n')[0])
    expect(rebuilt.split('\n').at(-1)).toBe('✓ Done')
  })
})
