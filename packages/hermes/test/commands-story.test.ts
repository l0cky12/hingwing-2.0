import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CommandOutcome, Session } from '../src/domain'
import { loadFixture, play, type Moment } from '../src/testing/fixture'
import { commands, fold, ignoringClocks } from './support/story'

const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/commands.jsonl', import.meta.url)))
const want = fold(commands()).content
const pushes = fixture.steps.filter(step => 'push' in step).length
const calls = fixture.steps.flatMap(step => ('await' in step ? [step] : []))
const paramsOf = (method: string) => calls.filter(step => step.await === method).map(step => step.params as Record<string, unknown>)
const comparable = (session: Session | typeof want) => ignoringClocks({ ...session, tuning: { ...session.tuning, reasoning: null, busy: null }, sync: null })
const WORK = '/tmp/hermes-proto-work'

interface Played { readonly seen: readonly Moment[]; readonly outcomes: readonly (readonly [string, CommandOutcome<unknown>])[] }

async function played(options?: Parameters<typeof play>[1]): Promise<Played> {
  const seen: Moment[] = []
  const outcomes: [string, CommandOutcome<unknown>][] = []
  for await (const moment of play(fixture, { ...options, answered: (command, outcome) => outcomes.push([command.do, outcome]) })) seen.push(moment)
  return { seen, outcomes }
}

const sentBy = (moment: Moment, method: string) => moment.script.received.flatMap(frame => {
  const sent = frame as { method?: string; params?: unknown }
  return sent.method === method ? [sent.params] : []
})
const minted = (params: unknown) => Object.fromEntries(Object.entries(params as Record<string, unknown>).filter(([key]) => key !== 'request_id' && key !== 'input_id'))

describe('the chat commands, from Hermes\'s own gateway', () => {
  it('folds to the two turns, the answered side tasks, and the switches and folder Hermes said last', () => {
    expect(want.history.map(turn => [turn.request?.text, turn.outcome.kind])).toEqual([
      ['What does notes.md say about the release?', 'complete'], ['Then outline docs/plan.md.', 'complete']
    ])
    expect(want.sides).toEqual([
      { id: expect.stringMatching(/^btw_/), kind: 'btw', asked: 'Which file holds the plan?', state: { s: 'done', text: 'The plan is in docs/plan.md.' } },
      { id: expect.stringMatching(/^bg_/), kind: 'background', asked: 'Draft a changelog entry for the notes.', state: { s: 'done', text: expect.stringMatching(/^Changelog: /) } }
    ])
    // The move's session.info reads the tier of the frozen policy, not the chat's /fast pin, so it says fast is off (gateway/session_local.py:467-477,543).
    expect(want.tuning).toMatchObject({ effort: 'high', fast: false, yolo: true })
    expect(want.cwd).toBe(`${WORK}/docs`)
  })

  it('records the closed key set of every call, and what Hermes answered', () => {
    expect(fixture.header.paths?.words['@no']).toEqual({ items: [{ text: '@file:notes.md', display: 'notes.md', meta: '' }] })
    expect(paramsOf('prompt.btw').map(Object.keys)).toEqual([['session_id', 'text']])
    expect(paramsOf('session.mutate').map(params => [params.operation, params.payload])).toEqual([
      ['compress', { focus: 'the release plan' }], ['reasoning', { effort: 'high' }], ['workspace', { cwd: `${WORK}/docs` }]
    ])
    expect(paramsOf('config.set').map(params => [params.key, params.value])).toEqual([['yolo', 'on'], ['fast', 'fast']])
    expect(calls.find(step => step.await === 'session.export')?.reply).toMatchObject({ format: 'md', filename: expect.stringMatching(/\.md$/) })
  })
})

describe('the commands story, played through the real client', () => {
  it('ends in the session the direct fold gives', async () => {
    const { seen } = await played()
    expect(comparable(seen.at(-1)!.session)).toEqual(comparable(want))
  })

  it('makes each call as Hermes recorded it, from the typed /btw, /bg and /compress lines and the commands', async () => {
    const last = (await played()).seen.at(-1)!
    for (const method of ['prompt.btw', 'prompt.background', 'session.mutate', 'config.set', 'session.export']) {
      expect(sentBy(last, method).map(minted), method).toEqual(paramsOf(method).map(minted))
    }
  })

  it('answers each command, with the export and the compression report', async () => {
    const { outcomes } = await played()
    expect(outcomes.every(([, outcome]) => outcome.ok)).toBe(true)
    expect(outcomes.find(([command]) => command === 'export')?.[1]).toMatchObject({ ok: true, value: { filename: expect.stringMatching(/\.md$/), content: expect.stringContaining('notes.md') } })
    expect(outcomes.filter(([command]) => command === 'send').at(-1)?.[1]).toEqual({ ok: true, value: expect.stringMatching(/^Compressed: 4 → 3 messages/) })
  })

  it('starts from the switches the attach reply says, takes each as Hermes says it, and moves the folder', async () => {
    const { seen } = await played()
    const live = seen.find(moment => moment.session.sync.state === 'live')!.session
    expect(live.tuning).toMatchObject({ effort: 'default', fast: false, yolo: false })
    expect(live.cwd).toBe(WORK)
    const settings = seen.map(moment => [moment.session.tuning.effort, moment.session.tuning.fast, moment.session.tuning.yolo, moment.session.cwd])
      .filter((said, index, all) => JSON.stringify(said) !== JSON.stringify(all[index - 1]))
    expect(settings).toEqual([
      [null, null, null, null], ['default', false, false, WORK], ['default', false, true, WORK], ['high', false, true, WORK], ['high', true, true, WORK], ['high', false, true, `${WORK}/docs`]
    ])
  })

  it('holds each side task running until its answer', async () => {
    const { seen } = await played()
    const states = seen.map(moment => moment.session.sides.map(side => `${side.kind}:${side.state.s}`).join(' '))
      .filter((said, index, all) => said !== all[index - 1])
    expect(states).toEqual(['', 'btw:running', 'btw:done', 'btw:done background:running', 'btw:done background:done'])
  })

  it('reads the chat again once the compression is committed, and goes on from the fences its receipt names', async () => {
    const { seen } = await played()
    const rebuilt = seen.filter(moment => moment.session.sync.state === 'rebuilding').map(moment => moment.session)
    expect(rebuilt.length).toBeGreaterThan(0)
    expect(rebuilt.every(session => session.tuning.yolo === true && session.tuning.effort === 'default'), 'after the YOLO set, before the effort').toBe(true)
    expect(sentBy(seen.at(-1)!, 'session.resume')).toHaveLength(2)
    expect(seen.at(-1)!.session.sync.state).toBe('live')
  })
})

describe('a socket drop after every push of the commands story', () => {
  it.each(Array.from({ length: pushes }, (_, index) => index + 1))('drop after push %i, 3 missed, ends in the undisturbed session', async afterPush => {
    const { seen } = await played({ drop: { afterPush, missed: 3 } })
    expect(seen.at(-1)!.script.dials).toBe(2)
    expect(comparable(seen.at(-1)!.session)).toEqual(comparable(want))
  })
})
