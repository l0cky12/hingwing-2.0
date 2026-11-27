import type { Bot, BotId, Link, Manager, ManagerState } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { NONE_LISTED, NOT_CONNECTED, readOf, saysOf, sectionOf } from '../src/renderer/setup/managers-view'

vi.mock('../src/renderer/store', () => ({ Epoch: {}, run: async () => ({ ok: true, value: undefined }), useTopic: () => undefined }))

const { ManagerRow } = await import('../src/renderer/setup/PasswordManagers')

const EMU: Bot = { id: 'default' as BotId, name: 'Emu', preview: null, description: null, tone: 'ink', picture: false, pinned: false, hidden: false }
const ONLINE = { state: 'online' } as Link
const bitwarden = (state: ManagerState): Manager => ({ name: 'bitwarden', label: 'Bitwarden', state })
const onepassword = (state: ManagerState): Manager => ({ name: 'onepassword', label: '1Password', state })
const row = (manager: Manager, problem: string | null = null) =>
  renderToStaticMarkup(<ManagerRow manager={manager} bot={EMU} busy={false} anyBusy={false} problem={problem} onChange={() => {}} onCheck={() => {}} />)
const controls = (html: string) => Array.from(html.matchAll(/<(?:button|a)[^>]*aria-label="([^"]*)"/g), ([, label]) => label)

describe('a password manager row', () => {
  it('offers the one next step its state needs', () => {
    expect(controls(row(bitwarden({ at: 'missing' })))).toEqual(['How to install Bitwarden', 'Check for Bitwarden again'])
    expect(controls(row(bitwarden({ at: 'off' })))).toEqual(['Use Bitwarden with Emu'])
    expect(controls(row(bitwarden({ at: 'locked' })))).toEqual(['Stop using Bitwarden', 'Unlock Bitwarden'])
    expect(controls(row(bitwarden({ at: 'ready', logins: 3 })))).toEqual(['Lock Bitwarden', 'Stop using Bitwarden'])
  })

  it("links to the manager's own install page", () => {
    expect(row(onepassword({ at: 'missing' }))).toContain('href="https://developer.1password.com/docs/cli/get-started/"')
    expect(row(bitwarden({ at: 'missing' }))).toContain('href="https://bitwarden.com/help/cli/"')
  })

  it('asks for the master password in a field nothing fills or keeps, with the one-time step for that bot under it', () => {
    const html = row(onepassword({ at: 'locked' }))
    const field = /<input[^>]*>/.exec(html)![0]
    expect(field).toContain('type="password"')
    expect(field).toContain('autoComplete="off"')
    expect(html).toContain('<code>hermes -p default secrets onepassword token</code>')
    expect(row(bitwarden({ at: 'locked' }))).toContain('<code>bw login --apikey</code>')
  })

  it("shows Hermes's words for a failed change as an alert", () => {
    expect(row(bitwarden({ at: 'locked' }), 'Bitwarden unlock failed: Invalid master password.')).toContain('role="alert">Bitwarden unlock failed: Invalid master password.</p>')
  })
})

describe('what a manager says', () => {
  it('names the bot and counts its logins', () => {
    expect(saysOf({ at: 'missing' }, 'Emu')).toBe('Not installed on the Hermes machine.')
    expect(saysOf({ at: 'off' }, 'Emu')).toBe('Off for Emu.')
    expect(saysOf({ at: 'ready', logins: 1 }, 'Emu')).toBe('Unlocked · 1 login Emu can use')
    expect(saysOf({ at: 'ready', logins: 3 }, 'Emu')).toBe('Unlocked · 3 logins Emu can use')
    expect(saysOf({ at: 'ready', logins: null }, 'Emu')).toBe("Unlocked, but Hermes couldn't list its logins.")
  })
})

describe('the password managers card', () => {
  const managers = { bot: EMU.id, managers: [bitwarden({ at: 'off' })] }

  it('asks the user to connect before anything else', () => {
    expect(sectionOf({ state: 'blocked', why: 'hermes-missing', message: 'x' }, true, { at: 'read', managers })).toEqual({ show: 'note', words: NOT_CONNECTED })
    expect(sectionOf(undefined, true, { at: 'reading' })).toEqual({ show: 'note', words: NOT_CONNECTED })
  })

  it('says a Hermes without the calls cannot, and offers another try for any other refusal', () => {
    expect(sectionOf(ONLINE, true, readOf({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't set up password managers from Highwing." } })))
      .toEqual({ show: 'note', words: "This Hermes can't set up password managers from Highwing." })
    expect(sectionOf(ONLINE, true, readOf({ ok: false, refusal: { kind: 'rejected', message: 'op failed' } }))).toEqual({ show: 'failed', words: 'op failed' })
  })

  it("shows the managers Hermes listed, or says it listed none", () => {
    expect(sectionOf(ONLINE, true, readOf({ ok: true, value: managers }))).toEqual({ show: 'managers', managers })
    expect(sectionOf(ONLINE, true, readOf({ ok: true, value: { bot: EMU.id, managers: [] } }))).toEqual({ show: 'note', words: NONE_LISTED })
  })
})
