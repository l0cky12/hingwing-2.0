import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { manualClock } from '../src/testing/clock'
import type { FakeWebapp } from '../src/testing/fake-webapp'
import { dialWith, GATEWAY_PROTOCOL, TICKET_PREFIX } from '../src/wire/link'
import { errandGateway, listen } from './support/host'
import { webapp } from './support/webapp'

const VERIFIER = 'a-verifier-of-forty-three-characters-exactly'
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
const CALLBACK = 'http://127.0.0.1:9/callback'

const authorize = (web: FakeWebapp, asked: Record<string, string> = {}) => fetch(
  `${web.url}/auth/native/authorize?${new URLSearchParams({ code_challenge: CHALLENGE, code_challenge_method: 'S256', redirect_uri: CALLBACK, state: 'mine', ...asked })}`,
  { redirect: 'manual' }
)

const post = (web: FakeWebapp, path: string, body?: unknown, bearer?: string) => fetch(`${web.url}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
})

/** The browser's part, by hand: the code Hermes sends back to the app. */
const codeFrom = async (web: FakeWebapp): Promise<string> => {
  const login = await fetch(new URL((await authorize(web)).headers.get('location') ?? '', web.url), { redirect: 'manual' })
  const back = new URL(login.headers.get('location') ?? '')
  expect(`${back.origin}${back.pathname}`).toBe(CALLBACK)
  expect(back.searchParams.get('state')).toBe('mine')
  return back.searchParams.get('code') ?? ''
}

const signIn = async (web: FakeWebapp): Promise<{ readonly access_token: string; readonly refresh_token: string }> => {
  const reply = await post(web, '/auth/native/token', { code: await codeFrom(web), code_verifier: VERIFIER })
  expect(reply.status).toBe(200)
  return await reply.json() as { readonly access_token: string; readonly refresh_token: string }
}

const ticketFor = async (web: FakeWebapp, bearer: string) => post(web, '/api/auth/ws-ticket', undefined, bearer)

describe('the fake Webapp, which keeps the rules of the real one', () => {
  it.each([
    ['a plain challenge', { code_challenge_method: 'plain' }],
    ['no challenge', { code_challenge: '' }],
    ['a redirect to a name', { redirect_uri: 'http://localhost:9/callback' }],
    ['a redirect to another machine', { redirect_uri: 'http://hermes.example.com/callback' }],
    ['an https redirect', { redirect_uri: 'https://127.0.0.1:9/callback' }]
  ])('refuses to start a sign-in with %s', async (_what, asked) => {
    expect((await authorize(await webapp('ok'), asked)).status).toBe(400)
  })

  it('redeems a code once, and only with the verifier of its challenge', async () => {
    const web = await webapp('ok')
    const code = await codeFrom(web)
    expect((await post(web, '/auth/native/token', { code, code_verifier: VERIFIER })).status).toBe(200)
    expect((await post(web, '/auth/native/token', { code, code_verifier: VERIFIER })).status).toBe(400)
    expect((await post(web, '/auth/native/token', { code: await codeFrom(web), code_verifier: `${VERIFIER}x` })).status).toBe(400)
  })

  it('lets a code lapse 120 s after the sign-in', async () => {
    const clock = manualClock()
    const web = await webapp('ok', { clock })
    const code = await codeFrom(web)
    await clock.advance(120_001)
    expect((await post(web, '/auth/native/token', { code, code_verifier: VERIFIER })).status).toBe(400)
  })

  it('rotates the refresh token, and refuses the one it replaced', async () => {
    const web = await webapp('ok')
    const first = await signIn(web)
    const renewed = await post(web, '/auth/native/refresh', { refresh_token: first.refresh_token, provider: 'basic' })
    const second = await renewed.json() as typeof first
    expect(renewed.status).toBe(200)
    expect(second.refresh_token).not.toBe(first.refresh_token)
    expect((await post(web, '/auth/native/refresh', { refresh_token: first.refresh_token, provider: 'basic' })).status).toBe(401)
    expect((await ticketFor(web, first.access_token)).status).toBe(401)
    expect((await ticketFor(web, second.access_token)).status).toBe(200)
  })

  it('mints a ticket only for the bearer of a live sign-in', async () => {
    const web = await webapp('ok')
    const { access_token: access, refresh_token: refresh } = await signIn(web)
    expect((await post(web, '/api/auth/ws-ticket')).status).toBe(401)
    expect((await ticketFor(web, refresh)).status).toBe(401)
    expect(await (await ticketFor(web, access)).json()).toMatchObject({ ttl_seconds: 30 })

    web.lapse()
    expect((await ticketFor(web, access)).status).toBe(401)
    expect((await post(web, '/auth/native/refresh', { refresh_token: refresh })).status).toBe(200)

    web.signOut()
    expect((await post(web, '/auth/native/refresh', { refresh_token: refresh })).status).toBe(401)
  })

  it('serves its routes and its socket only under the path it was given', async () => {
    const gateway = await listen(errandGateway())
    const web = await webapp('ok', { gateway, prefix: '/hermes' })
    expect(web.url).toBe(`http://127.0.0.1:${gateway.port}/hermes`)
    expect((await fetch(`http://127.0.0.1:${gateway.port}/api/status`)).status).toBe(404)
    expect((await fetch(`${web.url}/api/status`)).status).toBe(200)

    const { access_token: access } = await signIn(web)
    const dialAt = async (path: string) => {
      const { ticket } = await (await ticketFor(web, access)).json() as { readonly ticket: string }
      const url = `ws://127.0.0.1:${gateway.port}${path}`
      return dialWith(async () => ({ url, protocols: [GATEWAY_PROTOCOL, TICKET_PREFIX + ticket], reach: 'host' }))({ start: false })
    }
    await expect(dialAt('/api/ws')).rejects.toMatchObject({ kind: 'dropped' })
    ;(await dialAt('/hermes/api/ws')).close()
    expect(gateway.upgrades.map(({ refused }) => refused)).toEqual(['path', null])
  })
})
