/**
 * The three call sites the design is derived from. This file type-checks against the sketch.
 * The same code is quoted in rationale.md under "Usage".
 */
import { liveDialer, openHermes } from '@highwing/hermes'
import { activityOf, type Link, type PromptId, type PromptReply, type SessionId } from '@highwing/hermes/domain'
import { loadFixture, play, playToEnd, recordingDialer, scriptedDialer } from '@highwing/hermes/testing'
import { checkThread, outline, threadView } from '@highwing/thread'
import { serveWindows, type Bridge } from './apps/desktop/src/ipc-contract'

// 1. Electron main: all of the gateway wiring in the app (apps/desktop/src/main/index.ts).
export function startMain(env: { HIGHWING_FIXTURE?: string; HIGHWING_RECORD?: string }, version: string) {
  const dial = env.HIGHWING_FIXTURE
    ? scriptedDialer(loadFixture(env.HIGHWING_FIXTURE), { timing: 'recorded' })
    : env.HIGHWING_RECORD
      ? recordingDialer(liveDialer(), env.HIGHWING_RECORD)
      : liveDialer()
  const hermes = openHermes({ dial, client: { name: 'highwing', version } })
  serveWindows(hermes)
  // A tray icon later needs no window and no new state. Every running session is attached, so this
  // sees an approval in a chat that no window shows:
  hermes.sidebar.subscribe(sidebar => setTrayIcon(sidebar.rows.some(row => row.badge === 'asking') ? 'asking' : 'idle'))
}

// 2. Renderer: the chat view reads one value and sends commands as data (apps/desktop/src/renderer/chat/).
const { timeZone } = Intl.DateTimeFormat().resolvedOptions()
export function chatView(id: SessionId) {
  const session = useTopic(`session:${id}`)
  if (!session) return { skeleton: true as const }
  return {
    skeleton: false as const,
    thread: threadView(session, { now: Date.now(), timeZone }), // the same call the tests make; settled turns keep their identity
    composer: { canSend: session.sync.state === 'live', showStop: activityOf(session).kind !== 'idle' },
    onSend: (text: string) => highwing.run({ do: 'send', sessionId: id, text }),
    onStop: () => highwing.run({ do: 'stop', sessionId: id }),
    onAnswer: (promptId: PromptId, reply: PromptReply) => highwing.run({ do: 'answer', sessionId: id, promptId, reply })
  }
}

// The connection banner (apps/desktop/src/renderer/chrome/). Start is the only way a dial after launch starts the gateway.
export function banner(link: Link) {
  if (link.state === 'blocked') return { words: link.message, button: 'Retry', onClick: () => highwing.run({ do: 'reconnect', start: false }) }
  if (link.state === 'waiting' && link.why === 'not-running') return { words: link.message, button: 'Start Hermes', onClick: () => highwing.run({ do: 'reconnect', start: true }) }
  if (link.state === 'waiting') return { words: link.message, button: null, onClick: null }
  return null
}

// 3. Tests: design C from an event log, with no provider, no socket and no DOM.
const clock = { now: 0, timeZone: 'UTC' } // the view takes the clock, so a test fixes it
test('a settled errand collapses its runs into named groups', async () => {
  const session = await playToEnd(loadFixture('fixtures/errand.jsonl'))
  expect(outline(threadView(session, clock))).toMatchInlineSnapshot()
})

test('while the listing runs, its row carries the live end', async () => {
  for await (const { session } of play(loadFixture('fixtures/errand.jsonl'))) {
    if (activityOf(session).kind !== 'working') continue
    expect(threadView(session, clock).turns.at(-1)!.end.kind).toBe('at')
  }
})

test('every moment of every fixture is a sound thread', async () => {
  for (const path of ALL_FIXTURES) {
    for await (const { session, step } of play(loadFixture(path))) {
      expect(checkThread(threadView(session, clock)), `${path} step ${step}`).toEqual([])
    }
  }
})

test('a socket drop after any frame ends in the same thread', async () => {
  const fixture = loadFixture('fixtures/errand.jsonl')
  const want = outline(threadView(await playToEnd(fixture), clock))
  const pushes = fixture.steps.filter(step => 'push' in step).length
  for (let afterPush = 1; afterPush <= pushes; afterPush++) {
    const session = await playToEnd(fixture, { drop: { afterPush, missed: 3 } })
    expect(outline(threadView(session, clock)), `drop after push ${afterPush}`).toBe(want)
  }
})

declare const highwing: Bridge
declare function useTopic<T extends import('./apps/desktop/src/ipc-contract').Topic>(topic: T): import('./apps/desktop/src/ipc-contract').TopicValue<T> | undefined
declare function setTrayIcon(state: 'idle' | 'asking'): void
declare const ALL_FIXTURES: readonly string[]
declare function test(name: string, run: () => Promise<void>): void
declare function expect(value: unknown, hint?: string): { toBe(v: unknown): void; toEqual(v: unknown): void; toMatchInlineSnapshot(s?: string): void }
