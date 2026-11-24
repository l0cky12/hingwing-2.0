import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Session } from '../src/domain/session'
import { parseRows } from '../src/wire/parse'
import { loadFixture, play, type Moment } from '../src/testing/fixture'
import { callsIn, ERRAND, SESSION } from './support/errand'

const fixture = (name: string) => loadFixture(fileURLToPath(new URL(`../../../fixtures/${name}.jsonl`, import.meta.url)))
const EDIT = fixture('edit')
const REGENERATE = fixture('regenerate')
const REFUSED = fixture('edit-refused')

const requests = (session: Session) => session.history.map(turn => turn.request?.text)
const answers = (session: Session) => session.history.map(turn => turn.items.filter(item => item.kind === 'text').map(item => item.markdown.trim()).join('\n'))

const loadedHistory = (story: typeof EDIT) => parseRows(story.header.stored).turns

async function playAll(story: typeof EDIT) {
  const seen: Session[] = []
  let last: Moment | undefined
  for await (const moment of play(story)) {
    last = moment
    seen.push(moment.session)
  }
  if (last === undefined) throw new Error('the play published no session')
  return { last, seen }
}

describe('editing a sent message through the scripted gateway', () => {
  it('cuts before the edited row, then sends the new text, and leaves no turn after it', async () => {
    const { last } = await playAll(EDIT)
    const calls = callsIn(last.script.received).filter(call => call.method === 'session.mutate' || call.method === 'prompt.submit')
    expect(calls.map(call => call.method)).toEqual(['session.mutate', 'prompt.submit'])
    expect(calls[0]?.params).toMatchObject({ operation: 'rewind', payload: { target_message_id: 3 }, expected_revision: 0, expected_generation: 0 })
    expect(calls[1]?.params).toMatchObject({ session_id: SESSION, text: 'Add a line about the Friday deadline under it' })
    expect(requests(last.session)).toEqual(['Rename the heading in notes.md to Plan', 'Add a line about the Friday deadline under it'])
    expect(answers(last.session).at(-1)).toContain('Due Friday')
    expect(answers(last.session).join('\n')).not.toContain('The folder holds')
    expect(last.session.history.at(-1)?.outcome).toEqual({ kind: 'complete' })
  })

  it('names the new message by the row Hermes stored it in, so it can be edited in turn', async () => {
    const { last } = await playAll(EDIT)
    expect(last.session.history.map(turn => turn.request?.rowId)).toEqual([1, 7])
  })

  it('shows the cut before the new reply arrives', async () => {
    const { seen } = await playAll(EDIT)
    const running = seen.find(session => session.run.state === 'running')
    expect(running && requests(running)).toEqual(['Rename the heading in notes.md to Plan'])
  })
})

describe('regenerating a reply through the scripted gateway', () => {
  it('sends the same text again and replaces the old reply', async () => {
    const { last, seen } = await playAll(REGENERATE)
    const submitted = callsIn(last.script.received).find(call => call.method === 'prompt.submit')
    expect(submitted?.params?.text).toBe('List the folder')
    expect(callsIn(last.script.received).find(call => call.method === 'session.mutate')?.params).toMatchObject({ payload: { target_message_id: 5 } })
    expect(answers(last.session).at(-1)).toContain('Here is the folder')
    expect(answers(last.session).join('\n')).not.toContain('The folder holds')
    expect(seen.some(session => session.history.length === 2 && session.run.state === 'running')).toBe(true)
  })
})

describe('a refused rewind', () => {
  it('sends nothing, changes nothing and says why in words', async () => {
    const answered: unknown[] = []
    let last: Moment | undefined
    for await (const moment of play(REFUSED, { answered: (_, outcome) => answered.push(outcome) })) last = moment
    const { session, script } = last as Moment
    expect(callsIn(script.received).map(call => call.method)).not.toContain('prompt.submit')
    expect(requests(session)).toEqual(['Rename the heading in notes.md to Plan', 'Add a line about the deadline under it', 'List the folder'])
    expect(session.history).toEqual(loadedHistory(REFUSED))
    expect(answered).toEqual([{ ok: false, refusal: { kind: 'rejected', message: 'That message is no longer in this chat.' } }])
  })
})

describe('a rewind while a reply is running', () => {
  it('waits for the reply, sends nothing and leaves the turn running', async () => {
    let outcome: Promise<unknown> | null = null
    let last: Moment | undefined
    for await (const moment of play(ERRAND)) {
      last = moment
      if (outcome === null && moment.session.run.state === 'running') outcome = moment.hermes.run({ do: 'rewind', sessionId: SESSION, rowId: 1, text: 'again' })
    }
    expect(await outcome).toEqual({ ok: false, refusal: { kind: 'stale', message: 'Wait for the reply to finish, then try again.' } })
    expect(callsIn((last as Moment).script.received).map(call => call.method)).not.toContain('session.mutate')
    expect((last as Moment).session.history).toHaveLength(1)
  })
})
