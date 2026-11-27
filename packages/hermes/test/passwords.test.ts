import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { maskedFrame, scriptedDialer, type Fixture, type VaultScript } from '../src/testing/fixture'
import { parseBotManagers } from '../src/wire/parse'
import { BOUND, callsIn, WITH_BOTS } from './support/errand'

const EMU = 'default' as BotId
const RESEARCH = 'research' as BotId
const MASTER = 'correct horse battery staple'
const VAULT: VaultScript = {
  default: {
    onepassword: { installed: true, enabled: false },
    bitwarden: { installed: true, password: MASTER, logins: ['github.com', 'news.ycombinator.com', 'mail.proton.me'] }
  },
  research: { onepassword: { installed: true, token: true, logins: ['aws.amazon.com', 'cloud.google.com'] } }
}
const WITH_VAULT: Fixture = { ...WITH_BOTS, header: { ...WITH_BOTS.header, vault: VAULT } }
const UNSUPPORTED = { ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't set up password managers from Highwing." } }

const row = (name: string, facts: { installed: boolean; enabled: boolean; unlocked: boolean }) => ({ name, display_name: name, needs_unlock: true, ...facts })

describe('parseBotManagers', () => {
  it('maps each row to the one state its next step depends on', () => {
    const sources = {
      sources: [
        row('onepassword', { installed: false, enabled: false, unlocked: false }),
        row('bitwarden', { installed: true, enabled: false, unlocked: false })
      ]
    }
    expect(parseBotManagers(EMU, sources, {}).managers.map(manager => manager.state)).toEqual([{ at: 'missing' }, { at: 'off' }])
    const on = { sources: [row('onepassword', { installed: true, enabled: true, unlocked: false }), row('bitwarden', { installed: true, enabled: true, unlocked: true })] }
    expect(parseBotManagers(EMU, on, {}).managers.map(manager => manager.state)).toEqual([{ at: 'locked' }, { at: 'ready', logins: 0 }])
  })

  it("counts only the unlocked manager's own logins, and leaves out Hermes's vault and managers Highwing does not know", () => {
    const sources = {
      sources: [
        { name: 'local', display_name: 'Hermes vault', enabled: true, needs_unlock: false, unlocked: true, installed: true },
        row('bitwarden', { installed: true, enabled: true, unlocked: true }),
        row('keeper', { installed: true, enabled: true, unlocked: true }),
        row('onepassword', { installed: true, enabled: true, unlocked: true })
      ]
    }
    const items = ['local', 'bitwarden', 'bitwarden', 'keeper', 'onepassword'].map((backend, at) => ({ id: String(at), kind: 'login', label: 'x', backend }))
    expect(parseBotManagers(EMU, sources, { items })).toEqual({
      bot: 'default',
      managers: [
        { name: 'onepassword', label: '1Password', state: { at: 'ready', logins: 1 } },
        { name: 'bitwarden', label: 'Bitwarden', state: { at: 'ready', logins: 2 } }
      ]
    })
  })

  it('lists no manager from a reply with no rows, or rows it cannot read', () => {
    expect(parseBotManagers(EMU, {}, {}).managers).toEqual([])
    expect(parseBotManagers(EMU, { sources: [null, 'bitwarden'] as never }, { items: 'none' as never }).managers).toEqual([])
  })
})

async function launched(fixture: Fixture) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock })
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  const vaultCalls = () => callsIn(script.received).filter(call => call.method.startsWith('vault.'))
  return { hermes, vaultCalls, received: script.received }
}

const states = (outcome: unknown) => (outcome as { value: { managers: { name: string; state: unknown }[] } }).value.managers.map(({ name, state }) => [name, state])

describe('password managers through the hub', () => {
  it("reads each bot's own managers, every call naming its profile", async () => {
    const { hermes, vaultCalls } = await launched(WITH_VAULT)
    expect(states(await hermes.run({ do: 'passwordManagers', bot: EMU }))).toEqual([['onepassword', { at: 'off' }], ['bitwarden', { at: 'locked' }]])
    expect(states(await hermes.run({ do: 'passwordManagers', bot: RESEARCH }))).toEqual([['onepassword', { at: 'ready', logins: 2 }], ['bitwarden', { at: 'missing' }]])
    expect(vaultCalls(), 'logins are listed only for a bot with an unlocked manager').toEqual([
      { method: 'vault.sources', params: { profile: 'default' } },
      { method: 'vault.sources', params: { profile: 'research' } },
      { method: 'vault.list', params: { profile: 'research' } }
    ])
  })

  it('turns a manager on, unlocks it after a wrong password, locks it and stops using it, answering the fresh state each time', async () => {
    const { hermes } = await launched(WITH_VAULT)
    expect(states(await hermes.run({ do: 'usePasswordManager', bot: EMU, manager: 'onepassword', use: true }))[0]).toEqual(['onepassword', { at: 'locked' }])
    expect(await hermes.run({ do: 'unlockPasswordManager', bot: EMU, manager: 'bitwarden', password: 'hunter2' }))
      .toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Bitwarden unlock failed: Invalid master password.' } })
    expect(states(await hermes.run({ do: 'unlockPasswordManager', bot: EMU, manager: 'bitwarden', password: MASTER }))[1]).toEqual(['bitwarden', { at: 'ready', logins: 3 }])
    expect(states(await hermes.run({ do: 'passwordManagers', bot: RESEARCH }))[0], "one bot's unlock leaves another's managers as they were").toEqual(['onepassword', { at: 'ready', logins: 2 }])
    expect(states(await hermes.run({ do: 'lockPasswordManager', bot: EMU, manager: 'bitwarden' }))[1]).toEqual(['bitwarden', { at: 'locked' }])
    await hermes.run({ do: 'unlockPasswordManager', bot: EMU, manager: 'bitwarden', password: MASTER })
    expect(states(await hermes.run({ do: 'usePasswordManager', bot: EMU, manager: 'bitwarden', use: false }))[1]).toEqual(['bitwarden', { at: 'off' }])
    expect(states(await hermes.run({ do: 'usePasswordManager', bot: EMU, manager: 'bitwarden', use: true }))[1], 'stopping locks it').toEqual(['bitwarden', { at: 'locked' }])
  })

  it('leaves a manager held open by a service account token unlocked through a lock, and off once stopped', async () => {
    const { hermes } = await launched(WITH_VAULT)
    expect(states(await hermes.run({ do: 'lockPasswordManager', bot: RESEARCH, manager: 'onepassword' }))[0]).toEqual(['onepassword', { at: 'ready', logins: 2 }])
    expect(states(await hermes.run({ do: 'usePasswordManager', bot: RESEARCH, manager: 'onepassword', use: false }))[0]).toEqual(['onepassword', { at: 'off' }])
  })

  it('keeps every state and its controls when Hermes cannot list the logins', async () => {
    const revoked: Fixture = { ...WITH_BOTS, header: { ...WITH_BOTS.header, vault: { research: { onepassword: { installed: true, token: true, listFails: 'op failed: invalid token' } } } } }
    const { hermes } = await launched(revoked)
    expect(states(await hermes.run({ do: 'passwordManagers', bot: RESEARCH }))[0]).toEqual(['onepassword', { at: 'ready', logins: null }])
    expect(states(await hermes.run({ do: 'usePasswordManager', bot: RESEARCH, manager: 'onepassword', use: false }))[0]).toEqual(['onepassword', { at: 'off' }])
  })

  it("refuses an unlock of a manager that is off in Hermes's words", async () => {
    const { hermes } = await launched(WITH_VAULT)
    expect(await hermes.run({ do: 'unlockPasswordManager', bot: EMU, manager: 'onepassword', password: MASTER }))
      .toEqual({ ok: false, refusal: { kind: 'rejected', message: 'onepassword is not an enabled password manager' } })
  })

  it('is unsupported on a Hermes without the calls, and on a socket with no interactive grant', async () => {
    for (const fixture of [WITH_BOTS, { ...BOUND, header: { ...BOUND.header, vault: VAULT } }]) {
      const { hermes } = await launched(fixture)
      expect(await hermes.run({ do: 'passwordManagers', bot: EMU })).toEqual(UNSUPPORTED)
      expect(await hermes.run({ do: 'unlockPasswordManager', bot: EMU, manager: 'bitwarden', password: MASTER })).toEqual(UNSUPPORTED)
    }
  })

  it('keeps the master password out of a logged frame', async () => {
    const { hermes, received } = await launched(WITH_VAULT)
    await hermes.run({ do: 'unlockPasswordManager', bot: EMU, manager: 'bitwarden', password: MASTER })
    const logged = JSON.stringify(received.map(maskedFrame))
    expect(logged).toContain('"method":"vault.unlock"')
    expect(logged).not.toContain(MASTER)
  })
})
