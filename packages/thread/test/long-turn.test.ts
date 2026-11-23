import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { activityOf, type Session } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { checkThread, threadView } from '../src/thread-view'

const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/long-turn.jsonl', import.meta.url)))

async function sessions(): Promise<Session[]> {
  const seen: Session[] = []
  for await (const { session } of play(fixture)) seen.push(session)
  return seen
}

describe('the long turn played through the real client', () => {
  it('is a sound thread at every moment', async () => {
    const seen = await sessions()
    expect(seen.flatMap((session, index) => checkThread(threadView(session)).map(problem => `moment ${index}: ${problem}`))).toEqual([])
  })

  it('ends waiting on the delete, with the approval card as the live end', async () => {
    const last = (await sessions()).at(-1) as Session
    expect(activityOf(last).kind).toBe('asking')
    const turn = threadView(last).turns.at(-1)
    const end = turn?.end
    expect(end).toMatchObject({ kind: 'at', tone: 'asking' })
    const card = turn?.nodes.find(node => end?.kind === 'at' && node.key === end.nodeKey)
    expect(card).toMatchObject({ kind: 'prompt', card: { state: 'asking', command: 'rm -rf /tmp/hermes-proto-work/app/build' } })
    expect(turn?.nodes.at(-1)).toBe(card)
  })
})
