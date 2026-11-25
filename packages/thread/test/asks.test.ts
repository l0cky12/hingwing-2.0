import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Session } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { sessionOf } from '../../hermes/src/domain/reduce'
import { asks, fold } from '../../hermes/test/support/story'
import { findInThread } from '../src/find'
import { checkThread, outline, threadView } from '../src/thread-view'

const AT_PLAY_START = { now: 0, timeZone: 'UTC' }
const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/asks.jsonl', import.meta.url)))
const pushes = fixture.steps.filter(step => 'push' in step).length
const want = outline(threadView(sessionOf(fold(asks()), { state: 'online' }, null), AT_PLAY_START))
const ANSWERED_ELSEWHERE = '○ Answered from another window.'

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
      '○ You sent a password.',
      '| Now the gif. The gif-search skill needs a Tenor key.',
      '● Used `skill_view`  1.6 s',
      '○ You skipped this.',
      "| No key, so I'll skip the gif. Signing in to example.com.",
      '● Used `browser_navigate`  3.3 s',
      ANSWERED_ELSEWHERE,
      "| You're signed in. Before I deploy, two questions.",
      '● Used `clarify`  3.3 s',
      '○ You sent your answers.',
      '| Production in two regions. The deploy needs GitHub connected.',
      '● Used `manage_connections`  1.6 s',
      '○ Hermes went on with what is connected.',
      "| Skipped, so I'll deploy from the local checkout. Offering an accent colour while it runs.",
      '● Used `set_theme`  1.5 s',
      "! Hermes sent a request Highwing can't show yet (theme.pick), so it said no.",
      '| Done. jq is installed, the gif was skipped for want of a Tenor key, and the notes site is deployed to production.',
      '✓ Done',
      '',
      '○ You sent your answers.'
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

describe('a password typed into the sudo card', () => {
  const SUDO_REQUEST = 'srq-6744c1d7ac7f'
  const TENOR_REQUEST = 'srq-32cfb2b5711d'
  const answersTo = (id: string, frames: readonly unknown[]) =>
    frames.flatMap(frame => (typeof frame === 'object' && frame !== null && 'result' in frame && (frame as { id?: unknown }).id === id ? [(frame as { result: unknown }).result] : []))

  it('reaches the gateway once, as the value alone, and is in no session, no view, no find match and no recorded frame', async () => {
    const recorded = join(mkdtempSync(join(tmpdir(), 'highwing-typed-')), 'asks.jsonl')
    const sessionsSeen: string[] = []
    const viewsSeen: string[] = []
    const found: number[] = []
    let received: readonly unknown[] = []
    for await (const { session, script } of play(fixture, { typed: 'hunter2', record: recorded })) {
      const view = threadView(session, AT_PLAY_START)
      sessionsSeen.push(JSON.stringify(session))
      viewsSeen.push(JSON.stringify(view), outline(view))
      found.push(findInThread(view, 'hunter2').length)
      received = script.received
    }
    expect(answersTo(SUDO_REQUEST, received)).toEqual([{ value: 'hunter2' }])
    expect(answersTo(TENOR_REQUEST, received)).toEqual([{ value: '' }])
    expect(sessionsSeen.length).toBeGreaterThan(1)
    expect(sessionsSeen.filter(held => held.includes('hunter2'))).toEqual([])
    expect(viewsSeen.filter(held => held.includes('hunter2'))).toEqual([])
    expect(found.filter(count => count > 0)).toEqual([])
    const frames = readFileSync(recorded, 'utf8')
    expect(frames).toContain(`"answer":"${SUDO_REQUEST}","result":{"value":"•••"}`)
    expect(frames).not.toContain('hunter2')
  })

  it('shows its card while the answer is waited on and its words once Hermes closes it', async () => {
    const outlines: string[] = []
    for await (const { session } of play(fixture, { typed: 'hunter2' })) outlines.push(outline(threadView(session, AT_PLAY_START)))
    expect(outlines.some(held => held.includes('◈ Hermes needs your sudo password'))).toBe(true)
    expect(outlines.some(held => held.includes('◈ Hermes needs a secret'))).toBe(true)
    expect(outlines.at(-1)).not.toContain('◈')
  })
})
