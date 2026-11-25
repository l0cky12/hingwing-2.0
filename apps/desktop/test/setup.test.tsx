import type { SshHost, Target } from '@highwing/hermes/domain'
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
