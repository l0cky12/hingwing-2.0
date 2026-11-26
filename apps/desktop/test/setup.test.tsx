import { URL_FAILURES, type GatewayUrl, type SshHost, type Target, type UrlFailure } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Live, Setup } from '../src/ipc-contract'
import { SetupForm } from '../src/renderer/setup/Setup'

type Editing = Extract<Setup, { at: 'form' | 'checking' | 'failed' }>

const REMOTE: Target = { kind: 'remote', host: 'hermes-host.example-tailnet.ts.net' as SshHost }
const LIVE: Live = { target: { kind: 'local' }, epoch: 1 }

const text = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')
const render = (setup: Editing) => renderToStaticMarkup(<SetupForm setup={setup} />)
const buttons = (markup: string) => [...markup.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(([, label]) => label)

describe('the setup screen while a check waits for a sign-in', () => {
  const waiting = (live: Live | null): Editing => ({ at: 'checking', live, target: REMOTE, step: 'sign-in' })

  it('says the browser has the sign-in page, and that Highwing never sees the password', () => {
    expect(text(render(waiting(null)))).toContain(
      'Waiting for you to sign in to hermes-host in your browser Highwing opened the sign-in page in your browser. It never sees your password.'
    )
  })

  it('offers Stop waiting on a first run, and Cancel when a chat is there to go back to', () => {
    expect(buttons(render(waiting(null)))).toEqual(['Connect', 'Stop waiting'])
    expect(buttons(render(waiting(LIVE)))).toEqual(['Connect', 'Cancel'])
  })

  it('offers no way out of a first run\'s check at a step that waits for no one', () => {
    const markup = render({ at: 'checking', live: null, target: REMOTE, step: 'hermes' })
    expect(buttons(markup)).toEqual(['Connect'])
    expect(text(markup)).not.toContain('sign-in page')
  })
})

describe('the setup screen for a gateway address', () => {
  const at = (url: string): Target => ({ kind: 'url', url: url as GatewayUrl })
  const fieldOf = (markup: string, label: string) => {
    const id = new RegExp(`<label for="([^"]*)">${label}</label>`).exec(markup)![1]!
    const input = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(markup)![0]
    return { input, shown: !new RegExp(`<div class="field" hidden=""><label for="${id}"`).test(markup) }
  }
  const choices = (markup: string) => [...markup.matchAll(/<label class="choice"><input type="radio" name="kind"( checked="")?[^>]*>([^<]*)<\/label>/g)]
    .map(([, checked, label]) => `${checked === undefined ? ' ' : 'x'} ${label}`)

  it('offers the three places Hermes can run, with a field of its own for the machine and for the address', () => {
    const markup = render({ at: 'form', live: null, notice: null })
    expect(choices(markup)).toEqual(['x Another machine on my tailnet', '  A Hermes gateway at a web address', '  This computer'])
    expect(fieldOf(markup, 'Hermes machine').shown).toBe(true)
    expect(fieldOf(markup, 'Gateway address')).toMatchObject({ shown: false, input: expect.stringContaining('placeholder="https://hermes.example.com"') })
    expect(fieldOf(markup, 'Gateway address').input).not.toBe(fieldOf(markup, 'Hermes machine').input)
  })

  it('opens on the address being edited, with the machine field empty', () => {
    const markup = render({ at: 'form', live: { target: at('https://hermes.example.com:8443'), epoch: 1 }, notice: null })
    expect(choices(markup)[1]).toBe('x A Hermes gateway at a web address')
    expect(fieldOf(markup, 'Gateway address')).toMatchObject({ shown: true, input: expect.stringContaining('value="https://hermes.example.com:8443"') })
    expect(fieldOf(markup, 'Hermes machine').input).toContain('value=""')
    expect(text(markup)).not.toContain('plain http')
  })

  it('warns under the field about a plain http address, and leaves Connect on', () => {
    const markup = render({ at: 'form', live: { target: at('http://hermes.example.com:9120'), epoch: 1 }, notice: null })
    const warning = /<p id="([^"]*)" class="caution" role="status">([^<]*)<\/p>/.exec(markup)!
    expect(warning[2]).toBe(
      'This address uses plain http, so your Hermes sign-in and your chats travel unencrypted. Anyone on the network between here and hermes.example.com could read them. Use https if you can.'
    )
    expect(fieldOf(markup, 'Gateway address').input).toContain(warning[1])
    expect(markup).toContain('<button type="submit" class="primary">Connect</button>')
  })

  it.each(Object.keys(URL_FAILURES) as UrlFailure[])('shows the words and the fix of a check that failed as %s', failure => {
    const markup = text(render({ at: 'failed', live: null, target: at('https://hermes.example.com'), failure }))
    expect(markup).toContain(URL_FAILURES[failure].words('hermes.example.com'))
    expect(markup).toContain(URL_FAILURES[failure].fix('hermes.example.com'))
  })
})
