import { URL_FAILURES, type GatewayUrl, type Link, type SshHost, type Target, type UrlFailure } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { showsSettings, type Live, type Setup } from '../src/ipc-contract'
import { cardOf } from '../src/renderer/setup/card-view'
import { ConnectionCard } from '../src/renderer/setup/ConnectionCard'
import { screenOf, type CardSetup } from '../src/renderer/setup/screens'

const remote = (host: string): Target => ({ kind: 'remote', host: host as SshHost })
const HOST = remote('hermes-host.example-tailnet.ts.net')
const LAB = remote('hermes-lab')
const LIVE: Live = { target: HOST, epoch: 1 }
const ONLINE: Link = { state: 'online' }
const AT_REST: CardSetup = { at: 'form', live: LIVE, notice: null }
const waiting = (why: 'not-running' | 'dropped', message: string): Link => ({ state: 'waiting', attempt: 1, retryAt: 0, why, message })

describe('which screen the window shows', () => {
  it.each<[string, Setup, string]>([
    ['the chat', { at: 'chat', live: LIVE }, 'chat'],
    ['a fixture run', { at: 'pinned' }, 'chat'],
    ['a first run', { at: 'form', live: null, notice: 'newer' }, 'first-run'],
    ['a first run checking', { at: 'checking', live: null, target: LAB, step: 'ssh' }, 'first-run'],
    ['a first run that failed', { at: 'failed', live: null, target: LAB, failure: 'host-offline' }, 'first-run'],
    ['a first run that passed', { at: 'saved', live: LIVE, from: 'first-run' }, 'saved'],
    ['the Settings button', AT_REST, 'settings'],
    ['a check from Settings', { at: 'checking', live: LIVE, target: LAB, step: 'ssh' }, 'settings'],
    ['a check from Settings that failed', { at: 'failed', live: LIVE, target: LAB, failure: 'host-offline' }, 'settings'],
    ['a check from Settings that passed', { at: 'saved', live: { target: LAB, epoch: 2 }, from: 'settings' }, 'settings']
  ])('shows %s on %j, by the rule main uses for Settings', (_what, setup, show) => {
    expect(screenOf(setup).show).toBe(show)
    expect(showsSettings(setup)).toBe(show === 'settings')
  })
})

describe('the connection row', () => {
  it('names the machine, adds the full name in mono, and shows the Online pill', () => {
    expect(cardOf(AT_REST, ONLINE, false)).toEqual({
      summary: { kind: 'remote', title: 'hermes-host', host: 'hermes-host.example-tailnet.ts.net', linkMessage: null, online: true, action: null },
      editor: null,
      news: null
    })
  })

  it('shows a short name once, keeps a user@ in the mono line, and calls this computer by name', () => {
    const summaryFor = (target: Target) => cardOf({ ...AT_REST, live: { target, epoch: 1 } }, ONLINE, false).summary
    expect(summaryFor(remote('hermes-host'))).toMatchObject({ title: 'hermes-host', host: null })
    expect(summaryFor(remote('me@hermes-host'))).toMatchObject({ title: 'hermes-host', host: 'me@hermes-host' })
    expect(summaryFor({ kind: 'local' })).toMatchObject({ kind: 'local', title: 'This computer', host: null })
  })

  it('shows the link\'s own words with no pill while it waits or is blocked, with the banner\'s action', () => {
    expect(cardOf(AT_REST, waiting('not-running', "Hermes isn't running."), false).summary)
      .toMatchObject({ linkMessage: "Hermes isn't running.", online: false, action: { label: 'Start Hermes', run: [{ do: 'reconnect', start: true }] } })
    expect(cardOf(AT_REST, { state: 'blocked', why: 'auth', message: 'Hermes turned Highwing away.' }, false).summary)
      .toMatchObject({ linkMessage: 'Hermes turned Highwing away.', online: false, action: { label: 'Retry', run: [{ do: 'reconnect', start: false }] } })
    expect(cardOf(AT_REST, waiting('dropped', 'Reconnecting to Hermes.'), false).summary)
      .toMatchObject({ linkMessage: 'Reconnecting to Hermes.', online: false, action: null })
  })

  it('offers Sign in on a signed-out link, which checks the live connection in the Settings already open', () => {
    expect(cardOf(AT_REST, { state: 'blocked', why: 'signed-out', message: 'Sign in to Hermes again.' }, false).summary)
      .toMatchObject({ linkMessage: 'Sign in to Hermes again.', action: { label: 'Sign in', run: [{ do: 'checkTarget', target: HOST }] } })
  })

  it('names a gateway by its host, with the address in mono when it says more', () => {
    const summaryFor = (url: string) => cardOf({ ...AT_REST, live: { target: { kind: 'url', url: url as GatewayUrl }, epoch: 1 } }, ONLINE, false).summary
    expect(summaryFor('https://hermes.example.com:8443')).toMatchObject({ kind: 'url', title: 'hermes.example.com', host: 'https://hermes.example.com:8443' })
  })

  it('keeps the mono line with no pill and no action while connecting, or before the link is known', () => {
    for (const link of [{ state: 'connecting', attempt: 1 } as const, undefined]) {
      expect(cardOf(AT_REST, link, false).summary).toMatchObject({ host: 'hermes-host.example-tailnet.ts.net', linkMessage: null, online: false, action: null })
    }
  })
})

describe('the editor in Settings', () => {
  it('opens on Change, from the live connection, with the note and a Cancel that folds it', () => {
    expect(cardOf(AT_REST, ONLINE, true).editor).toEqual({ seed: HOST, disabled: false, problem: null, foot: { show: 'note' }, cancel: 'fold' })
  })

  it('stays open and disabled while a check runs, with the step in the note\'s place and a Cancel that stops it', () => {
    const view = cardOf({ at: 'checking', live: LIVE, target: LAB, step: 'ssh' }, ONLINE, false)
    expect(view.editor).toEqual({ seed: LAB, disabled: true, problem: null, foot: { show: 'progress', words: 'Connecting to hermes-lab', hint: null }, cancel: 'stop' })
    expect(view.summary).toMatchObject({ title: 'hermes-host', online: true })
  })

  it('turns Cancel off while the connection is saved', () => {
    expect(cardOf({ at: 'checking', live: LIVE, target: LAB, step: 'save' }, ONLINE, false).editor)
      .toMatchObject({ disabled: true, foot: { show: 'progress', words: 'Saving this connection' }, cancel: 'saving' })
  })

  it('says why a check failed under the field, keeps the draft, and still shows the current connection online', () => {
    const view = cardOf({ at: 'failed', live: LIVE, target: LAB, failure: 'host-offline' }, ONLINE, false)
    expect(view.editor).toEqual({
      seed: LAB, disabled: false, foot: { show: 'note' }, cancel: 'stop',
      problem: { words: 'Your tailnet lists hermes-lab, but it is offline.', fix: 'Turn that machine on, or start Tailscale on it.' }
    })
    expect(view.summary).toMatchObject({ title: 'hermes-host', online: true })
  })

  it('folds on the new machine once a check passes, and says so', () => {
    const saved: CardSetup = { at: 'saved', live: { target: LAB, epoch: 2 }, from: 'settings' }
    expect(cardOf(saved, undefined, false)).toMatchObject({ summary: { title: 'hermes-lab', host: null }, editor: null, news: 'Highwing now uses the Hermes on hermes-lab.' })
    expect(cardOf(saved, undefined, true).editor).toMatchObject({ seed: LAB, cancel: 'fold' })
  })
})

describe('the editor on a first run', () => {
  it('is open with no summary, no note and no Cancel', () => {
    expect(cardOf({ at: 'form', live: null, notice: null }, undefined, false))
      .toEqual({ summary: null, editor: { seed: null, disabled: false, problem: null, foot: { show: 'nothing' }, cancel: null }, news: null })
  })

  it('puts the step in the empty slot while checking, and the failure under the field', () => {
    expect(cardOf({ at: 'checking', live: null, target: { kind: 'local' }, step: 'hermes' }, undefined, false).editor)
      .toMatchObject({ disabled: true, foot: { show: 'progress', words: 'Looking for Hermes on this computer' }, cancel: null })
    expect(cardOf({ at: 'failed', live: null, target: LAB, failure: 'host-not-found' }, undefined, false).editor)
      .toMatchObject({ foot: { show: 'nothing' }, cancel: null, problem: { words: 'No machine called hermes-lab is on your tailnet.' } })
  })

  it('draws the shared card with Tailnet machine picked, the machine field and Connect, and no Cancel', () => {
    const markup = renderToStaticMarkup(<ConnectionCard setup={{ at: 'form', live: null, notice: null }} link={undefined} />)
    expect(markup).toMatch(/<label><input type="radio" name="[^"]+" checked=""\/><svg[^]*?<\/svg>Tailnet machine<\/label>/)
    expect(markup).toContain('This computer</label>')
    expect(markup).toContain('placeholder="hermes-host"')
    expect(markup).toContain('Its Tailscale name. Add user@ in front to log in as someone else.')
    expect(Array.from(markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g), ([, name]) => name)).toEqual(['Connect'])
    expect(markup).not.toContain('Highwing keeps the current connection')
  })
})

const text = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')
const render = (setup: CardSetup) => renderToStaticMarkup(<ConnectionCard setup={setup} link={undefined} />)
const buttons = (markup: string) => [...markup.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(([, label]) => label)

describe('the card while a check waits for a sign-in', () => {
  const waiting = (live: Live | null): CardSetup => ({ at: 'checking', live, target: HOST, step: 'sign-in' })

  it('says under the step that the browser has the sign-in page, and that Highwing never sees the password', () => {
    expect(text(render(waiting(null)))).toContain(
      'Waiting for you to sign in to hermes-host in your browser Highwing opened the sign-in page in your browser. It never sees your password.'
    )
  })

  it('offers no Sign in in the row while a check runs, since the card runs one check at a time, and keeps Retry', () => {
    const signedOut: Link = { state: 'blocked', why: 'signed-out', message: 'Sign in to Hermes again.' }
    expect(cardOf(waiting(LIVE), signedOut, false).summary).toMatchObject({ linkMessage: 'Sign in to Hermes again.', action: null })
    expect(cardOf({ at: 'checking', live: LIVE, target: HOST, step: 'save' }, signedOut, false).summary).toMatchObject({ action: null })
    expect(cardOf(waiting(LIVE), { state: 'blocked', why: 'auth', message: 'Hermes turned Highwing away.' }, false).summary)
      .toMatchObject({ action: { label: 'Retry', run: [{ do: 'reconnect', start: false }] } })
  })

  it('offers Stop waiting on a first run, which ends the check, and in Settings the Cancel that goes back to the form', () => {
    expect(buttons(render(waiting(null)))).toEqual(['Stop waiting', 'Connect'])
    expect(cardOf(waiting(null), undefined, false).editor).toMatchObject({ cancel: 'stop-waiting' })
    expect(buttons(render(waiting(LIVE)))).toEqual(['Cancel', 'Connect'])
    expect(cardOf(waiting(LIVE), undefined, false).editor).toMatchObject({ cancel: 'stop' })
  })

  it('offers no way out of a first run\'s check at a step that waits for no one', () => {
    const markup = render({ at: 'checking', live: null, target: HOST, step: 'hermes' })
    expect(buttons(markup)).toEqual(['Connect'])
    expect(text(markup)).not.toContain('sign-in page')
  })
})

describe('the card for a gateway address', () => {
  const at = (url: string): Target => ({ kind: 'url', url: url as GatewayUrl })
  const segments = (markup: string) => [...markup.matchAll(/<label><input type="radio" name="[^"]+"( checked="")?\/><svg[^]*?<\/svg>([^<]*)<\/label>/g)]
    .map(([, checked, label]) => `${checked === undefined ? ' ' : 'x'} ${label}`)
  const fieldOf = (markup: string) => {
    const [, id, label] = /<label class="label" for="([^"]*)">([^<]*)<\/label>/.exec(markup)!
    return { label, input: new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(markup)![0] }
  }

  it('offers the three places Hermes can run, the tailnet first with its machine field', () => {
    const markup = render({ at: 'form', live: null, notice: null })
    expect(segments(markup)).toEqual(['x Tailnet machine', '  Web address', '  This computer'])
    expect(fieldOf(markup)).toMatchObject({ label: 'Hermes machine', input: expect.stringContaining('placeholder="hermes-host"') })
  })

  it('opens on the address being edited, in the Gateway address field', () => {
    const markup = render({ at: 'failed', live: null, target: at('https://hermes.example.com:8443'), failure: 'url-unreachable' })
    expect(segments(markup)[1]).toBe('x Web address')
    expect(fieldOf(markup)).toMatchObject({ label: 'Gateway address', input: expect.stringContaining('value="https://hermes.example.com:8443"') })
    expect(fieldOf(markup).input).toContain('placeholder="https://hermes.example.com"')
    expect(text(markup)).not.toContain('plain http')
  })

  it('warns under the field about a plain http address, and leaves Connect on', () => {
    const markup = render({ at: 'failed', live: LIVE, target: at('http://hermes.example.com:9120'), failure: 'url-unreachable' })
    const warning = /<p class="caution" id="([^"]*)" role="status">([^<]*)<\/p>/.exec(markup)!
    expect(warning[2]).toBe(
      'This address uses plain http, so your Hermes sign-in and your chats travel unencrypted. Anyone on the network between here and hermes.example.com could read them. Use https if you can.'
    )
    expect(fieldOf(markup).input).toContain(warning[1])
    expect(markup).toContain('<button type="submit" class="btn primary">Connect</button>')
  })

  it.each(Object.keys(URL_FAILURES) as UrlFailure[])('shows the words and the fix of a check that failed as %s', failure => {
    const markup = text(render({ at: 'failed', live: null, target: at('https://hermes.example.com'), failure }))
    expect(markup).toContain(URL_FAILURES[failure].words('hermes.example.com'))
    expect(markup).toContain(URL_FAILURES[failure].fix('hermes.example.com'))
  })
})
