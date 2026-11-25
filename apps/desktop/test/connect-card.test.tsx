import type { ConnectTarget, HermesRequest, RequestId, Session } from '@highwing/hermes/domain'
import { threadView } from '@highwing/thread'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AskCard } from '../src/renderer/chat/Asks'

const GITHUB: ConnectTarget = {
  name: 'github', kind: 'connector', action: 'connect', state: 'pending', resolved: false, detail: null,
  instructions: 'Sign in to GitHub in your browser, then come back here.', url: 'https://example.com/connect/github', fields: []
}
const LINEAR: ConnectTarget = {
  ...GITHUB, name: 'linear', instructions: null, url: null,
  fields: [{ name: 'LINEAR_API_KEY', prompt: 'Linear API key', required: true, secret: true, initial: '' }, { name: 'LINEAR_TEAM', prompt: null, required: false, secret: false, initial: 'eng' }]
}

function drawn(targets: readonly ConnectTarget[], state: HermesRequest['state'] = { s: 'waiting', error: null }, sync: Session['sync'] = { state: 'live' }) {
  const request: HermesRequest = { id: 'op-1' as RequestId, ask: { kind: 'connect', rev: 1, targets, suggested: [] }, state, deadline: null }
  const session: Session = {
    id: 's1' as Session['id'], title: '', cwd: null, history: [], earlier: 'none', run: { state: 'idle' }, interlude: [], requests: [request], outbox: [],
    model: { current: null, next: null, ask: null }, usage: { totals: null, context: null }, yolo: null, tuning: { reasoning: null }, sync
  }
  const [card] = threadView(session, { now: 0, timeZone: 'UTC' }).asks
  return renderToStaticMarkup(<AskCard card={card!} changing={null} onChange={() => {}} onAnswer={async () => true} />)
}

const buttons = (markup: string) => Array.from(markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g), ([, attributes, name]) => `${name}${attributes?.includes('disabled') ? ' (off)' : ''}`)

describe('the connector card', () => {
  it('asks for a connection, with a row per target that names it, its state, its instructions and a sign-in link for the browser', () => {
    const markup = drawn([GITHUB])
    expect(markup).toContain('role="group" aria-label="Hermes needs a connection to continue"')
    expect(markup).toContain('role="group" aria-label="Sign in to github"')
    expect(markup).toContain('<span class="state waiting">Waiting</span>')
    expect(markup).toContain('Sign in to GitHub in your browser, then come back here.')
    expect(markup).toContain('<a href="https://example.com/connect/github" target="_blank" rel="noreferrer">Open sign-in page</a>')
    expect(buttons(markup)).toEqual(['Connect', 'Skip', 'Continue without the rest'])
  })

  it('draws a target\'s fields with their labels, masking a secret one and filling an initial value, and holds no typed value', () => {
    const markup = drawn([LINEAR])
    expect(markup).toMatch(/<span>Linear API key<\/span><input type="password" autoComplete="off" required="" name="LINEAR_API_KEY" value=""\/>/)
    expect(markup).toMatch(/<span>LINEAR_TEAM<\/span><input type="text" autoComplete="off" name="LINEAR_TEAM" value="eng"\/>/)
    expect(markup).toContain('data-private=""')
  })

  it('offers no Connect or Skip for a target that needs nothing more', () => {
    const markup = drawn([GITHUB, { ...LINEAR, state: 'connected', resolved: true }])
    expect(markup).toContain('<span class="state settled">Connected</span>')
    expect(markup).not.toContain('Linear API key')
    expect(buttons(markup)).toEqual(['Connect', 'Skip', 'Continue without the rest'])
  })

  it('offers Try again, with no fields, for a target whose sign-in failed or whose link expired', () => {
    for (const state of ['failed', 'expired'] as const) {
      const markup = drawn([{ ...LINEAR, state }])
      expect(markup).not.toContain('Linear API key')
      expect(buttons(markup)).toEqual(['Try again', 'Skip', 'Continue without the rest'])
    }
  })

  it('turns every button off while an answer is on its way or the link is down', () => {
    expect(buttons(drawn([GITHUB], { s: 'sending', reply: { kind: 'withheld' } }))).toEqual(['Connect (off)', 'Skip (off)', 'Continue without the rest (off)'])
    expect(buttons(drawn([GITHUB], undefined, { state: 'offline' }))).toEqual(['Connect (off)', 'Skip (off)', 'Continue without the rest (off)'])
  })
})
