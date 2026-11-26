import { describe, expect, it } from 'vitest'
import { markBot } from '../src/bot-admin'
import { botsIn, type BotId, type BotMark, type Bots } from '../src/domain/bots'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type Fixture } from '../src/testing/fixture'
import { METHOD_NOT_FOUND, Offline, RpcRefusal, type Connection } from '../src/wire/link'
import { BOUND, callsIn, ERRAND, WITH_BOTS } from './support/errand'

const RESEARCH = 'research' as BotId

function answering(replies: { readonly [method: string]: readonly unknown[] }) {
  const sent: { method: string; params: unknown }[] = []
  const used: Record<string, number> = {}
  const conn = {
    call: async (method: string, params: unknown) => {
      sent.push({ method, params })
      const list = replies[method] ?? []
      const at = Math.min(used[method] ?? 0, list.length - 1)
      used[method] = (used[method] ?? 0) + 1
      const reply = list[at]
      if (reply instanceof Error) throw reply
      return reply
    },
    as: () => { throw new Error('not routed') }
  } as unknown as Pick<Connection, 'call' | 'as'>
  const configured = () => sent.filter(call => call.method === 'profiles.configure').map(call => call.params)
  return { conn, sent, configured }
}

const listing = (meta: object, revision: number | null = 4) => ({
  profiles: [{ name: 'research', path: '/h/profiles/research', ...(revision === null ? {} : { ui_meta_revisions: { 'hermes-bots': revision } }), ui_meta: { 'hermes-bots': { title: 'Researcher', ...meta } } }]
})
const SAVED = { ok: true, applied: { ui_meta: true } }
const CLASHED = { ok: false, applied: { ui_meta: false, ui_meta_conflicts: { 'hermes-bots': { expected: 4, actual: 5 } } } }

describe('marking a bot', () => {
  it.each<[BotMark, object]>([
    ['pin', { pinned: true }],
    ['unpin', { pinned: false }],
    ['hide', { hidden: true }],
    ['show', { hidden: false }]
  ])('%s writes its one flag onto the record as Hermes holds it, at the revision it was read at', async (mark, flag) => {
    const { conn, configured } = answering({ 'profiles.list': [listing({ sectionName: 'Work', pinned: true, hidden: true })], 'profiles.configure': [SAVED] })
    expect(await markBot(conn, RESEARCH, mark)).toEqual({ ok: true, value: undefined })
    expect(configured()).toEqual([{
      name: 'research',
      ui_meta: { 'hermes-bots': { title: 'Researcher', sectionName: 'Work', pinned: true, hidden: true, ...flag } },
      ui_meta_expected_revisions: { 'hermes-bots': 4 }
    }])
  })

  it('writes the value even when Hermes already holds it, so a double click lands in the same place', async () => {
    const { conn, configured } = answering({ 'profiles.list': [listing({ pinned: true })], 'profiles.configure': [SAVED] })
    expect(await markBot(conn, RESEARCH, 'pin')).toEqual({ ok: true, value: undefined })
    expect(configured()).toMatchObject([{ ui_meta: { 'hermes-bots': { pinned: true } } }])
  })

  it('leaves out the chat pointer Hermes drops, and sends no revision to a Hermes that keeps none', async () => {
    const { conn, configured } = answering({ 'profiles.list': [listing({ chat: 'stale-pointer' }, null)], 'profiles.configure': [SAVED] })
    await markBot(conn, RESEARCH, 'hide')
    expect(configured()).toEqual([{ name: 'research', ui_meta: { 'hermes-bots': { title: 'Researcher', hidden: true } } }])
  })

  it('reads again after a clash and writes onto the fresh record, keeping what the other client wrote', async () => {
    const { conn, configured } = answering({
      'profiles.list': [listing({ sectionName: 'Work' }, 4), listing({ sectionName: 'Elsewhere' }, 5)],
      'profiles.configure': [CLASHED, SAVED]
    })
    expect(await markBot(conn, RESEARCH, 'pin')).toEqual({ ok: true, value: undefined })
    expect(configured()).toEqual([
      { name: 'research', ui_meta: { 'hermes-bots': { title: 'Researcher', sectionName: 'Work', pinned: true } }, ui_meta_expected_revisions: { 'hermes-bots': 4 } },
      { name: 'research', ui_meta: { 'hermes-bots': { title: 'Researcher', sectionName: 'Elsewhere', pinned: true } }, ui_meta_expected_revisions: { 'hermes-bots': 5 } }
    ])
  })

  it('gives up after three clashes in a row, naming the action and the bot as Hermes last named it', async () => {
    const { conn, configured } = answering({
      'profiles.list': [listing({}), listing({}), listing({ title: 'Robin' })],
      'profiles.configure': [CLASHED]
    })
    expect(await markBot(conn, RESEARCH, 'pin')).toEqual({ ok: false, refusal: { kind: 'conflict', message: "Hermes didn't pin Robin. Try again." } })
    expect(configured()).toHaveLength(3)
  })

  it.each<[BotMark, string]>([
    ['pin', "Hermes didn't pin Researcher. Try again."],
    ['unpin', "Hermes didn't unpin Researcher. Try again."],
    ['hide', "Hermes didn't hide Researcher. Try again."],
    ['show', "Hermes didn't show Researcher. Try again."]
  ])('refuses %s when Hermes could not write the record', async (mark, message) => {
    const { conn } = answering({ 'profiles.list': [listing({})], 'profiles.configure': [{ ok: false, applied: { ui_meta: false } }] })
    expect(await markBot(conn, RESEARCH, mark)).toEqual({ ok: false, refusal: { kind: 'rejected', message } })
  })

  it('says this Hermes cannot change bots when it reports nothing it applied, or has no profiles.configure', async () => {
    const CANT = { ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't change bots from Highwing." } }
    const silent = answering({ 'profiles.list': [listing({})], 'profiles.configure': [{ ok: true }] })
    expect(await markBot(silent.conn, RESEARCH, 'hide')).toEqual(CANT)
    expect(silent.configured(), 'an old Hermes is not asked again').toHaveLength(1)
    const missing = answering({ 'profiles.list': [listing({})], 'profiles.configure': [new RpcRefusal(METHOD_NOT_FOUND, null, 'Method not found')] })
    expect(await markBot(missing.conn, RESEARCH, 'hide')).toEqual(CANT)
  })

  it('says Hermes no longer has the bot when the read misses it, sending no write', async () => {
    const GONE = { ok: false, refusal: { kind: 'rejected', message: 'Hermes no longer has this bot.' } }
    const missed = answering({ 'profiles.list': [{ profiles: [] }] })
    expect(await markBot(missed.conn, RESEARCH, 'pin')).toEqual(GONE)
    expect(missed.configured()).toEqual([])
  })

  it('says Hermes no longer has the bot when a 4064 write is followed by a read that misses it', async () => {
    const { conn } = answering({ 'profiles.list': [listing({}), { profiles: [] }], 'profiles.configure': [new RpcRefusal(4064, null, "profile 'research' not found")] })
    expect(await markBot(conn, RESEARCH, 'pin')).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Hermes no longer has this bot.' } })
  })

  it("gives Hermes's own words for a 4064 while the bot is still listed, as when its config is unavailable", async () => {
    const { conn } = answering({ 'profiles.list': [listing({}), listing({})], 'profiles.configure': [new RpcRefusal(4064, null, 'config backend unavailable')] })
    expect(await markBot(conn, RESEARCH, 'pin')).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Hermes refused: config backend unavailable' } })
  })

  it("says Highwing isn't connected when the link is down", async () => {
    const { conn } = answering({ 'profiles.list': [new Offline('down')] })
    expect(await markBot(conn, RESEARCH, 'pin')).toEqual({ ok: false, refusal: { kind: 'offline', message: "Highwing isn't connected to Hermes right now." } })
  })
})

describe('markBot through the hub', () => {
  async function launched(fixture: Fixture) {
    const clock = manualClock()
    const script = scriptedDialer(fixture, { clock })
    const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
    await clock.advance(0)
    const calls = (method: string) => callsIn(script.received).filter(call => call.method === method)
    return { clock, hermes, calls }
  }
  const flagsOf = (bots: Bots, bot: BotId) => {
    const held = bots.state === 'listed' ? botsIn(bots.roster).find(each => each.id === bot) : undefined
    return held && { pinned: held.pinned, hidden: held.hidden }
  }
  const editionOf = (bots: Bots) => (bots.state === 'listed' ? bots.edition : -1)

  it('answers an edition the roster already holds the flag in, and Hermes keeps it on the next read', async () => {
    const { clock, hermes, calls } = await launched(WITH_BOTS)
    const rosterReads = () => calls('profiles.list').filter(call => (call.params as { include_sessions?: boolean }).include_sessions === true).length
    const reads = rosterReads()
    const pinned = await hermes.run({ do: 'markBot', bot: RESEARCH, mark: 'pin' })
    if (!pinned.ok) throw new Error(pinned.refusal.message)
    expect(editionOf(hermes.bots.get())).toBeGreaterThanOrEqual(pinned.value.edition)
    expect(flagsOf(hermes.bots.get(), RESEARCH)).toEqual({ pinned: true, hidden: false })
    await clock.advance(0)
    expect(rosterReads(), 'the roster is read again').toBe(reads + 1)
    expect(flagsOf(hermes.bots.get(), RESEARCH)).toEqual({ pinned: true, hidden: false })
  })

  it('hides and shows a bot again, leaving its pin as it was', async () => {
    const { clock, hermes } = await launched(WITH_BOTS)
    await hermes.run({ do: 'markBot', bot: RESEARCH, mark: 'pin' })
    await hermes.run({ do: 'markBot', bot: RESEARCH, mark: 'hide' })
    await clock.advance(0)
    expect(flagsOf(hermes.bots.get(), RESEARCH)).toEqual({ pinned: true, hidden: true })
    await hermes.run({ do: 'markBot', bot: RESEARCH, mark: 'show' })
    await clock.advance(0)
    expect(flagsOf(hermes.bots.get(), RESEARCH)).toEqual({ pinned: true, hidden: false })
  })

  it('refuses after another client wins three writes in a row, and reads the roster again', async () => {
    const { clock, hermes, calls } = await launched({ ...WITH_BOTS, header: { ...WITH_BOTS.header, configureClash: { title: 'Robin', times: 3 } } })
    expect(await hermes.run({ do: 'markBot', bot: RESEARCH, mark: 'pin' })).toEqual({ ok: false, refusal: { kind: 'conflict', message: "Hermes didn't pin Robin. Try again." } })
    expect(calls('profiles.configure')).toHaveLength(3)
    await clock.advance(0)
    expect(flagsOf(hermes.bots.get(), RESEARCH)).toEqual({ pinned: false, hidden: false })
    expect(botsIn((hermes.bots.get() as Extract<Bots, { state: 'listed' }>).roster).find(bot => bot.id === RESEARCH)?.name).toBe('Robin')
  })

  it('saves on the second try when another client won the first', async () => {
    const { hermes, calls } = await launched({ ...WITH_BOTS, header: { ...WITH_BOTS.header, configureClash: 'Robin' } })
    expect(await hermes.run({ do: 'markBot', bot: RESEARCH, mark: 'hide' })).toMatchObject({ ok: true })
    expect(calls('profiles.configure')).toHaveLength(2)
    expect(flagsOf(hermes.bots.get(), RESEARCH)).toEqual({ pinned: false, hidden: true })
  })

  it('says this Hermes cannot change bots when it has no profiles, or the socket reaches one profile', async () => {
    for (const fixture of [ERRAND, BOUND]) {
      const { hermes } = await launched(fixture)
      expect(await hermes.run({ do: 'markBot', bot: RESEARCH, mark: 'pin' })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't change bots from Highwing." } })
    }
  })

  it('reads the roster again when asked to refresh', async () => {
    const { clock, hermes, calls } = await launched(WITH_BOTS)
    const reads = calls('profiles.list').length
    expect(await hermes.run({ do: 'refreshBots' })).toEqual({ ok: true, value: undefined })
    await clock.advance(0)
    expect(calls('profiles.list')).toHaveLength(reads + 1)
  })
})
