import type { HermesRequest, RequestAsk, RequestId, RequestReply, Session } from '@highwing/hermes/domain'
import { drawnQuestions, threadView, type QuestionsCard } from '@highwing/thread'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AskCard } from '../src/renderer/chat/Asks'
import { answerOf, draftOf, lockAnswer, OTHER, picked, sendWords } from '../src/renderer/chat/questions'

const CLOCK = { now: 0, timeZone: 'UTC' }

const WHERE = { id: 'q0', text: 'Which environment should I deploy to?', choices: ['staging (Recommended)', 'production'], multi: false }
const REGIONS = { id: 'q1', text: 'Which regions?', choices: ['eu-west (Recommended)', 'us-east', 'ap-south'], multi: true }
const TYPED = { id: 'q2', text: 'Anything else?', choices: [], multi: false }
const TYPED_QUESTION = { ...TYPED, locked: null }

function cardOf(ask: Extract<RequestAsk, { kind: 'questions' }>, state: HermesRequest['state'] = { s: 'waiting', error: null }, sync: Session['sync'] = { state: 'live' }): QuestionsCard {
  const request: HermesRequest = { id: 'srq-batch' as RequestId, ask, state, deadline: null }
  const session: Session = {
    id: 's1' as Session['id'], title: '', cwd: null, history: [], earlier: 'none', run: { state: 'idle' }, interlude: [], requests: [request], queue: [], outbox: [],
    model: { current: null, next: null, ask: null }, usage: { totals: null, context: null }, tuning: { reasoning: null, busy: null, effort: null, fast: null, yolo: null, approvals: null }, sides: [], processes: null, control: null, sync
  }
  const [card] = threadView(session, CLOCK).asks
  if (card?.kind !== 'questions') throw new Error('no questions card')
  return card
}

const batch = (answers: Extract<RequestAsk, { kind: 'questions' }>['answers'] = {}) => cardOf({ kind: 'questions', questions: [WHERE, REGIONS], answers })
const question = (card: QuestionsCard, id: string) => card.questions.find(asked => asked.id === id)!
const drawn = (card: QuestionsCard, changing: string | null = null) => renderToStaticMarkup(<AskCard card={card} changing={changing} onChange={() => {}} onAnswer={async () => true} />)
const buttons = (markup: string) => Array.from(markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g), ([, attributes, name]) => `${name}${attributes?.includes('disabled') ? ' (off)' : ''}`)

describe('which question is open', () => {
  const openOf = (card: QuestionsCard, changing: string | null) => drawnQuestions(card, changing).open?.question.id

  it('is the first one not answered, or a locked one being changed', () => {
    const card = batch({ q0: ['production'] })
    expect(openOf(card, null)).toBe('q1')
    expect(openOf(card, 'q0')).toBe('q0')
    expect(openOf(batch(), 'q1')).toBe('q0')
  })

  it('is none once every question is locked', () => {
    expect(openOf(batch({ q0: ['production'], q1: null }), null)).toBeUndefined()
  })
})

describe('the answer being picked', () => {
  it('starts empty, or from the locked answer when it is changed, a typed line under Other', () => {
    expect(draftOf(question(batch(), 'q0'))).toEqual({ picks: [], other: null })
    expect(draftOf(question(batch({ q0: ['production'] }), 'q0'))).toEqual({ picks: ['production'], other: null })
    expect(draftOf(question(batch({ q0: ['canary'] }), 'q0'))).toEqual({ picks: [], other: 'canary' })
    expect(draftOf(TYPED_QUESTION)).toEqual({ picks: [], other: '' })
  })

  it('picks one label on a single pick, Other clearing it', () => {
    const where = question(batch(), 'q0')
    const staging = picked(where, draftOf(where), 'staging (Recommended)', true)
    expect(staging).toEqual({ picks: ['staging (Recommended)'], other: null })
    expect(picked(where, staging, 'production', true)).toEqual({ picks: ['production'], other: null })
    expect(picked(where, staging, OTHER, true)).toEqual({ picks: [], other: '' })
  })

  it('picks several labels on a multi pick, in the order Hermes listed them, and Other adds a typed line', () => {
    const regions = question(batch(), 'q1')
    const two = picked(regions, picked(regions, draftOf(regions), 'us-east', true), 'eu-west (Recommended)', true)
    expect(two).toEqual({ picks: ['eu-west (Recommended)', 'us-east'], other: null })
    expect(answerOf({ ...picked(regions, two, OTHER, true), other: ' sa-east ' })).toEqual(['eu-west (Recommended)', 'us-east', 'sa-east'])
    expect(picked(regions, two, 'us-east', false).picks).toEqual(['eu-west (Recommended)'])
  })

  it('sends the labels exactly as Hermes sent them, and nothing until something is picked or typed', () => {
    expect(answerOf({ picks: ['staging (Recommended)'], other: null })).toEqual(['staging (Recommended)'])
    expect(answerOf({ picks: [], other: null })).toBeNull()
    expect(answerOf({ picks: [], other: '  ' })).toBeNull()
  })
})

describe('the button of the open question', () => {
  it('reads Next while another question is open, and Send answers on the last one, which holds its answer until pressed', () => {
    expect(sendWords(batch(), question(batch(), 'q0'))).toBe('Next')
    const last = batch({ q0: ['production'] })
    expect(sendWords(last, question(last, 'q1'))).toBe('Send answers')
    expect(sendWords(last, question(last, 'q0'))).toBe('Next')
  })

  it('reads Send answer for a plugin command\'s one choice', () => {
    const choice = cardOf({ kind: 'questions', questions: [{ ...WHERE, text: 'Which notes should /tidy clean up?' }], answers: {} })
    expect(sendWords(choice, choice.questions[0]!)).toBe('Send answer')
  })
})

describe('the questions card', () => {
  it('shows the first question alone, its labels as radios exactly as sent, with Other, and Next off until a pick', () => {
    const markup = drawn(batch())
    expect(markup).toContain('role="group" aria-label="Hermes has 2 questions"')
    expect(markup).toContain('0 of 2 answered')
    expect(markup).toContain('<legend data-find="ask:srq-batch question 0">Which environment should I deploy to?</legend>')
    expect(markup.match(/type="radio"/g)).toHaveLength(3)
    expect(markup).toContain('staging (Recommended)')
    expect(markup).toContain('Other</label>')
    expect(markup).not.toContain('Which regions?')
    expect(buttons(markup)).toEqual(['Next (off)', 'Skip question'])
  })

  it('lists a locked answer with Change above the last question, whose checkboxes ask for all that apply', () => {
    const markup = drawn(batch({ q0: ['production'] }))
    expect(markup).toContain('1 of 2 answered')
    expect(markup).toMatch(/<li><span class="asked"[^>]*>Which environment should I deploy to\?<\/span><span class="said"[^>]*>production<\/span><button/)
    expect(markup).toContain('aria-label="Change: Which environment should I deploy to?"')
    expect(markup.match(/type="checkbox"/g)).toHaveLength(4)
    expect(markup).toContain('Pick all that apply')
    expect(buttons(markup)).toEqual(['Change', 'Send answers (off)', 'Skip question'])
  })

  it('opens a typed answer at once for a question with no labels', () => {
    const markup = drawn(cardOf({ kind: 'questions', questions: [TYPED], answers: {} }))
    expect(markup).toContain('aria-label="Your answer"')
    expect(markup).not.toContain('type="radio"')
    expect(markup).not.toContain('answered')
  })

  it('reads Sending… while a lock is on its way, and is off while the link is down', () => {
    const ask = { kind: 'questions', questions: [WHERE, REGIONS], answers: {} } as const
    expect(buttons(drawn(cardOf(ask, { s: 'sending', reply: { kind: 'lock', question: 'q0', answer: ['production'] } })))).toEqual(['Sending… (off)', 'Skip question (off)'])
    expect(drawn(cardOf(ask, undefined, { state: 'offline' }))).toContain('<fieldset disabled="">')
  })

  it('keeps a changed question open until Hermes takes its lock, and open with the refusal when Hermes refuses it, with no Send answers', async () => {
    const ended: null[] = []
    const replies: RequestReply[] = []
    let take: (taken: boolean) => void = () => {}
    const locking = lockAnswer(reply => new Promise(done => {
      replies.push(reply)
      take = done
    }), 'q0', ['staging (Recommended)'], change => ended.push(change))
    await Promise.resolve()
    expect(replies).toEqual([{ kind: 'lock', question: 'q0', answer: ['staging (Recommended)'] }])
    expect(ended).toEqual([])
    take(false)
    await locking
    expect(ended).toEqual([])
    const refused = drawn(cardOf({ kind: 'questions', questions: [WHERE, REGIONS], answers: { q0: ['production'] } }, { s: 'waiting', error: 'Hermes refused it.' }), 'q0')
    expect(refused).toContain('<legend data-find="ask:srq-batch question 0">')
    expect(refused).toContain('Hermes refused it.')
    expect(buttons(refused)).toEqual(['Next', 'Skip question'])
  })

  it('ends a change once Hermes takes its lock', async () => {
    const ended: null[] = []
    await lockAnswer(async () => true, 'q0', ['staging (Recommended)'], change => ended.push(change))
    expect(ended).toEqual([null])
  })

  it('shows only the locked answers, with no Change, once the last one is sent', () => {
    const markup = drawn(batch({ q0: ['production'], q1: null }))
    expect(markup).toContain('Skipped')
    expect(markup).not.toContain('<form')
    expect(buttons(markup)).toEqual([])
  })
})
