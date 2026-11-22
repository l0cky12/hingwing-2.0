import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Session } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { checkThread, outline, threadView } from '../src/thread-view'

const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/first-live.jsonl', import.meta.url)))
const pushes = fixture.steps.filter(step => 'push' in step).length

const want = [
  '> Reply with the single word: hello',
  "✗ Hermes couldn't sign in to its model provider. Check the provider's key or sign-in in Hermes."
].join('\n')

async function sessions(options?: Parameters<typeof play>[1]): Promise<Session[]> {
  const seen: Session[] = []
  for await (const { session } of play(fixture, options)) seen.push(session)
  return seen
}

function unsound(seen: readonly Session[]): string[] {
  return seen.flatMap((session, index) => checkThread(threadView(session)).map(problem => `moment ${index}: ${problem}`))
}

describe('the first live run, a turn the real gateway failed with auth_permanent, played through the real client', () => {
  it('ends in the request and the plain-words failure line', async () => {
    const seen = await sessions()
    expect(outline(threadView(seen.at(-1) as Session))).toBe(want)
  })

  it('is a sound thread at every moment', async () => {
    expect(unsound(await sessions())).toEqual([])
  })

  it.each(Array.from({ length: pushes }, (_, index) => index + 1))('a drop after push %i with 2 missed ends in the same outline and stays sound', async afterPush => {
    const seen = await sessions({ drop: { afterPush, missed: 2 } })
    expect(unsound(seen)).toEqual([])
    expect(outline(threadView(seen.at(-1) as Session))).toBe(want)
  })
})
