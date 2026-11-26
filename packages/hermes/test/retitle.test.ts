import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import type { SessionId, SettledTurn, TurnId } from '../src/domain/session'
import { cleanTitle, TITLE_INSTRUCTIONS, titleInput } from '../src/domain/title'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type Fixture, type Oneshot } from '../src/testing/fixture'
import { callsIn, DOWNLOADS, INVOICES, REMINDER, WITH_CHATS } from './support/errand'

const RESEARCH = 'research' as BotId
const turn = (asked: string | null, ...said: string[]): SettledTurn => ({
  id: `t${asked}` as TurnId, request: asked === null ? null : { text: asked, inputId: null, rowId: null, attachments: [] }, began: null, outcome: { kind: 'complete' },
  rows: [], tokens: null, reply: null, items: said.map(markdown => ({ kind: 'text', markdown, sealed: true }))
})

describe('the title Hermes suggested', () => {
  it.each([
    ['Invoices sorted by due date', 'Invoices sorted by due date'],
    ['"Invoices sorted by due date."', 'Invoices sorted by due date'],
    ['Title: “Invoices sorted by due date”', 'Invoices sorted by due date'],
    ['`Title: Invoices sorted`', 'Invoices sorted'],
    ['**Invoices sorted**', 'Invoices sorted'],
    ['# Invoices sorted', 'Invoices sorted'],
    ['\n\n  Invoices sorted  \nHere is why I picked it.', 'Invoices sorted'],
    ["'Plans for v2.0'", 'Plans for v2.0'],
    ['Waiting on Acme...', 'Waiting on Acme...'],
    ['Why "quotes" matter', 'Why "quotes" matter']
  ])('reads %j as %j', (reply, title) => {
    expect(cleanTitle(reply)).toBe(title)
  })

  it('is none when nothing is left', () => {
    expect([cleanTitle(''), cleanTitle('  \n '), cleanTitle('""'), cleanTitle('Title:'), cleanTitle('.')]).toEqual([null, null, null, null, null])
  })

  it('is cut at 80 characters', () => {
    expect(cleanTitle(`${'word '.repeat(30)}`)).toBe('word '.repeat(16).trimEnd())
  })
})

describe('what Hermes reads to suggest a title', () => {
  it("is each turn's message and answer as one line each", () => {
    expect(titleInput([turn('Sort the\ninvoices', 'Sorted fourteen', 'by due date.')])).toBe('User: Sort the invoices\nAssistant: Sorted fourteen by due date.')
  })

  it('is the first turn and the latest three of a longer chat', () => {
    const history = ['one', 'two', 'three', 'four', 'five', 'six'].map(word => turn(word, `${word} done`))
    expect(titleInput(history).split('\n').filter(line => line.startsWith('User:'))).toEqual(['User: one', 'User: four', 'User: five', 'User: six'])
  })

  it('clips each text to 600 characters and the whole to 4000', () => {
    const lines = titleInput(['a', 'b', 'c', 'd'].map(letter => turn(letter.repeat(900), letter.repeat(900)))).split('\n')
    expect(lines.slice(0, -1).map(line => line.length)).toEqual([6 + 600, 11 + 600, 6 + 600, 11 + 600, 6 + 600, 11 + 600])
    expect(lines.join('\n')).toHaveLength(4000)
    expect(lines.at(-1)).toMatch(/…$/)
  })

  it('leaves out a turn with no words, and is empty for a chat with none', () => {
    expect(titleInput([turn(null, 'Hermes restarted.'), turn('hello')])).toBe('Assistant: Hermes restarted.\nUser: hello')
    expect(titleInput([turn(null), turn(' ')])).toBe('')
  })
})

async function launched(oneshot: Oneshot | undefined, more: Partial<Fixture['header']> = {}) {
  const clock = manualClock()
  const script = scriptedDialer({ ...WITH_CHATS, header: { ...WITH_CHATS.header, ...(oneshot === undefined ? {} : { oneshot }), ...more } }, { clock })
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  await hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
  await clock.advance(0)
  const retitle = async (sessionId: SessionId) => {
    const answer = hermes.run({ do: 'retitle', sessionId })
    await clock.advance(5_000)
    return answer
  }
  const calls = (method: string) => callsIn(script.received).filter(call => call.method === method).map(call => call.params)
  return { hermes, retitle, calls, titles: () => hermes.sidebar.get().rows.map(row => row.title) }
}

describe('renaming a chat with AI', () => {
  it("asks the chat's own model for a title from its messages, then saves it as a rename does, for a chat that is not open", async () => {
    const { retitle, calls, titles } = await launched({ text: '"Invoices sorted by due date."\n', delay_ms: 800 })
    expect(await retitle(INVOICES)).toEqual({ ok: true, value: 'Invoices sorted by due date' })
    expect(calls('llm.oneshot')).toEqual([{
      profile: 'research', session_id: INVOICES, instructions: TITLE_INSTRUCTIONS, max_tokens: 40, temperature: 0.3,
      input: 'User: Sort the invoices in the inbox folder by due date.\nAssistant: Sorted fourteen invoices by due date; the oldest is due Friday.'
    }])
    expect(calls('session.mutate')).toMatchObject([{ profile: 'research', session_id: INVOICES, operation: 'rename', payload: { title: 'Invoices sorted by due date' } }])
    expect(titles()).toContain('Invoices sorted by due date')
  })

  it('reads the opening turn of a long chat whose resume left it out', async () => {
    const said = ['one', 'two', 'three', 'four', 'five', 'six'].flatMap(word => [{ role: 'user' as const, text: `ask ${word}` }, { role: 'assistant' as const, text: `did ${word}` }])
    const long = { id: 'local-0110', title: 'Long', last_active: 1795250500, rows: said, shown: 4 }
    const { retitle, calls } = await launched({ text: 'Long chat' }, { chats: { research: [...(WITH_CHATS.header.chats?.research ?? []), long] } })
    expect(await retitle('local-0110' as SessionId)).toEqual({ ok: true, value: 'Long chat' })
    expect(calls('session.transcript')).toMatchObject([{ session_id: 'local-0110', order: 'oldest' }])
    expect(String(calls('llm.oneshot')[0]?.input).split('\n').filter(line => line.startsWith('User:'))).toEqual(['User: ask one', 'User: ask five', 'User: ask six'])
  })

  it('refuses while a reply runs, and asks Hermes nothing', async () => {
    const { retitle, calls } = await launched({ text: 'Reminder' })
    expect(await retitle(REMINDER)).toEqual({ ok: false, refusal: { kind: 'stale', message: 'Wait for the reply to finish, then try again.' } })
    expect(calls('llm.oneshot')).toEqual([])
  })

  it('refuses a chat with no messages, and asks Hermes nothing', async () => {
    const empty = { id: 'local-0109', title: 'Empty', last_active: 1795250500, rows: [] }
    const { retitle, calls } = await launched({ text: 'Empty' }, { chats: { research: [...(WITH_CHATS.header.chats?.research ?? []), empty] } })
    expect(await retitle('local-0109' as SessionId)).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'This chat has no messages to name it from.' } })
    expect(calls('llm.oneshot')).toEqual([])
  })

  it('says a Hermes without the call cannot suggest a title, and renames nothing', async () => {
    const { retitle, calls, titles } = await launched(undefined)
    expect(await retitle(DOWNLOADS)).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't suggest a title." } })
    expect(calls('session.mutate')).toEqual([])
    expect(titles()).toContain('Clean up Downloads')
  })

  it("renames nothing when the model suggests no title, or fails, and says so", async () => {
    expect(await (await launched({ text: '  \n' })).retitle(DOWNLOADS)).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes didn't suggest a title." } })
    const failing = await launched({ error: 'no auxiliary model' })
    expect(await failing.retitle(DOWNLOADS)).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Hermes refused: one-shot generation failed: no auxiliary model' } })
    expect(failing.calls('session.mutate')).toEqual([])
  })
})
