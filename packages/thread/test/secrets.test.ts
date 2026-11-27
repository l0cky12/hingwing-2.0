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
    model: { current: null, next: null, ask: null }, usage: { totals: null, context: null }, tuning: { reasoning: null, busy: null, effort: null, fast: null, yolo: null, approvals: null }, sides: [], processes: null, control: null, rewound: {}, sync: { state: 'live' }, ...over
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
      kind: 'secret', key: expect.any(String), requestId: 'srq-sudo', heading: 'Hermes needs your sudo password', command: 'sudo apt-get install -y jq',
      why: null, name: null, fields: [{ part: 'value', label: 'Password', masked: true }], send: 'Send', skip: 'Skip',
      waits: 'Hermes waits until 14:07.', busy: null, error: null
    }])
  })

  it('tells the wait in the time zone of the view', () => {
    const view = threadView(session({ requests: [SUDO] }), { ...CLOCK, timeZone: 'Asia/Tokyo' })
    expect(view.asks[0]?.waits).toBe('Hermes waits until 23:07.')
  })

  it('asks for a secret with its reason and variable name, and says nothing of a wait Hermes did not name', () => {
    expect(threadView(session({ requests: [TENOR] }), CLOCK).asks).toEqual([{
      kind: 'secret', key: expect.any(String), requestId: 'srq-env', heading: 'Hermes needs a secret', command: null,
      why: 'Tenor API key', name: 'TENOR_API_KEY', fields: [{ part: 'value', label: 'Secret value', masked: true }], send: 'Send', skip: 'Skip',
      waits: null, busy: null, error: null
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

  it('is sending while the answer is on its way, and shows no value', () => {
    const reply: RecordedReply = { kind: 'withheld' }
    const view = threadView(session({ requests: [{ ...SUDO, state: { s: 'sending', reply } }] }), CLOCK)
    expect(view.asks[0]).toMatchObject({ busy: 'sending', error: null })
    expect(outline(view)).toContain('◈ Hermes needs your sudo password  (sending)')
  })

  it.each(['offline', 'catching-up', 'rebuilding'] as const)('is offline while the link is %s, because an answer could not be sent', state => {
    expect(threadView(session({ requests: [TENOR], sync: { state } }), CLOCK).asks[0]?.busy).toBe('offline')
  })

  it('shows why the last answer did not reach Hermes, and is free to answer again', () => {
    const view = threadView(session({ requests: [{ ...SUDO, state: { s: 'waiting', error: "Hermes didn't get your answer." } }] }), CLOCK)
    expect(view.asks[0]).toMatchObject({ busy: null, error: "Hermes didn't get your answer." })
    expect(outline(view)).toContain("    ! Hermes didn't get your answer.")
  })

  it('asks to unlock a vault by its name, with a master password field and Unlock or Keep locked', () => {
    const view = threadView(session({ requests: [request('srq-vault', { kind: 'secret', for: { is: 'vault', backend: 'bitwarden', name: 'Bitwarden' } })] }), CLOCK)
    expect(view.asks[0]).toMatchObject({
      kind: 'secret', heading: 'Unlock Bitwarden', why: null, fields: [{ part: 'value', label: 'Master password', masked: true }], send: 'Unlock', skip: 'Keep locked'
    })
  })

  it('asks to save a login with a username shown as typed and a masked password, sent together', () => {
    const view = threadView(session({ requests: [request('srq-login', { kind: 'secret', for: { is: 'login', site: 'example.com', origin: 'https://example.com' } })] }), CLOCK)
    expect(view.asks[0]).toMatchObject({
      heading: 'Save your example.com login?', why: 'Hermes is on the sign-in page at https://example.com.',
      fields: [{ part: 'identifier', label: 'Email or username', masked: false }, { part: 'value', label: 'Password', masked: true }],
      send: 'Save and sign in', skip: "Don't save"
    })
    expect(outline(view)).toContain("    (Email or username) (Password) [Don't save] [Save and sign in]")
  })

  it('asks for a one-time code shown as typed, with Hermes\'s hint, and names the site when Hermes does', () => {
    const code = (site: string | null) => request('srq-code', { kind: 'secret', for: { is: 'code', site, hint: 'the 6-digit code from your authenticator app' } })
    expect(threadView(session({ requests: [code('example.com')] }), CLOCK).asks[0]).toMatchObject({
      heading: 'Verification code for example.com', why: 'the 6-digit code from your authenticator app',
      fields: [{ part: 'value', label: 'Code', masked: false }], send: 'Enter code', skip: 'Skip'
    })
    expect(threadView(session({ requests: [code(null)] }), CLOCK).asks[0]?.heading).toBe('Verification code')
  })
})

describe('where a request closed', () => {
  it.each<[RequestEnd, string]>([
    ['answered', 'You sent a password.'],
    ['skipped', 'You skipped this.'],
    ['elsewhere', 'Answered from another window.'],
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

  it.each<[Extract<NoticeItem, { what: 'closed' }>['asked'], RequestEnd, string]>([
    ['vault', 'answered', 'You unlocked the vault.'],
    ['vault', 'skipped', 'You kept the vault locked.'],
    ['login', 'answered', 'You saved the login.'],
    ['login', 'skipped', "You didn't save the login."],
    ['code', 'answered', 'You entered the code.'],
    ['code', 'skipped', 'You skipped the code.'],
    ['code', 'elsewhere', 'Answered from another window.'],
    ['questions', 'answered', 'You answered.'],
    ['questions', 'elsewhere', 'Answered from another window.'],
    ['questions', 'timeout', 'Nobody answered in time, so Hermes stopped waiting.'],
    ['connect', 'done', 'Hermes went on with what is connected.'],
    ['connect', 'interrupted', 'Hermes withdrew this request.']
  ])('reads a %s that ended %s as "%s"', (asked, end, words) => {
    expect(closedNode(asked, end)).toMatchObject({ kind: 'closed', asked, end, words })
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
