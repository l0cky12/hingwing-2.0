import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type Fixture } from '../src/testing/fixture'
import { parseDenyRules } from '../src/wire/parse'
import { callsIn, WITH_BOTS } from './support/errand'

const DENY = ['git push --force*', 'rm -rf /*']

async function launched(fixture: Fixture) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock })
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  return { hermes, calls: () => callsIn(script.received).filter(call => call.method === 'config.get') }
}

describe('denyRules through the hub', () => {
  it("reads approvals.deny from the socket's own profile with no session, and a bot's with its profile", async () => {
    const { hermes, calls } = await launched({ ...WITH_BOTS, header: { ...WITH_BOTS.header, deny: DENY } })
    expect(await hermes.run({ do: 'denyRules', bot: null })).toEqual({ ok: true, value: DENY })
    expect(await hermes.run({ do: 'denyRules', bot: 'research' as BotId })).toEqual({ ok: true, value: DENY })
    expect(calls()).toEqual([
      { method: 'config.get', params: { key: 'full' } },
      { method: 'config.get', params: { key: 'full', profile: 'research' } }
    ])
  })

  it('is refused as unsupported by a Hermes that does not serve the full config', async () => {
    const { hermes } = await launched(WITH_BOTS)
    expect(await hermes.run({ do: 'denyRules', bot: null })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes doesn't support that." } })
  })
})

describe('parseDenyRules', () => {
  it('keeps the globs as Hermes matches them: trimmed, blanks and non-strings dropped', () => {
    expect(parseDenyRules({ config: { approvals: { deny: [' git push --force* ', '', '  ', 7, null, 'rm -rf /*'] } } })).toEqual(DENY)
  })

  it('reads a config with no approvals, or no deny list, as no rules', () => {
    expect(parseDenyRules({ config: { display: {} } })).toEqual([])
    expect(parseDenyRules({ config: { approvals: { mode: 'smart' } } })).toEqual([])
    expect(parseDenyRules({ config: { approvals: { deny: 'git push --force*' } } })).toEqual([])
    expect(parseDenyRules({})).toEqual([])
  })
})
