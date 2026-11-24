import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { activityOf } from '../src/domain/reduce'
import type { Item, Session } from '../src/domain/session'
import { loadFixture, MASKED, play, playToEnd, type FixtureStep, type Moment } from '../src/testing/fixture'
import { asks, fold, ignoringClocks } from './support/story'

const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/asks.jsonl', import.meta.url)))
const want = fold(asks()).content
const LIVE: Session = { ...want, sync: { state: 'live' } }
const pushes = fixture.steps.filter(step => 'push' in step)
const requestOf = (step: FixtureStep) => ('push' in step ? step.push as { id?: string; method: string } : null)
const idOf = (method: string, nth = 0) => pushes.map(requestOf).filter(push => push?.method === method)[nth]?.id as string
const SUDO = idOf('sudo')
const CODE = idOf('vault.code')
const PICK = idOf('theme.pick')
const CHOICE = idOf('clarify', 1)

async function moments(options?: Parameters<typeof play>[1]): Promise<Moment[]> {
  const seen: Moment[] = []
  for await (const moment of play(fixture, options)) seen.push(moment)
  return seen
}

const closedIn = (items: readonly Item[]) => items.flatMap(item => (item.kind === 'notice' && item.what === 'closed' ? [`${item.asked}: ${item.end}`] : []))
const answersTo = (moment: Moment, id: string) => moment.script.received.filter(frame => (frame as { id?: unknown }).id === id)
const callsOf = (moment: Moment, method: string) => moment.script.received.flatMap(frame => {
  const sent = frame as { method?: string; params?: unknown }
  return sent.method === method ? [sent.params] : []
})

describe('what Hermes asks, from its own request paths', () => {
  it('folds to one settled turn that says how each request closed, then the plugin choice in the interlude, with nothing left waiting', () => {
    expect(want.run).toEqual({ state: 'idle' })
    expect(want.requests).toEqual([])
    expect(want.history).toHaveLength(1)
    expect(closedIn(want.history[0]!.items)).toEqual(['sudo: answered', 'env: skipped', 'code: elsewhere', 'questions: answered', 'connect: done'])
    expect(want.history[0]!.items.filter(item => item.kind === 'notice' && item.what === 'declined')).toEqual([{ kind: 'notice', what: 'declined', requestId: PICK, method: 'theme.pick' }])
    expect(want.interlude).toEqual([{ kind: 'notice', what: 'closed', requestId: CHOICE, asked: 'questions', end: 'answered' }])
  })

  it('records the typed password masked, and every other answer as it was sent', () => {
    expect(fixture.steps.flatMap(step => ('answer' in step ? [step] : []))).toMatchObject([
      { answer: SUDO, result: { value: MASKED } }, { answer: idOf('secret'), result: { value: '' } }, { answer: PICK, error: { code: -32601 } }
    ])
  })
})

describe('the asks story, played through the real client', () => {
  it('ends in the session the direct fold gives', async () => {
    expect(ignoringClocks(await playToEnd(fixture))).toEqual(ignoringClocks(LIVE))
  })

  it('holds each request while Hermes waits on it, counts the masked ones down, and never opens a turn for the plugin choice', async () => {
    const seen = await moments()
    const held = (id: string) => seen.find(moment => moment.session.requests.some(request => request.id === id))?.session.requests.find(request => request.id === id)
    expect(held(SUDO)).toMatchObject({ ask: { kind: 'secret', for: { is: 'sudo', command: 'sudo apt-get install -y jq' } }, state: { s: 'waiting', error: null }, deadline: expect.any(Number) })
    expect(held(idOf('secret'))).toMatchObject({ ask: { for: { is: 'env', name: 'TENOR_API_KEY', prompt: 'Tenor API key' } } })
    expect(held(CODE)).toMatchObject({ ask: { for: { is: 'code', site: 'example.com' } }, deadline: expect.any(Number) })
    expect(held(idOf('clarify'))).toMatchObject({ ask: { kind: 'questions', questions: [{ id: 'q0', multi: false }, { id: 'q1', multi: true, choices: ['eu-west (Recommended)', 'us-east', 'ap-south'] }] }, deadline: null })
    const choosing = seen.filter(moment => moment.session.requests.some(request => request.id === CHOICE))
    expect(choosing.length).toBeGreaterThan(0)
    expect(choosing.every(moment => moment.session.run.state === 'idle' && activityOf(moment.session).kind === 'answering')).toBe(true)
  })

  it('shows the connector card with its sign-in link, then the skipped target, until Hermes settles it', async () => {
    const seen = await moments()
    const cards = seen.flatMap(moment => moment.session.requests.flatMap(request => (request.ask.kind === 'connect' ? [request.ask] : [])))
    expect(cards[0]).toMatchObject({ rev: 0, targets: [{ name: 'github', kind: 'connector', state: 'pending', url: 'https://example.com/connect/github', resolved: false }] })
    expect(cards.at(-1)).toMatchObject({ rev: 1, targets: [{ state: 'skipped', resolved: true }] })
  })

  it('answers the password with a result frame, both batches with clarify.lock, the card with connection.respond, and declines only the window request', async () => {
    const last = (await moments()).at(-1)!
    expect(answersTo(last, SUDO)).toEqual([{ jsonrpc: '2.0', id: SUDO, result: { value: expect.any(String) } }])
    expect(answersTo(last, idOf('secret'))).toEqual([{ jsonrpc: '2.0', id: idOf('secret'), result: { value: '' } }])
    expect(answersTo(last, CODE), 'another viewer answered the code').toEqual([])
    expect(answersTo(last, PICK)).toMatchObject([{ error: { code: -32601 } }])
    expect(callsOf(last, 'clarify.lock')).toEqual(fixture.steps.flatMap(step => ('await' in step && step.await === 'clarify.lock' ? [step.params] : [])))
    expect(callsOf(last, 'connection.respond')).toEqual(fixture.steps.flatMap(step => ('await' in step && step.await === 'connection.respond' ? [step.params] : [])))
    expect(callsOf(last, 'prompt.submit')).toMatchObject([{ clarify_batch: true }])
  })

  it('never publishes what the stand-in user typed', async () => {
    const seen = await moments()
    const typed = (answersTo(seen.at(-1)!, SUDO)[0] as { result: { value: string } }).result.value
    expect(typed).not.toBe(MASKED)
    expect(JSON.stringify(seen.map(moment => moment.session))).not.toContain(typed)
  })
})

describe('a socket drop after every push of the asks story', () => {
  /** A request another viewer answered while this client was away was never shown here, so it leaves no notice. */
  const seenHere = (session: Session): Session => ({
    ...session,
    history: session.history.map(turn => ({ ...turn, items: turn.items.filter(item => !(item.kind === 'notice' && item.what === 'closed' && item.requestId === CODE)) }))
  })

  it.each(Array.from({ length: pushes.length }, (_, index) => index + 1))('drop after push %i, 3 missed, ends in the undisturbed session', async afterPush => {
    const seen = await moments({ drop: { afterPush, missed: 3 } })
    expect(seen.at(-1)!.script.dials).toBe(2)
    expect(seen.map(moment => moment.session.sync.state)).not.toContain('rebuilding')
    expect(ignoringClocks(seenHere(seen.at(-1)!.session))).toEqual(ignoringClocks(seenHere(LIVE)))
  })

  it('leaves no notice for the code another viewer entered while the socket was down, and keeps the one for a code it saw', async () => {
    const asked = pushes.findIndex(push => requestOf(push)?.id === CODE)
    const away = (await moments({ drop: { afterPush: asked, missed: 3 } })).at(-1)!.session
    const here = (await moments({ drop: { afterPush: asked + 1, missed: 3 } })).at(-1)!.session
    expect(closedIn(away.history[0]!.items)).not.toContain('code: elsewhere')
    expect(closedIn(here.history[0]!.items)).toContain('code: elsewhere')
  })

  it('rebuilds from the stored rows when the ring is too small, and still holds the request Hermes lists as open', async () => {
    const asked = pushes.findIndex(push => requestOf(push)?.id === SUDO)
    const seen = await moments({ drop: { afterPush: asked - 2, missed: 4 }, ringFrames: 1 })
    expect(seen.map(moment => moment.session.sync.state)).toContain('rebuilding')
    const rebuilt = seen.find(moment => moment.session.sync.state === 'live' && moment.session.requests.length > 0)
    expect(rebuilt?.session.requests).toMatchObject([{ id: SUDO, state: { s: 'waiting' }, deadline: null }])
    expect(seen.at(-1)!.session.requests).toEqual([])
  })
})
