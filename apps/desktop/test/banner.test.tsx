import type { Link, SshHost, Target } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { bannerOf } from '../src/renderer/chrome/Chrome'

const REMOTE: Target = { kind: 'remote', host: 'hermes-host' as SshHost }
const ENDED = 'Your sign-in to the Hermes on hermes.example.com has ended.'
const SIGNED_OUT: Link = { state: 'blocked', why: 'signed-out', message: ENDED }

describe('the connection banner', () => {
  it('offers Sign in on a signed-out link, which opens the Connection screen and checks the live target', () => {
    expect(bannerOf(SIGNED_OUT, REMOTE)).toEqual({
      words: ENDED,
      action: { label: 'Sign in', run: [{ do: 'editTarget' }, { do: 'checkTarget', target: REMOTE, into: 'replace' }] }
    })
  })

  it('offers Retry on a link blocked for another reason, and on a signed-out link with no target to check', () => {
    const retry = { label: 'Retry', run: [{ do: 'reconnect', start: false }] }
    expect(bannerOf({ state: 'blocked', why: 'hermes-missing', message: 'No hermes.' }, REMOTE)?.action).toEqual(retry)
    expect(bannerOf(SIGNED_OUT, null)?.action).toEqual(retry)
  })

  it('offers Start Hermes only when Hermes is not running', () => {
    expect(bannerOf({ state: 'waiting', why: 'not-running', message: "Hermes isn't running.", attempt: 1, retryAt: 0 }, REMOTE)?.action)
      .toEqual({ label: 'Start Hermes', run: [{ do: 'reconnect', start: true }] })
    expect(bannerOf({ state: 'waiting', why: 'unreachable', message: "Highwing can't reach hermes.example.com.", attempt: 1, retryAt: 0 }, REMOTE))
      .toEqual({ words: "Highwing can't reach hermes.example.com.", action: null })
  })

  it('shows nothing while the link is online', () => {
    expect(bannerOf({ state: 'online' }, REMOTE)).toBeNull()
  })
})
