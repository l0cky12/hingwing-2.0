import { describe, expect, it } from 'vitest'
import type {
  Generation, HermesRequest, Item, NoticeItem, RecordedReply, RequestAsk, RequestEnd, RequestId, Session, Sync, TurnId
} from '../../hermes/src/domain/session'
import { findInThread } from '../src/find'
import { checkThread, outline, threadView, type ThreadNode } from '../src/thread-view'

const CLOCK = { now: 1_800_000_000_000, timeZone: 'UTC' }
const WAITS_UNTIL_14_07 = CLOCK.now + (6 * 60 + 7) * 60_000

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1' as Session['id'], title: '', cwd: null, history: [], earlier: 'none', run: { state: 'idle' }, interlude: [], requests: [], queue: [], outbox: [],
    model: { current: null, next: null, ask: null }, usage: { totals: null, context: null }, tuning: { reasoning: null, busy: null, effort: null, fast: null, yolo: null }, sides: [], sync: { state: 'live' }, ...over
  }
}

const running = (items: readonly Item[] = [], sync: Sync = { state: 'live' }): Session => session({
  sync,
  run: { state: 'running', generation: 1 as Generation, stop: 'none', turn: { id: 't9' as TurnId, request: { text: 'Do the errand', inputId: null, rowId: null, attachments: [] }, began: null, items, announced: null } }
})

const request = (id: string, ask: RequestAsk, state: HermesRequest['state'] = { s: 'waiting', error: null }, deadline: number | null = null): HermesRequest =>
  ({ id: id as RequestId, ask, state, deadline })

const SUDO = request('srq-sudo', { kind: 'secret', for: { is: 'sudo', command: 'sudo apt-get install -y jq' } }, { s: 'waiting', error: null }, WAITS_UNTIL_14_07)
const TENOR = request('srq-env', { kind: 'secret', for: { is: 'env', name: 'TENOR_API_KEY', prompt: 'Tenor API key' } })
const closed = (asked: Extract<NoticeItem, { what: 'closed' }>['asked'], end: RequestEnd): NoticeItem =>
  ({ kind: 'notice', what: 'closed', requestId: 'srq-1' as RequestId, asked, end })
const closedNode = (asked: Parameters<typeof closed>[0], end: RequestEnd): ThreadNode | undefined => threadView(running([closed(asked, end)]), CLOCK).turns[0]?.nodes[0]

describe('ask cards', () => {
  it('asks for a sudo password with its redacted command, the time Hermes waits until and a password field', () => {
    const view = threadView(session({ requests: [SUDO] }), CLOCK)
    expect(view.asks).toEqual([{
      key: expect.any(String), requestId: 'srq-sudo', heading: 'Hermes needs your sudo password', command: 'sudo apt-get install -y jq',
      why: null, name: null, label: 'Password', waits: 'Hermes waits until 14:07.', busy: false, error: null
    }])
  })

  it('tells the wait in the time zone of the view', () => {
    const view = threadView(session({ requests: [SUDO] }), { ...CLOCK, timeZone: 'Asia/Tokyo' })
    expect(view.asks[0]?.waits).toBe('Hermes waits until 23:07.')
  })

  it('asks for a secret with its reason and variable name, and says nothing of a wait Hermes did not name', () => {
    expect(threadView(session({ requests: [TENOR] }), CLOCK).asks).toEqual([{
      key: expect.any(String), requestId: 'srq-env', heading: 'Hermes needs a secret', command: null,
      why: 'Tenor API key', name: 'TENOR_API_KEY', label: 'Secret value', waits: null, busy: false, error: null
    }])
  })

  it('lists the cards oldest first, after the turns and before the pending messages, in the outline', () => {
    const view = threadView({ ...running(), requests: [SUDO, TENOR], outbox: [{ inputId: 'i1' as never, text: 'Hello again', attachments: [], state: { s: 'sending' } }] }, CLOCK)
    expect(view.asks.map(card => card.requestId)).toEqual(['srq-sudo', 'srq-env'])
    expect(outline(view).split('\n')).toEqual([
      '> Do the errand',
      '◉ Thinking',
      '◈ Hermes needs your sudo password',
      '    sudo apt-get install -y jq',
      '    Hermes waits until 14:07.',
      '    (Password) [Skip] [Send]',
      '◈ Hermes needs a secret',
      '    Tenor API key',
      '    TENOR_API_KEY',
      '    (Secret value) [Skip] [Send]',
      '⋯ Hello again  (sending)'
    ])
    expect(checkThread(view)).toEqual([])
  })

  it('is busy while the answer is on its way, and shows no value', () => {
    const reply: RecordedReply = { kind: 'withheld' }
    const view = threadView(session({ requests: [{ ...SUDO, state: { s: 'sending', reply } }] }), CLOCK)
    expect(view.asks[0]).toMatchObject({ busy: true, error: null })
    expect(outline(view)).toContain('◈ Hermes needs your sudo password  (busy)')
  })

  it.each(['offline', 'catching-up', 'rebuilding'] as const)('is busy while the link is %s, because an answer could not be sent', state => {
    expect(threadView(session({ requests: [TENOR], sync: { state } }), CLOCK).asks[0]?.busy).toBe(true)
  })

  it('shows why the last answer did not reach Hermes, and is free to answer again', () => {
    const view = threadView(session({ requests: [{ ...SUDO, state: { s: 'waiting', error: "Hermes didn't get your answer." } }] }), CLOCK)
    expect(view.asks[0]).toMatchObject({ busy: false, error: "Hermes didn't get your answer." })
    expect(outline(view)).toContain("    ! Hermes didn't get your answer.")
  })

  it('draws no card for a vault, login or code request, a batch of questions or a connector card', () => {
    const others: HermesRequest[] = [
      request('srq-vault', { kind: 'secret', for: { is: 'vault', backend: '1password', name: 'deploy key' } }),
      request('srq-login', { kind: 'secret', for: { is: 'login', site: 'example.com', origin: 'https://example.com' } }),
      request('srq-code', { kind: 'secret', for: { is: 'code', site: null, hint: null } }),
      request('srq-questions', { kind: 'questions', questions: [{ id: 'q0', text: 'Where?', choices: [], multi: false }], answers: {} }),
      request('srq-connect', { kind: 'connect', rev: 1, targets: [], suggested: [] })
    ]
    const view = threadView(session({ requests: [...others, SUDO] }), CLOCK)
    expect(view.asks.map(card => card.requestId)).toEqual(['srq-sudo'])
  })
})

describe('where a request closed', () => {
  it.each<[RequestEnd, string]>([
    ['answered', 'You sent a password.'],
    ['skipped', 'You skipped this.'],
    ['elsewhere', 'Answered from another window.'],
    ['done', 'Answered from another window.'],
    ['timeout', 'Nobody answered in time, so Hermes stopped waiting.'],
    ['interrupted', 'Hermes withdrew this request.'],
    ['withdrawn', 'Hermes withdrew this request.']
  ])('reads a sudo that ended %s in words', (end, words) => {
    const node = closedNode('sudo', end)
    expect(node).toMatchObject({ kind: 'closed', asked: 'sudo', end, words })
    expect(outline(threadView(running([closed('sudo', end)]), CLOCK))).toContain(`○ ${words}`)
  })

  it('reads an answered secret as the secret', () => {
    expect(closedNode('env', 'answered')).toMatchObject({ words: 'You sent the secret.' })
  })

  it.each(['vault', 'login', 'code', 'questions', 'connect'] as const)('has no words for a closed %s, so nothing is drawn for it', asked => {
    const view = threadView(running([closed(asked, 'answered')]), CLOCK)
    expect(view.turns[0]?.nodes).toEqual([expect.objectContaining({ kind: 'closed', asked, words: null })])
    expect(outline(view)).toContain(`◇ ${asked}: answered`)
  })
})

describe('what Highwing declines', () => {
  const declined = (method: string): NoticeItem => ({ kind: 'notice', what: 'declined', requestId: 'r1', method })

  it('still says no to a setup step in words', () => {
    expect(threadView(running([declined('setup_beat')]), CLOCK).turns[0]?.nodes[0]).toMatchObject({
      kind: 'notice', text: "Hermes asked to show a setup step. Highwing can't show that yet, so it said no."
    })
  })

  it('leaves a sudo or secret asked and closed with no declined notice', () => {
    const view = threadView({ ...running([closed('sudo', 'answered'), closed('env', 'skipped')]), requests: [SUDO, TENOR] }, CLOCK)
    expect(view.turns[0]?.nodes.map(node => node.kind)).toEqual(['closed', 'closed'])
    expect(outline(view)).not.toMatch(/can't show/)
  })
})

describe('finding words in a card', () => {
  it.each([
    ['sudo password', 'ask:srq-sudo heading'],
    ['apt-get install', 'ask:srq-sudo command'],
    ['until 14:07', 'ask:srq-sudo waits'],
    ['Tenor API', 'ask:srq-env why'],
    ['TENOR_API_KEY', 'ask:srq-env name']
  ])('finds "%s"', (query, field) => {
    const view = threadView(session({ requests: [SUDO, TENOR] }), CLOCK)
    expect(findInThread(view, query).map(match => match.field)).toEqual([field])
  })

  it('finds the words of a closed request, and the error of an answer that failed', () => {
    const view = threadView({ ...running([closed('sudo', 'skipped')]), requests: [{ ...TENOR, state: { s: 'waiting', error: 'Hermes did not get that.' } }] }, CLOCK)
    expect(findInThread(view, 'You skipped')).toHaveLength(1)
    expect(findInThread(view, 'did not get')).toHaveLength(1)
  })
})
