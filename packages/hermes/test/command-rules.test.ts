import { describe, expect, it } from 'vitest'
import type { BotId } from '../src/domain/bots'
import { holdsEdit, parseCommandRules, RULE_KINDS, ruleOf, withEdit } from '../src/domain/rules'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type Fixture } from '../src/testing/fixture'
import { configCall, RuleBook } from '../src/testing/rules'
import { parseConfigStamp } from '../src/wire/parse'
import { callsIn, WITH_BOTS } from './support/errand'

const RULES = { allow: ['delete in root path', 'podman *'], deny: ['git push --force*', 'rm -rf /*'] }

async function launched(fixture: Fixture) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock })
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  return { hermes, script, calls: () => callsIn(script.received).filter(call => call.method === 'config.get') }
}

describe('configStamp through the hub', () => {
  it("reads the token of the socket's own profile with no session, and a bot's with its profile", async () => {
    const { hermes, calls } = await launched({ ...WITH_BOTS, header: { ...WITH_BOTS.header, rules: RULES } })
    const own = await hermes.run({ do: 'configStamp', bot: null })
    const bot = await hermes.run({ do: 'configStamp', bot: 'research' as BotId })
    expect([own.ok, bot.ok]).toEqual([true, true])
    expect(calls()).toEqual([
      { method: 'config.get', params: { key: 'mtime' } },
      { method: 'config.get', params: { key: 'mtime', profile: 'research' } }
    ])
  })

  it("changes a profile's token when a save reaches its config, and no other profile's", async () => {
    const { hermes, script } = await launched({ ...WITH_BOTS, header: { ...WITH_BOTS.header, rules: RULES } })
    const stamp = async (bot: string | null) => (await hermes.run({ do: 'configStamp', bot: bot as BotId | null }) as { value: string }).value
    const [before, otherBefore] = [await stamp('research'), await stamp('writer')]
    script.rules?.put('research', { command_allowlist: [] })
    expect(await stamp('research')).not.toBe(before)
    expect(await stamp('writer')).toBe(otherBefore)
  })

  it('is refused as unsupported by a Hermes that does not serve the config token', async () => {
    const { hermes } = await launched(WITH_BOTS)
    expect(await hermes.run({ do: 'configStamp', bot: null })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes doesn't support that." } })
  })
})

describe('parseConfigStamp', () => {
  it('turns the token into text, a missing file included, and refuses a reply with none', () => {
    expect(parseConfigStamp({ mtime: 1767225600.25 })).toBe('1767225600.25')
    expect(parseConfigStamp({ mtime: null, mcp_rev: 'x' })).toBe('null')
    expect(parseConfigStamp({})).toBeNull()
    expect(parseConfigStamp({ mtime: '1' } as never)).toBeNull()
  })
})

describe('parseCommandRules', () => {
  it("reads the two lists as Hermes does: trimmed, blanks and what is not text dropped, a repeat once", () => {
    expect(parseCommandRules({ command_allowlist: [' podman * ', '', 7, 'podman *', 'delete in root path'], approvals: { mode: 'manual', deny: ['  rm -rf /* ', null, '  '] } }, 'effective'))
      .toEqual({ allow: ['podman *', 'delete in root path'], deny: ['rm -rf /*'] })
  })

  it('reads a config that holds one list as having an empty other, and one that holds neither as no config', () => {
    expect(parseCommandRules({ command_allowlist: ['ls'] }, 'effective')).toEqual({ allow: ['ls'], deny: [] })
    expect(parseCommandRules({ approvals: { deny: ['ls'] } }, 'effective')).toEqual({ allow: [], deny: ['ls'] })
    for (const body of [{}, { approvals: { mode: 'smart' } }, { command_allowlist: null }, null, 'ls', [], 3]) expect(parseCommandRules(body, 'effective')).toBeNull()
  })

  it('reads a raw config that lacks a list as holding none of it, and a reply that is no object as no config', () => {
    expect(parseCommandRules({}, 'raw')).toEqual({ allow: [], deny: [] })
    expect(parseCommandRules({ approvals: { mode: 'smart' }, command_allowlist: null }, 'raw')).toEqual({ allow: [], deny: [] })
    expect(parseCommandRules({ approvals: { deny: ['ls'] } }, 'raw')).toEqual({ allow: [], deny: ['ls'] })
    for (const body of [null, 'ls', [], 3]) expect(parseCommandRules(body, 'raw')).toBeNull()
  })

  it.each(['effective', 'raw'] as const)('reads a %s list that is not a list as no config, so an edit never overwrites what it cannot read', source => {
    expect(parseCommandRules({ command_allowlist: 'ls' }, source)).toBeNull()
    expect(parseCommandRules({ command_allowlist: 'ls, cat', approvals: { deny: [] } }, source)).toBeNull()
    expect(parseCommandRules({ command_allowlist: ['ls'], approvals: { deny: 'rm -rf /*' } }, source)).toBeNull()
    expect(parseCommandRules({ command_allowlist: ['ls'], approvals: { deny: { a: 1 } } }, source)).toBeNull()
    expect(parseCommandRules({ command_allowlist: ['ls'], approvals: 'manual' }, source)).toBeNull()
  })
})

describe('the PUT body of each kind', () => {
  it('holds only the list, so a merge that replaces lists leaves approvals.mode and every other key alone', () => {
    expect(RULE_KINDS.allow.body(['a'])).toEqual({ command_allowlist: ['a'] })
    expect(RULE_KINDS.deny.body(['b'])).toEqual({ approvals: { deny: ['b'] } })
  })
})

describe('ruleOf', () => {
  it('trims a rule, and refuses no text and more than one line', () => {
    expect(ruleOf('  podman *  ')).toBe('podman *')
    for (const text of ['', '   ', '\n', 'rm -rf /\ncurl x', 'a\rb']) expect(ruleOf(text)).toBeNull()
  })
})

describe('withEdit and holdsEdit', () => {
  const rules = ['a', 'b']

  it('adds a rule once, and drops every exact match of a removed one', () => {
    expect(withEdit(rules, { change: 'add', kind: 'allow', rule: 'c' })).toEqual(['a', 'b', 'c'])
    expect(withEdit(rules, { change: 'add', kind: 'allow', rule: 'a' })).toBe(rules)
    expect(withEdit(rules, { change: 'remove', kind: 'allow', rule: 'a' })).toEqual(['b'])
    expect(withEdit(rules, { change: 'remove', kind: 'allow', rule: 'A' }), 'a rule is removed by its exact text').toBe(rules)
    expect(withEdit(['a', 'x', 'a'], { change: 'remove', kind: 'deny', rule: 'a' })).toEqual(['x'])
  })

  it('says whether a list is what the edit asks for', () => {
    const held = { allow: ['a'], deny: [] }
    expect(holdsEdit(held, { change: 'add', kind: 'allow', rule: 'a' })).toBe(true)
    expect(holdsEdit(held, { change: 'add', kind: 'deny', rule: 'a' })).toBe(false)
    expect(holdsEdit(held, { change: 'remove', kind: 'deny', rule: 'a' })).toBe(true)
    expect(holdsEdit(held, { change: 'remove', kind: 'allow', rule: 'a' })).toBe(false)
  })
})

describe('the fake config of a profile', () => {
  const get = (book: RuleBook | null, profile: string | null = null) => configCall(book, { method: 'GET', path: '/api/config', profile })
  const put = (book: RuleBook | null, config: unknown, profile: string | null = null) => configCall(book, { method: 'PUT', path: '/api/config', profile, json: { config } })

  it('answers the lists with approvals.mode and the rest of the config, as the real route does', () => {
    const book = new RuleBook(RULES, 'default')
    expect(get(book)).toEqual({ status: 200, body: { command_allowlist: RULES.allow, approvals: { mode: 'manual', deny: RULES.deny }, display: { language: 'en' } } })
  })

  it('replaces a list a PUT names, keeps every key it does not, and changes the token', () => {
    const book = new RuleBook(RULES, 'default')
    const before = book.stamp(null)
    expect(put(book, { approvals: { deny: ['git *'] } })).toEqual({ status: 200, body: { ok: true } })
    expect(get(book)?.body).toEqual({ command_allowlist: RULES.allow, approvals: { mode: 'manual', deny: ['git *'] }, display: { language: 'en' } })
    expect(book.stamp(null)).toBeGreaterThan(before)
  })

  it('keeps each profile its own, and a request that names none is for the home profile', () => {
    const book = new RuleBook(RULES, 'default')
    put(book, { command_allowlist: [] }, 'ada')
    expect((get(book, 'ada')?.body as { command_allowlist: string[] }).command_allowlist).toEqual([])
    expect((get(book, 'default')?.body as { command_allowlist: string[] }).command_allowlist).toEqual(RULES.allow)
    expect((get(book)?.body as { command_allowlist: string[] }).command_allowlist).toEqual(RULES.allow)
  })

  it('takes no save, and says nothing, when the header says the install is managed', () => {
    const book = new RuleBook({ ...RULES, locked: true }, 'default')
    const before = book.stamp(null)
    expect(put(book, { command_allowlist: [] })).toEqual({ status: 200, body: { ok: true } })
    expect((get(book)?.body as { command_allowlist: string[] }).command_allowlist).toEqual(RULES.allow)
    expect(book.stamp(null)).toBe(before)
  })

  it('answers 404 with no rules in the header, 422 for a PUT with no config, 405 for another method, and null for another path', () => {
    expect(get(null)).toMatchObject({ status: 404 })
    expect(put(null, {})).toMatchObject({ status: 404 })
    const book = new RuleBook(RULES, 'default')
    expect(configCall(book, { method: 'PUT', path: '/api/config', profile: null, json: {} })).toMatchObject({ status: 422 })
    expect(configCall(book, { method: 'DELETE', path: '/api/config', profile: null })).toMatchObject({ status: 405 })
    expect(configCall(book, { method: 'GET', path: '/api/status', profile: null })).toBeNull()
  })
})
