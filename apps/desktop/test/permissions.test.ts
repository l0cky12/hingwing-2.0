import { TicketRefused, type CallHermes, type HermesAsk, type HttpAnswer } from '@highwing/hermes'
import type { BotId, RuleEdit } from '@highwing/hermes/domain'
import { fixtureCall, RuleBook } from '@highwing/hermes/testing'
import { describe, expect, it } from 'vitest'
import { editCommandRule, readCommandRules } from '../src/main/permissions'

const ADA = 'ada' as BotId
const CONFIG = (allow: readonly string[], deny: readonly string[]): HttpAnswer => ({ status: 200, body: { command_allowlist: allow, approvals: { mode: 'manual', deny } } })

type Reply = HttpAnswer | Error

/** Answers each call from the next of `replies`, and keeps what was asked. */
function scripted(...replies: readonly Reply[]) {
  const asked: HermesAsk[] = []
  const left = [...replies]
  const call: CallHermes = async ask => {
    asked.push(ask)
    const reply = left.shift()
    if (reply === undefined) throw new Error(`no reply is scripted for call ${asked.length}`)
    if (reply instanceof Error) throw reply
    return reply
  }
  return { call, asked }
}

const OFFLINE = { kind: 'offline', message: "Highwing couldn't reach Hermes to read its command rules." }
const UNSURE = { kind: 'offline', message: "Highwing couldn't tell whether Hermes saved that change." }
const OFFLINE_EDIT = { kind: 'offline', message: "Highwing couldn't reach Hermes, so it didn't change the rule." }
const UNSUPPORTED = { kind: 'unsupported', message: "This Hermes can't show its command rules to Highwing. Update Hermes, then try again." }
const UNREADABLE = { kind: 'unsupported', message: "Hermes answered with command rules Highwing can't read." }
const NOT_SAVED = { kind: 'rejected', message: "Hermes didn't save that change. An administrator may manage this setting." }
const GET = (profile: string | null): HermesAsk => ({ method: 'GET', path: '/api/config', profile })
const RAW = (profile: string | null): HermesAsk => ({ method: 'GET', path: '/api/config?include_defaults=false', profile })
const PUT = (profile: string | null, config: object): HermesAsk => ({ method: 'PUT', path: '/api/config', profile, json: { config } })
const SAVED: HttpAnswer = { status: 200, body: { ok: true } }

describe('readCommandRules', () => {
  it("reads both lists of the bot's config, asking for that bot", async () => {
    const { call, asked } = scripted(CONFIG(['podman *'], [' rm -rf /* ', '']))
    expect(await readCommandRules(call, ADA)).toEqual({ ok: true, value: { allow: ['podman *'], deny: ['rm -rf /*'] } })
    expect(asked).toEqual([GET('ada')])
  })

  it("asks for the connection's own profile with no bot", async () => {
    const { call, asked } = scripted(CONFIG([], []))
    await readCommandRules(call, null)
    expect(asked).toEqual([GET(null)])
  })

  it.each<[string, Reply, object]>([
    ['a 404', { status: 404, body: { detail: 'Not Found' } }, UNSUPPORTED],
    ['a 405', { status: 405, body: null }, UNSUPPORTED],
    ['a 403 for a ticket of another profile', { status: 403, body: { detail: 'profile_scope_mismatch' } }, UNSUPPORTED],
    ['a ticket Hermes would not mint for a profile', new TicketRefused('invalid_request'), UNSUPPORTED],
    ['a Hermes that mints no HTTP ticket', new TicketRefused('unsupported_purpose'), UNSUPPORTED],
    ['a profile Hermes does not serve', new TicketRefused('profile_not_served'), OFFLINE],
    ['no gateway to ask for a ticket', new TicketRefused(null), OFFLINE],
    ['a request that failed', new Error('connect ECONNREFUSED'), OFFLINE],
    ['a 500', { status: 500, body: { detail: 'Internal server error' } }, OFFLINE],
    ['a 401', { status: 401, body: { detail: 'Unauthorized' } }, OFFLINE],
    ['a reply that is not JSON', { status: 200, body: null }, UNREADABLE],
    ['a reply with neither list', { status: 200, body: { model: 'x' } }, UNREADABLE]
  ])('refuses on %s', async (_what, reply, refusal) => {
    expect(await readCommandRules(scripted(reply).call, ADA)).toEqual({ ok: false, refusal })
  })
})

describe('editCommandRule', () => {
  const add = (kind: RuleEdit['kind'], rule: string): RuleEdit => ({ change: 'add', kind, rule })
  const remove = (kind: RuleEdit['kind'], rule: string): RuleEdit => ({ change: 'remove', kind, rule })

  it('reads, writes only the allow list with the rule added, reads again, and answers what Hermes holds', async () => {
    const { call, asked } = scripted(CONFIG(['podman *'], ['rm -rf /*']), { status: 200, body: { ok: true } }, CONFIG(['podman *', 'ls'], ['rm -rf /*']))
    expect(await editCommandRule(call, ADA, add('allow', 'ls'))).toEqual({ ok: true, value: { allow: ['podman *', 'ls'], deny: ['rm -rf /*'] } })
    expect(asked, 'the file is read raw, and what Hermes holds afterwards is read as it runs by it').toEqual([RAW('ada'), PUT('ada', { command_allowlist: ['podman *', 'ls'] }), GET('ada')])
  })

  it('writes only approvals.deny for a deny rule, so approvals.mode and the other list are not in the body', async () => {
    const { call, asked } = scripted(CONFIG(['podman *'], []), { status: 200, body: { ok: true } }, CONFIG(['podman *'], ['git push --force*']))
    await editCommandRule(call, null, add('deny', 'git push --force*'))
    expect(asked[1]).toEqual(PUT(null, { approvals: { deny: ['git push --force*'] } }))
  })

  it('removes the rule from its list, and from no other', async () => {
    const { call, asked } = scripted(CONFIG(['ls', 'cat'], ['ls']), { status: 200, body: { ok: true } }, CONFIG(['cat'], ['ls']))
    expect(await editCommandRule(call, ADA, remove('allow', 'ls'))).toEqual({ ok: true, value: { allow: ['cat'], deny: ['ls'] } })
    expect(asked[1]?.json).toEqual({ config: { command_allowlist: ['cat'] } })
  })

  it('trims the rule before it is written', async () => {
    const { call, asked } = scripted(CONFIG([], []), { status: 200, body: { ok: true } }, CONFIG(['ls'], []))
    await editCommandRule(call, ADA, add('allow', '  ls \t'))
    expect(asked[1]?.json).toEqual({ config: { command_allowlist: ['ls'] } })
  })

  it('writes nothing for an add of a rule the list holds, and for a remove of one it lacks', async () => {
    const held = scripted(CONFIG(['ls'], []), CONFIG(['ls'], []))
    expect(await editCommandRule(held.call, ADA, add('allow', 'ls'))).toEqual({ ok: true, value: { allow: ['ls'], deny: [] } })
    expect(held.asked, 'it answers with the config as it runs, and sends no save').toEqual([RAW('ada'), GET('ada')])
    const lacking = scripted(CONFIG(['ls'], []), CONFIG(['ls'], []))
    expect(await editCommandRule(lacking.call, ADA, remove('deny', 'ls'))).toEqual({ ok: true, value: { allow: ['ls'], deny: [] } })
    expect(lacking.asked).toEqual([RAW('ada'), GET('ada')])
  })

  it.each(['', '   ', 'rm -rf /\ncurl x.example'])('refuses %j before any call', async rule => {
    const { call, asked } = scripted()
    expect(await editCommandRule(call, ADA, add('deny', rule))).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'A rule is one line of text.' } })
    expect(asked).toEqual([])
  })

  it('says Hermes did not save it when the second read lacks the edit, as a managed install leaves it', async () => {
    const { call } = scripted(CONFIG([], []), { status: 200, body: { ok: true } }, CONFIG([], []))
    expect(await editCommandRule(call, ADA, add('allow', 'ls'))).toEqual({ ok: false, refusal: NOT_SAVED })
    const removing = scripted(CONFIG(['ls'], []), { status: 200, body: { ok: true } }, CONFIG(['ls'], []))
    expect(await editCommandRule(removing.call, ADA, remove('allow', 'ls'))).toEqual({ ok: false, refusal: NOT_SAVED })
  })

  it('says so when Hermes refuses the save, and reaches no further', async () => {
    for (const status of [500, 403, 422]) {
      const { call, asked } = scripted(CONFIG([], []), { status, body: { detail: 'no' } })
      expect(await editCommandRule(call, ADA, add('allow', 'ls'))).toEqual({ ok: false, refusal: NOT_SAVED })
      expect(asked, `a ${status} is not read again`).toHaveLength(2)
    }
  })

  it('says the Hermes cannot when the save finds no route, or no ticket for the bot', async () => {
    expect(await editCommandRule(scripted(CONFIG([], []), { status: 405, body: null }).call, ADA, add('allow', 'ls'))).toEqual({ ok: false, refusal: UNSUPPORTED })
    expect(await editCommandRule(scripted(CONFIG([], []), new TicketRefused('invalid_request')).call, ADA, add('allow', 'ls'))).toEqual({ ok: false, refusal: UNSUPPORTED })
  })

  it('says it changed nothing when the first read cannot reach Hermes', async () => {
    const first = scripted(new Error('down'))
    expect(await editCommandRule(first.call, ADA, add('allow', 'ls'))).toEqual({ ok: false, refusal: OFFLINE_EDIT })
    expect(first.asked).toEqual([RAW('ada')])
  })

  it("says it could not tell whether Hermes saved when the save got no answer, and when the read after a save that Hermes took failed", async () => {
    const save = scripted(CONFIG([], []), new Error('socket hang up'))
    expect(await editCommandRule(save.call, ADA, add('allow', 'ls'))).toEqual({ ok: false, refusal: UNSURE })
    for (const after of [new Error('down'), { status: 500, body: null }, { status: 404, body: null }, { status: 200, body: 'ls' }] as const) {
      const { call } = scripted(CONFIG([], []), SAVED, after)
      expect(await editCommandRule(call, ADA, add('allow', 'ls')), JSON.stringify(after)).toEqual({ ok: false, refusal: UNSURE })
    }
  })

  it('refuses without a save when the first read is refused', async () => {
    const { call, asked } = scripted({ status: 404, body: null })
    expect(await editCommandRule(call, ADA, add('allow', 'ls'))).toEqual({ ok: false, refusal: UNSUPPORTED })
    expect(asked).toHaveLength(1)
  })

  it('reads a file that holds neither list as two empty ones, and writes the one list the edit names', async () => {
    const { call, asked } = scripted({ status: 200, body: {} }, SAVED, CONFIG(['ls'], []))
    expect(await editCommandRule(call, ADA, add('allow', 'ls'))).toEqual({ ok: true, value: { allow: ['ls'], deny: [] } })
    expect(asked).toEqual([RAW('ada'), PUT('ada', { command_allowlist: ['ls'] }), GET('ada')])
  })

  it('builds the new list on the file, not on the config Hermes runs by, so a template the file keeps is not written back expanded', async () => {
    const { call, asked } = scripted(CONFIG(['${HOME}/bin/*', 'cat'], []), SAVED, CONFIG(['/home/ada/bin/*'], []))
    await editCommandRule(call, ADA, remove('allow', 'cat'))
    expect(asked[0]).toEqual(RAW('ada'))
    expect(asked[1]).toEqual(PUT('ada', { command_allowlist: ['${HOME}/bin/*'] }))
  })

  it.each([
    ['a list kept as text', { command_allowlist: 'ls, cat', approvals: { deny: [] } }],
    ['a deny list kept as text', { command_allowlist: ['ls'], approvals: { deny: 'rm -rf /*' } }]
  ])('refuses before any save on %s, which a save would overwrite', async (_what, body) => {
    const { call, asked } = scripted({ status: 200, body })
    expect(await editCommandRule(call, ADA, add('allow', 'cat'))).toEqual({ ok: false, refusal: UNREADABLE })
    expect(asked).toEqual([RAW('ada')])
  })

  it('removes a rule as the page lists it, however long it is and whatever lines it holds', async () => {
    const long = `echo ${'x'.repeat(5000)}`
    const lines = 'printf a\nprintf b'
    const { call, asked } = scripted(CONFIG([long, lines, 'ls'], []), SAVED, CONFIG([lines, 'ls'], []))
    expect(await editCommandRule(call, ADA, remove('allow', long))).toEqual({ ok: true, value: { allow: [lines, 'ls'], deny: [] } })
    expect(asked[1]).toEqual(PUT('ada', { command_allowlist: [lines, 'ls'] }))
    const second = scripted(CONFIG([lines, 'ls'], []), SAVED, CONFIG(['ls'], []))
    expect(await editCommandRule(second.call, ADA, remove('allow', `${lines}\n`))).toMatchObject({ ok: true })
    expect(second.asked[1]).toEqual(PUT('ada', { command_allowlist: ['ls'] }))
    const blank = scripted()
    expect(await editCommandRule(blank.call, ADA, remove('allow', '  '))).toMatchObject({ ok: false })
    expect(blank.asked).toEqual([])
  })

  describe('against a Hermes that keeps the rules', () => {
    const hermes = (header = { allow: ['delete in root path'], deny: ['rm -rf /*'] }) => {
      const book = new RuleBook(header, 'default')
      return { book, call: fixtureCall({}, book) }
    }

    it('keeps approvals.mode and the other list through an add and a remove, one bot at a time', async () => {
      const { book, call } = hermes()
      expect(await editCommandRule(call, ADA, add('deny', 'git push --force*'))).toEqual({ ok: true, value: { allow: ['delete in root path'], deny: ['rm -rf /*', 'git push --force*'] } })
      expect(await editCommandRule(call, ADA, remove('allow', 'delete in root path'))).toEqual({ ok: true, value: { allow: [], deny: ['rm -rf /*', 'git push --force*'] } })
      expect(book.config('ada')).toMatchObject({ command_allowlist: [], approvals: { mode: 'manual', deny: ['rm -rf /*', 'git push --force*'] } })
      expect(book.config(null), "the launch profile's rules did not move").toMatchObject({ command_allowlist: ['delete in root path'], approvals: { deny: ['rm -rf /*'] } })
    })

    it('says Hermes did not save it on a managed install, which answers {"ok": true} and drops the write', async () => {
      const book = new RuleBook({ allow: [], deny: [], locked: true }, 'default')
      expect(await editCommandRule(fixtureCall({}, book), ADA, add('allow', 'ls'))).toEqual({ ok: false, refusal: NOT_SAVED })
    })

    it('is a 404, so unsupported, for a Hermes whose header holds no rules', async () => {
      expect(await readCommandRules(fixtureCall({}, null), ADA)).toEqual({ ok: false, refusal: UNSUPPORTED })
    })
  })
})
