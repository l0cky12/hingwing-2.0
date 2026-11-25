import type { HermesRequest, RequestId, Session } from '@highwing/hermes/domain'
import { threadView } from '@highwing/thread'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Thread } from '../src/renderer/chat/Thread'

const CLOCK = { now: 1_800_000_000_000, timeZone: 'UTC' }

const session = (requests: readonly HermesRequest[], sync: Session['sync'] = { state: 'live' }): Session => ({
  id: 's1' as Session['id'], title: '', cwd: null, history: [], earlier: 'none', run: { state: 'idle' }, interlude: [], requests, queue: [], outbox: [],
  model: { current: null, next: null, ask: null }, usage: { totals: null, context: null }, tuning: { reasoning: null, busy: null, effort: null, fast: null, yolo: null }, sides: [], processes: null, control: null, sync
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
      view={threadView(session(requests, sync), CLOCK)} relays={[]} onAnswer={none} onAnswerRequest={none} onLoadEarlier={none} onFindClosed={none} onFindScrolled={none}
      canEdit={false} regenerateTurnKey={null} canRegenerate={false} canBranch={false} onEdit={none} onRegenerate={none} onBranch={none} versions={[]} onVersion={none}
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

  it('draws no card for a request nothing here can answer', () => {
    const code: HermesRequest = { ...sudo, ask: { kind: 'secret', for: { is: 'code', site: null, hint: null } } }
    expect(drawn([code])).not.toContain('role="group"')
  })
})
