import type { HermesRequest, RequestId, Session } from '@highwing/hermes/domain'
import { threadView } from '@highwing/thread'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Thread } from '../src/renderer/chat/Thread'

const CLOCK = { now: 1_800_000_000_000, timeZone: 'UTC' }

const session = (requests: readonly HermesRequest[], sync: Session['sync'] = { state: 'live' }): Session => ({
  id: 's1' as Session['id'], title: '', cwd: null, history: [], earlier: 'none', run: { state: 'idle' }, interlude: [], requests, queue: [], outbox: [],
  model: { current: null, next: null, ask: null }, usage: { totals: null, context: null }, tuning: { reasoning: null, busy: null, effort: null, fast: null, yolo: null, approvals: null }, sides: [], processes: null, control: null, rewound: {}, sync
})

const sudo: HermesRequest = {
  id: 'srq-1' as RequestId, ask: { kind: 'secret', for: { is: 'sudo', command: 'apt install ripgrep' } }, state: { s: 'waiting', error: null }, deadline: CLOCK.now + 60_000
}
const secret: HermesRequest = {
  id: 'srq-2' as RequestId, ask: { kind: 'secret', for: { is: 'env', name: 'TENOR_API_KEY', prompt: 'Tenor API key' } }, state: { s: 'waiting', error: 'Hermes didn’t get your answer.' }, deadline: null
}

function drawn(requests: readonly HermesRequest[], sync?: Session['sync']) {
  const none = () => {}
  return renderToStaticMarkup(
    <Thread
      view={threadView(session(requests, sync), CLOCK)} relays={[]} sides={[]} onAnswer={async () => undefined} onAnswerRequest={async () => true} onLoadEarlier={none} onFindClosed={none} onFindScrolled={none}
      canEdit={false} regenerateTurnKey={null} canRegenerate={false} canBranch={false} onEdit={none} onRegenerate={none} onBranch={none} onNewChat={none} versions={[]} onVersion={none} queue={{ canAct: false, pressed: new Map(), onAct: none }} canReact={false} onReact={none} helpers={null}
    />
  )
}

describe('the card that asks for a sudo password or a secret', () => {
  it('is a group named for what Hermes needs, with its command and wait, and a masked field that holds no value', () => {
    const markup = drawn([sudo])
    expect(markup).toContain('role="group" aria-label="Hermes needs your sudo password"')
    expect(markup).toContain('apt install ripgrep')
    expect(markup).toContain('Hermes waits until 08:01.')
    expect(markup).toMatch(/<input[^>]*type="password"[^>]*autoComplete="off"[^>]*aria-label="Password"|<input[^>]*aria-label="Password"[^>]*type="password"/)
    expect(markup).not.toMatch(/<input[^>]*\svalue=/)
  })

  it('names the secret and says why, and shows why the last answer did not arrive', () => {
    const markup = drawn([secret])
    expect(markup).toContain('aria-label="Hermes needs a secret"')
    expect(markup).toContain('Tenor API key')
    expect(markup).toContain('<code data-find="ask:srq-2 name">TENOR_API_KEY</code>')
    expect(markup).toContain('aria-label="Secret value"')
    expect(markup).toContain('Hermes didn’t get your answer.')
  })

  it('keeps Send off until something is typed, and Skip on while the card is free', () => {
    const markup = drawn([sudo])
    expect(markup).toMatch(/<button type="submit" class="primary" disabled="">Send<\/button>/)
    expect(markup).toMatch(/<button type="button">Skip<\/button>/)
  })

  it('turns both buttons off while the link is down', () => {
    const markup = drawn([sudo], { state: 'offline' })
    expect(markup).toMatch(/<button type="button" disabled="">Skip<\/button>/)
    expect(markup).toMatch(/<button type="submit" class="primary" disabled="">Send<\/button>/)
  })

  it('reads Sending… on the send button while the answer is on its way', () => {
    const markup = drawn([{ ...sudo, state: { s: 'sending', reply: { kind: 'withheld' } } }])
    expect(markup).toMatch(/<button type="submit" class="primary" disabled="">Sending…<\/button>/)
  })
})

describe('the card for a vault, a login or a one-time code', () => {
  const asking = (id: string, ask: HermesRequest['ask']): HermesRequest => ({ id: id as RequestId, ask, state: { s: 'waiting', error: null }, deadline: null })
  const inputs = (markup: string) => Array.from(markup.matchAll(/<input ([^>]*)\/>/g), ([, attributes]) =>
    Object.fromEntries(Array.from((attributes ?? '').matchAll(/([\w-]+)="([^"]*)"/g), ([, name, value]) => [name, value])))
  const field = (name: string, type: string, label: string) => ({ name, type, autoComplete: 'off', 'aria-label': label, placeholder: label })
  const buttons = (markup: string) => Array.from(markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g), ([, name]) => name)

  it('unlocks a vault with a masked master password, or keeps it locked', () => {
    const markup = drawn([asking('v1', { kind: 'secret', for: { is: 'vault', backend: 'bitwarden', name: 'Bitwarden' } })])
    expect(markup).toContain('aria-label="Unlock Bitwarden"')
    expect(inputs(markup)).toEqual([field('value', 'password', 'Master password')])
    expect(buttons(markup)).toEqual(['Keep locked', 'Unlock'])
  })

  it('saves a login with a username shown as typed and a masked password, in one form', () => {
    const markup = drawn([asking('l1', { kind: 'secret', for: { is: 'login', site: 'example.com', origin: 'https://example.com' } })])
    expect(markup).toContain('aria-label="Save your example.com login?"')
    expect(markup).toContain('Hermes is on the sign-in page at https://example.com.')
    expect(inputs(markup)).toEqual([field('identifier', 'text', 'Email or username'), field('value', 'password', 'Password')])
    expect(buttons(markup)).toEqual(["Don&#x27;t save", 'Save and sign in'])
  })

  it('takes a one-time code shown as typed, with the hint Hermes gave', () => {
    const markup = drawn([asking('c1', { kind: 'secret', for: { is: 'code', site: 'example.com', hint: 'the 6-digit code from your authenticator app' } })])
    expect(markup).toContain('aria-label="Verification code for example.com"')
    expect(markup).toContain('the 6-digit code from your authenticator app')
    expect(inputs(markup)).toEqual([field('value', 'text', 'Code')])
    expect(buttons(markup)).toEqual(['Skip', 'Enter code'])
  })

  it('keeps every field of a masked prompt out of the find index and the evidence, and holds no value', () => {
    const markup = drawn([asking('l1', { kind: 'secret', for: { is: 'login', site: 'example.com', origin: 'https://example.com' } })])
    expect(markup).toContain('<form class="answer" data-private="">')
    expect(markup).not.toMatch(/<input[^>]*\svalue=/)
  })
})
