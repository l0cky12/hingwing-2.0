import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ModelConfirm, Outcome } from '../src/domain/command'
import { activityOf } from '../src/domain/reduce'
import type { ModelOption, Session } from '../src/domain/session'
import type { Hermes } from '../src/hub'
import { play, type Fixture, type Moment } from '../src/testing/fixture'
import { callsIn, ERRAND, SESSION } from './support/errand'

const reply = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../fixtures/models/${name}.json`, import.meta.url)), 'utf8'))
const withModels = (models: unknown): Fixture => ({ ...ERRAND, header: { ...ERRAND.header, models } })
const THREE = withModels(reply('three'))
const CAREFUL = { id: 'careful-large', provider: 'acme', providerName: 'Acme' } as ModelOption
const LOCAL = { id: 'local-7b', provider: 'local', providerName: 'Local' } as ModelOption

const pick = (hermes: Hermes, model: ModelOption = CAREFUL) => hermes.run({ do: 'pickModel', sessionId: SESSION, model })
const switches = (moment: Moment) => callsIn(moment.script.received).filter(call => call.method === 'session.mutate' && call.params?.operation === 'model')
const outline = (session: Session) => session.history.map(turn => [turn.outcome.kind, turn.items.length])

async function playWith<T>(fixture: Fixture, at: (moment: Moment) => Promise<T> | null): Promise<{ last: Moment; result: Promise<T> | null }> {
  let last: Moment | undefined
  let result: Promise<T> | null = null
  for await (const moment of play(fixture)) {
    last = moment
    result ??= at(moment)
  }
  if (last === undefined) throw new Error('the play published no session')
  return { last, result }
}

describe('choosing a chat\'s model through the scripted gateway', () => {
  it('lists what the fixture offers, with the model Hermes names for the chat', async () => {
    const { last, result } = await playWith(THREE, ({ hermes, session }) =>
      session.sync.state === 'live' ? hermes.run({ do: 'models', sessionId: SESSION }) : null)
    expect(await result).toEqual({
      ok: true,
      value: {
        options: [
          { id: 'fast-small', provider: 'acme', providerName: 'Acme' },
          { id: 'careful-large', provider: 'acme', providerName: 'Acme' },
          { id: 'local-7b', provider: 'local', providerName: 'Local' }
        ],
        fallback: { id: 'fast-small', provider: 'acme' }
      }
    })
    expect(last.session.model.current).toMatchObject({ id: 'fast-small' })
  })

  it('switches an idle chat with one session.mutate and learns the new model from the stream', async () => {
    const { last, result } = await playWith(THREE, ({ hermes, session }) =>
      session.sync.state === 'live' && session.run.state === 'idle' && session.history.length === 0 ? pick(hermes) : null)
    expect(await result).toEqual<Outcome<ModelConfirm | null>>({ ok: true, value: null })
    expect(switches(last)).toEqual([expect.objectContaining({ params: expect.objectContaining({ payload: { model: 'careful-large', provider: 'acme' }, expected_generation: 0 }) })])
    expect(last.session.model).toEqual({ current: { id: 'careful-large', provider: 'acme' }, next: null, ask: null })
    expect(outline(last.session)).toEqual([['complete', 8]])
  })

  it('holds a pick made during a turn until it ends, without interrupting it', async () => {
    const { last, result } = await playWith(THREE, ({ hermes, session }) => (activityOf(session).kind === 'asking' ? pick(hermes) : null))
    expect(await result).toEqual({ ok: true, value: null })
    expect(callsIn(last.script.received).map(call => call.method)).not.toContain('session.interrupt')
    expect(last.session.history.at(-1)?.outcome).toEqual({ kind: 'complete' })
    expect(last.session.model).toEqual({ current: { id: 'careful-large', provider: 'acme' }, next: null, ask: null })
  })

  it('shows the held pick while the turn runs', async () => {
    let asked = false
    const seen: Session[] = []
    for await (const { hermes, session } of play(THREE)) {
      if (!asked && activityOf(session).kind === 'asking') {
        asked = true
        await pick(hermes)
      }
      if (asked) seen.push(session)
    }
    const waiting = seen.find(session => session.model.next !== null)
    expect(waiting?.run.state).toBe('running')
    expect(waiting?.model.next).toMatchObject({ model: { id: 'careful-large' } })
  })

  it('switches twice in a row, following the generation each switch moves to', async () => {
    const { last, result } = await playWith(THREE, ({ hermes, session }) =>
      session.sync.state === 'live' && session.history.length === 0 && session.run.state === 'idle'
        ? pick(hermes).then(() => pick(hermes, LOCAL))
        : null)
    expect(await result).toEqual({ ok: true, value: null })
    expect(switches(last).map(call => call.params?.expected_generation)).toEqual([0, 1])
    expect(last.session.model.current).toMatchObject({ id: 'local-7b' })
  })

  it('asks before a guarded switch, and switches once the yes comes back with its token', async () => {
    const guarded: Fixture = { ...THREE, header: { ...THREE.header, guarded: ['careful-large'] } }
    const { last, result } = await playWith(guarded, ({ hermes, session }) => {
      if (session.sync.state !== 'live' || session.run.state !== 'idle' || session.history.length > 0) return null
      return pick(hermes).then(async asked => {
        if (!asked.ok || asked.value === null) throw new Error(`expected a confirmation, got ${JSON.stringify(asked)}`)
        const confirmed = await hermes.run({ do: 'pickModel', sessionId: SESSION, model: CAREFUL, confirm: asked.value.token })
        return { asked, confirmed }
      })
    })
    const { asked, confirmed } = (await result)!
    expect(asked).toEqual({ ok: true, value: { token: 'confirm-careful-large', message: 'careful-large costs more per message.' } })
    expect(confirmed).toEqual({ ok: true, value: null })
    expect(last.session.model.current).toMatchObject({ id: 'careful-large' })
  })

  it('asks for a guarded pick held during a turn when the turn ends, instead of dropping it', async () => {
    const guarded: Fixture = { ...THREE, header: { ...THREE.header, guarded: ['careful-large'] } }
    const { last } = await playWith(guarded, ({ hermes, session }) => (activityOf(session).kind === 'asking' ? pick(hermes) : null))
    expect(last.session.model).toEqual({
      current: { id: 'fast-small', provider: 'acme' },
      next: { model: { id: 'careful-large', provider: 'acme' }, during: 1 },
      ask: { model: { id: 'careful-large', provider: 'acme' }, token: 'confirm-careful-large', message: 'careful-large costs more per message.' }
    })
    expect(last.session.history.at(-1)?.outcome).toEqual({ kind: 'complete' })
  })

  it('refuses a model the chat does not offer and switches nothing', async () => {
    const unknown = { id: 'made-up', provider: 'acme', providerName: 'Acme' } as ModelOption
    const { last, result } = await playWith(THREE, ({ hermes, session }) => (session.sync.state === 'live' ? pick(hermes, unknown) : null))
    expect(await result).toMatchObject({ ok: false, refusal: { kind: 'rejected' } })
    expect(last.session.model.current).toMatchObject({ id: 'fast-small' })
  })

  it('treats a Hermes that does not list its models as unsupported and plays the errand to its end', async () => {
    const { last, result } = await playWith(ERRAND, ({ hermes, session }) =>
      session.sync.state === 'live' ? hermes.run({ do: 'models', sessionId: SESSION }) : null)
    expect(await result).toMatchObject({ ok: false, refusal: { kind: 'unsupported' } })
    expect(last.script.finished).toBe(true)
    expect(last.session.model).toEqual({ current: null, next: null, ask: null })
  })

  it.each([1, 5, 6, 20, 38])('keeps one consistent stream when a pick commits after moment %i', async index => {
    let count = 0
    const { last, result } = await playWith(THREE, ({ hermes }) => (++count === index ? pick(hermes) : null))
    expect((await result)?.ok).toBe(true)
    expect(last.session.sync.state).toBe('live')
    expect(last.script.dials).toBe(1)
    expect(outline(last.session)).toEqual([['complete', 8]])
    expect(last.session.model.current).toMatchObject({ id: 'careful-large' })
  })
})
