import type { SshHost, Target } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const topics = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))

vi.mock('../src/renderer/store', () => ({
  run: async () => ({ ok: true, value: undefined }),
  useTopic: (topic: string) => topics.values[topic]
}))

const { HermesFoot } = await import('../src/renderer/chrome/HermesFoot')

const HOST: Target = { kind: 'remote', host: 'hermes-host.example-tailnet.ts.net' as SshHost }
const foot = (target: Target | null, state: string) => {
  topics.values = { link: { state } }
  return renderToStaticMarkup(<HermesFoot target={target} ref={null} />)
}

describe('the Hermes at the foot of the sidebar', () => {
  it('names the machine and whether it is connected, and opens no menu', () => {
    const html = foot(HOST, 'online')
    expect(html).toContain('aria-label="Hermes on hermes-host, Connected"')
    expect(html).not.toMatch(/aria-haspopup|aria-expanded|disabled/)
  })

  it('says when it is not connected', () => {
    expect(foot(HOST, 'connecting')).toContain('aria-label="Hermes on hermes-host, Not connected"')
  })

  it('is off when there is no connection to change', () => {
    expect(foot(null, 'online')).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Hermes, Connected"/)
  })
})
