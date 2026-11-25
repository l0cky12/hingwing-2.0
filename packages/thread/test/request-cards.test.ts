import { describe, expect, it } from 'vitest'
import type { ConnectTarget, HermesRequest, RequestAsk, RequestId, Session } from '../../hermes/src/domain/session'
import { findInThread } from '../src/find'
import { checkThread, outline, threadView } from '../src/thread-view'

const CLOCK = { now: 1_800_000_000_000, timeZone: 'UTC' }

const session = (requests: readonly HermesRequest[], sync: Session['sync'] = { state: 'live' }): Session => ({
  id: 's1' as Session['id'], title: '', cwd: null, history: [], earlier: 'none', run: { state: 'idle' }, interlude: [], requests, queue: [], outbox: [],
  model: { current: null, next: null, ask: null }, usage: { totals: null, context: null }, tuning: { reasoning: null, busy: null, effort: null, fast: null, yolo: null }, sides: [], processes: null, control: null, sync
})

const request = (id: string, ask: RequestAsk, state: HermesRequest['state'] = { s: 'waiting', error: null }): HermesRequest =>
  ({ id: id as RequestId, ask, state, deadline: null })

const WHERE = { id: 'q0', text: 'Which environment should I deploy to?', choices: ['staging (Recommended)', 'production'], multi: false }
const REGIONS = { id: 'q1', text: 'Which regions?', choices: ['eu-west (Recommended)', 'us-east', 'ap-south'], multi: true }
const batch = (answers: Extract<RequestAsk, { kind: 'questions' }>['answers'] = {}) =>
  request('srq-batch', { kind: 'questions', questions: [WHERE, REGIONS], answers })

const GITHUB: ConnectTarget = {
  name: 'github', kind: 'connector', action: 'connect', state: 'pending', resolved: false, detail: null,
  instructions: 'Sign in to GitHub in your browser, then come back here.', url: 'https://example.com/connect/github', fields: []
}
const LINEAR: ConnectTarget = {
  ...GITHUB, name: 'linear', state: 'connected', resolved: true, instructions: null, url: null,
  fields: [{ name: 'LINEAR_API_KEY', prompt: 'Linear API key', required: true, secret: true, initial: '' }, { name: 'LINEAR_TEAM', prompt: null, required: false, secret: false, initial: 'eng' }]
}
const card = (targets: readonly ConnectTarget[]) => request('connect-1', { kind: 'connect', rev: 1, targets, suggested: [] })

describe('a batch of questions', () => {
  it('lists every question with its labels exactly as Hermes sent them, and counts none answered', () => {
    const view = threadView(session([batch()]), CLOCK)
    expect(view.asks[0]).toEqual({
      kind: 'questions', key: 'ask:srq-batch', requestId: 'srq-batch', heading: 'Hermes has 2 questions', progress: '0 of 2 answered',
      questions: [{ ...WHERE, locked: null }, { ...REGIONS, locked: null }], waits: null, busy: null, error: null
    })
    expect(checkThread(view)).toEqual([])
  })

  it('holds what Hermes locked, in words, and counts it', () => {
    const view = threadView(session([batch({ q0: ['production'] })]), CLOCK)
    expect(view.asks[0]).toMatchObject({
      progress: '1 of 2 answered',
      questions: [{ id: 'q0', locked: { answer: ['production'], words: 'production' } }, { id: 'q1', locked: null }]
    })
    expect(outline(view).split('\n')).toEqual([
      '◈ Hermes has 2 questions',
      '    1 of 2 answered',
      '    ✓ Which environment should I deploy to?  production',
      '    ? Which regions?  [eu-west (Recommended)] [us-east] [ap-south] (any)'
    ])
  })

  it('reads a skipped question as Skipped and several picks as a list', () => {
    const view = threadView(session([batch({ q0: null, q1: ['eu-west (Recommended)', 'us-east'] })]), CLOCK)
    const [where, regions] = view.asks[0]?.kind === 'questions' ? view.asks[0].questions : []
    expect(where?.locked).toEqual({ answer: null, words: 'Skipped' })
    expect(regions?.locked?.words).toBe('eu-west (Recommended), us-east')
  })

  it('asks a plugin command\'s one choice as a question with no count', () => {
    const choice = request('srq-tidy', { kind: 'questions', questions: [{ id: 'q0', text: 'Which notes should /tidy clean up?', choices: ["Today's", "This week's"], multi: false }], answers: {} })
    expect(threadView(session([choice]), CLOCK).asks[0]).toMatchObject({ heading: 'Hermes has a question', progress: null })
  })

  it('is sending while a lock is on its way, and offline while the link is down', () => {
    const sending = request('srq-batch', batch().ask, { s: 'sending', reply: { kind: 'lock', question: 'q0', answer: ['production'] } })
    expect(threadView(session([sending]), CLOCK).asks[0]?.busy).toBe('sending')
    expect(threadView(session([batch()], { state: 'offline' }), CLOCK).asks[0]?.busy).toBe('offline')
  })

  it('finds the answered questions, their answers and the first open question, and no question not yet drawn', () => {
    const view = threadView(session([request('srq-3', { kind: 'questions', questions: [WHERE, REGIONS, { ...REGIONS, id: 'q2', text: 'Which zones?' }], answers: { q0: ['production'] } })]), CLOCK)
    expect(findInThread(view, 'production').map(match => match.field)).toEqual(['ask:srq-3 answer 0'])
    expect(findInThread(view, 'Which').map(match => match.field)).toEqual(['ask:srq-3 question 0', 'ask:srq-3 question 1'])
    expect(findInThread(view, '1 of 3').map(match => match.field)).toEqual(['ask:srq-3 progress'])
  })

  it('finds only the question being changed while the window changes an answer, as the card draws it', () => {
    const view = threadView(session([request('srq-3', { kind: 'questions', questions: [WHERE, REGIONS, { ...REGIONS, id: 'q2', text: 'Which zones?' }], answers: { q0: ['production'] } })]), CLOCK)
    const changing = new Map([['ask:srq-3', 'q0']])
    expect(findInThread(view, 'production', changing)).toEqual([])
    expect(findInThread(view, 'Which', changing).map(match => match.field)).toEqual(['ask:srq-3 question 0'])
  })
})

describe('a connector card', () => {
  it('names each target with its state, instructions, sign-in link and fields', () => {
    const view = threadView(session([card([GITHUB, LINEAR])]), CLOCK)
    expect(view.asks[0]).toEqual({
      kind: 'connect', key: 'ask:connect-1', requestId: 'connect-1', heading: 'Hermes needs a connection to continue', waits: null, busy: null, error: null,
      targets: [
        { name: 'github', heading: 'Sign in to github', state: 'Waiting', open: true, connect: 'Connect', detail: null, instructions: GITHUB.instructions, url: GITHUB.url, fields: [] },
        {
          name: 'linear', heading: 'Sign in to linear', state: 'Connected', open: false, connect: 'Connect', detail: null, instructions: null, url: null,
          fields: [
            { name: 'LINEAR_API_KEY', label: 'Linear API key', required: true, masked: true, initial: '' },
            { name: 'LINEAR_TEAM', label: 'LINEAR_TEAM', required: false, masked: false, initial: 'eng' }
          ]
        }
      ]
    })
    expect(outline(view).split('\n')).toEqual([
      '◈ Hermes needs a connection to continue',
      '    Sign in to github  Waiting',
      '      Sign in to GitHub in your browser, then come back here.',
      '      ↗ https://example.com/connect/github',
      '      [Connect] [Skip]',
      '    Sign in to linear  Connected',
      '    [Continue without the rest]'
    ])
  })

  it.each<[ConnectTarget['state'], string]>([
    ['pending', 'Waiting'], ['started', 'Waiting'], ['connected', 'Connected'], ['skipped', 'Skipped'], ['failed', 'Failed'], ['expired', 'Expired'], ['not-connected', 'Not connected']
  ])('reads a target that is %s as "%s"', (state, words) => {
    const view = threadView(session([card([{ ...GITHUB, state }])]), CLOCK)
    expect(view.asks[0]?.kind === 'connect' && view.asks[0].targets[0]?.state).toBe(words)
  })

  it.each(['failed', 'expired'] as const)('offers Try again for a %s target, with no fields, since a new link carries no values', state => {
    const view = threadView(session([card([{ ...LINEAR, state, resolved: false }])]), CLOCK)
    expect(view.asks[0]).toMatchObject({ targets: [{ open: true, connect: 'Try again', fields: [] }] })
    expect(outline(view)).toContain('      [Try again] [Skip]')
  })

  it('finds a target by its heading and instructions', () => {
    const view = threadView(session([card([GITHUB])]), CLOCK)
    expect(findInThread(view, 'browser').map(match => match.field)).toEqual(['ask:connect-1 instructions 0'])
    expect(findInThread(view, 'Sign in to').map(match => match.field)).toEqual(['ask:connect-1 target 0', 'ask:connect-1 instructions 0'])
  })
})
