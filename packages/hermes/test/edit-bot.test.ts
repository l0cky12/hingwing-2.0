import { describe, expect, it } from 'vitest'
import { botPicture, describeBot, editBot, setBotPicture } from '../src/bot-admin'
import { pictureTypeOf, type BotId } from '../src/domain/bots'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { noAsk, scriptedDialer, type Fixture } from '../src/testing/fixture'
import type { CanonicalProfilesResult } from '../src/wire/contract.generated'
import { Offline, type Connection } from '../src/wire/link'
import { parseBotRecord, parseConfigured, parseDetails, parsePicture } from '../src/wire/parse'
import { BOUND, callsIn, ERRAND, WITH_BOTS } from './support/errand'

const RESEARCH = 'research' as BotId
const EGGBOT = 'dr-eggbot' as BotId
const PERSONA = 'You dig up sources and say where each claim came from.'
const WITH_SOULS: Fixture = { ...WITH_BOTS, header: { ...WITH_BOTS.header, souls: { research: PERSONA } } }
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')}`
const UNSUPPORTED = { ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't edit bots from Highwing." } }

async function launched(fixture: Fixture) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock })
  const hermes = openHermes({ ask: noAsk, dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  const calls = (method: string) => callsIn(script.received).filter(call => call.method === method)
  const bot = (id: BotId) => {
    const bots = hermes.bots.get()
    return bots.state === 'listed' ? [bots.roster.featured, ...bots.roster.sections.flatMap(section => section.bots)].find(held => held?.id === id) : undefined
  }
  return { clock, hermes, calls, bot }
}

describe('describeBot through the hub', () => {
  it('answers the name shown, the description, the persona and the revision of the name', async () => {
    const { hermes } = await launched(WITH_SOULS)
    expect(await hermes.run({ do: 'describeBot', bot: RESEARCH })).toEqual({
      ok: true, value: { bot: 'research', name: 'Research', description: '', persona: PERSONA, revision: 2 }
    })
  })

  it("refuses with Hermes's words for a bot it does not have", async () => {
    const { hermes } = await launched(WITH_SOULS)
    expect(await hermes.run({ do: 'describeBot', bot: 'nobody' as BotId })).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes refused: profile 'nobody' not found" } })
  })
})

describe('editBot through the hub', () => {
  it('sends only the persona, in one profiles.configure call, when only the persona changed', async () => {
    const { hermes, calls } = await launched(WITH_SOULS)
    expect(await hermes.run({ do: 'editBot', bot: RESEARCH, edit: { persona: 'You write plainly.' }, revision: 2 })).toEqual({ ok: true, value: undefined })
    expect(calls('profiles.configure')).toEqual([{ method: 'profiles.configure', params: { name: 'research', soul: 'You write plainly.' } }])
    expect(await hermes.run({ do: 'describeBot', bot: RESEARCH })).toMatchObject({ ok: true, value: { persona: 'You write plainly.' } })
  })

  it("renames by writing the bot's whole record with the new title and the revision it was read at, and the roster shows it", async () => {
    const { clock, hermes, calls, bot } = await launched(WITH_BOTS)
    expect(await hermes.run({ do: 'editBot', bot: EGGBOT, edit: { name: ' Eggbert ', description: 'Cooks.' }, revision: 2 })).toEqual({ ok: true, value: undefined })
    expect(calls('profiles.configure')).toEqual([{
      method: 'profiles.configure',
      params: {
        name: 'dr-eggbot', description: 'Cooks.',
        ui_meta: { 'hermes-bots': { title: 'Eggbert', sectionId: 'sec-mh2k9x1a-4f8qz', sectionName: 'New section', color: '#f43f5e', shape: 'blobatar::organic', created: 1793000000000 } },
        ui_meta_expected_revisions: { 'hermes-bots': 2 }
      }
    }])
    await clock.advance(0)
    expect(bot(EGGBOT)?.name).toBe('Eggbert')
    expect(await hermes.run({ do: 'describeBot', bot: EGGBOT })).toMatchObject({ ok: true, value: { name: 'Eggbert', description: 'Cooks.', revision: 3 } })
  })

  it('answers a conflict when the name changed elsewhere since it was read, and saves the other fields of the call', async () => {
    const { clock, hermes, bot } = await launched({ ...WITH_SOULS, header: { ...WITH_SOULS.header, configureClash: 'Robin' } })
    const edited = await hermes.run({ do: 'editBot', bot: RESEARCH, edit: { name: 'Scout', persona: 'Short answers.' }, revision: 2 })
    expect(edited).toEqual({ ok: false, refusal: { kind: 'conflict', message: 'This bot changed elsewhere.' } })
    await clock.advance(0)
    expect(bot(RESEARCH)?.name, 'the roster is read again after a refused edit').toBe('Robin')
    expect(await hermes.run({ do: 'describeBot', bot: RESEARCH })).toEqual({ ok: true, value: { bot: 'research', name: 'Robin', description: '', persona: 'Short answers.', revision: 3 } })
    expect(await hermes.run({ do: 'editBot', bot: RESEARCH, edit: { name: 'Scout' }, revision: 3 }), 'a retry at the new revision is saved').toEqual({ ok: true, value: undefined })
  })

  it('is unsupported on a Hermes with no profiles, and on a socket with no interactive grant', async () => {
    for (const fixture of [ERRAND, BOUND]) {
      const { hermes } = await launched(fixture)
      expect(await hermes.run({ do: 'describeBot', bot: RESEARCH })).toEqual(UNSUPPORTED)
      expect(await hermes.run({ do: 'editBot', bot: RESEARCH, edit: { persona: 'x' }, revision: 2 })).toEqual(UNSUPPORTED)
      expect(await hermes.run({ do: 'setBotPicture', bot: RESEARCH, data: PNG })).toEqual(UNSUPPORTED)
    }
  })
})

describe('editBot against one Hermes reply', () => {
  const answering = (replies: Record<string, unknown>) => {
    const sent: { method: string; params: unknown }[] = []
    const conn = {
      call: async (method: string, params: unknown) => {
        sent.push({ method, params })
        return replies[method]
      },
      as: () => { throw new Error('not routed') }
    } as unknown as Pick<Connection, 'call' | 'as'>
    return { conn, sent }
  }
  const OLD_ROW = { profiles: [{ name: 'rae', path: '/h/profiles/rae', ui_meta: { 'hermes-bots': { title: 'Rae', chat: 'stale-pointer', hidden: false } } }] }

  it('sends no expected revision to a Hermes that keeps none, and leaves out the chat pointer Hermes drops', async () => {
    const { conn, sent } = answering({ 'profiles.list': OLD_ROW, 'profiles.configure': { ok: true, applied: { ui_meta: true } } })
    expect(await editBot(conn, 'rae' as BotId, { name: 'Ray' }, null)).toEqual({ ok: true, value: undefined })
    expect(sent.at(-1)).toEqual({ method: 'profiles.configure', params: { name: 'rae', ui_meta: { 'hermes-bots': { title: 'Ray', hidden: false } } } })
  })

  it('names in words each section Hermes reports it did not save', async () => {
    const { conn } = answering({ 'profiles.list': OLD_ROW, 'profiles.configure': { ok: false, applied: { ui_meta: false, soul: false, description: true } } })
    expect(await editBot(conn, 'rae' as BotId, { name: 'Ray', persona: 'x', description: 'y' }, null)).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes didn't save the name and persona." } })
  })

  it('names every section sent as not saved when Hermes reports nothing it applied', async () => {
    const { conn } = answering({ 'profiles.list': OLD_ROW, 'profiles.configure': { ok: true } })
    expect(await editBot(conn, 'rae' as BotId, { name: 'Ray', persona: 'x' }, null)).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes didn't save the name and persona." } })
  })

  it('refuses a rename of a bot the list no longer holds, and sends nothing', async () => {
    const { conn, sent } = answering({ 'profiles.list': { profiles: [] } })
    expect(await editBot(conn, 'rae' as BotId, { name: 'Ray' }, 2)).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Hermes no longer has this bot.' } })
    expect(sent.map(call => call.method)).toEqual(['profiles.list'])
  })
})

describe("a bot's picture through the hub", () => {
  it('sends the picture, lists the bot as having one, and reads it back', async () => {
    const { clock, hermes, calls, bot } = await launched(WITH_BOTS)
    expect(bot(RESEARCH)?.picture).toBe(false)
    expect(await hermes.run({ do: 'setBotPicture', bot: RESEARCH, data: PNG })).toEqual({ ok: true, value: undefined })
    expect(calls('profiles.set_asset')).toEqual([{ method: 'profiles.set_asset', params: { name: 'research', asset: 'avatar', data: PNG } }])
    await clock.advance(0)
    expect(bot(RESEARCH)?.picture).toBe(true)
    expect(await hermes.run({ do: 'botPicture', bot: RESEARCH })).toEqual({ ok: true, value: PNG })
  })

  it('clears the picture, and the bot has none from then on', async () => {
    const { clock, hermes, calls, bot } = await launched(WITH_BOTS)
    await hermes.run({ do: 'setBotPicture', bot: RESEARCH, data: PNG })
    expect(await hermes.run({ do: 'removeBotPicture', bot: RESEARCH })).toEqual({ ok: true, value: undefined })
    expect(calls('profiles.set_asset').at(-1)).toEqual({ method: 'profiles.set_asset', params: { name: 'research', asset: 'avatar', clear: true } })
    await clock.advance(0)
    expect(bot(RESEARCH)?.picture).toBe(false)
    expect(await hermes.run({ do: 'botPicture', bot: RESEARCH })).toEqual({ ok: true, value: null })
  })

  it("answers Hermes's refusal of a picture in the words of the limit", async () => {
    const { hermes } = await launched(WITH_BOTS)
    const limit = { ok: false, refusal: { kind: 'rejected', message: 'Pick a PNG, JPEG or WebP picture of 2 MB or less.' } }
    expect(await hermes.run({ do: 'setBotPicture', bot: RESEARCH, data: 'data:image/png;base64,aGVsbG8=' })).toEqual(limit)
    expect(await hermes.run({ do: 'setBotPicture', bot: RESEARCH, data: 'not base64!' })).toEqual(limit)
  })

  it('refuses through the shared words when the link is down', async () => {
    const offline = { call: () => Promise.reject(new Offline('gone')), as: () => { throw new Error('not routed') } } as unknown as Pick<Connection, 'call' | 'as'>
    for (const outcome of [await describeBot(offline, RESEARCH), await setBotPicture(offline, RESEARCH, null), await botPicture(offline, RESEARCH)]) {
      expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
    }
  })
})

describe('the parsers of the details calls', () => {
  const listed = (row: object): CanonicalProfilesResult => ({ profiles: [{ name: 'rae', path: '/h/profiles/rae', ...row }] })

  it('reads the revision of the record, 0 for a record never written, and null for a Hermes that keeps no revisions', () => {
    expect(parseBotRecord(listed({ ui_meta_revisions: { 'hermes-bots': 4 } }), 'rae' as BotId)?.revision).toBe(4)
    expect(parseBotRecord(listed({ ui_meta_revisions: {} }), 'rae' as BotId)?.revision).toBe(0)
    expect(parseBotRecord(listed({}), 'rae' as BotId)?.revision).toBeNull()
    expect(parseBotRecord(listed({}), 'ray' as BotId)).toBeNull()
  })

  it('names a bot in details as the sidebar does', () => {
    const details = parseDetails({ name: 'rae', model: {}, soul: 'S', description: 'D' }, listed({ display_name: 'Display' }), 'rae' as BotId)
    expect(details).toEqual({ bot: 'rae', name: 'Display', description: 'D', persona: 'S', revision: null })
  })

  it('reads a clash before any section, and lists the sections not saved', () => {
    expect(parseConfigured({ ok: false, applied: { ui_meta: false, ui_meta_conflicts: { 'hermes-bots': { expected: 2, actual: 3 } }, soul: true } }, ['ui_meta', 'soul'])).toEqual({ is: 'clash' })
    expect(parseConfigured({ ok: true, applied: { soul: true } }, ['soul'])).toEqual({ is: 'saved' })
    expect(parseConfigured({ ok: false, applied: { soul: false, description: true } }, ['soul', 'description'])).toEqual({ is: 'unsaved', sections: ['soul'] })
  })

  it('reads only an image data URL Hermes found as a picture', () => {
    expect(parsePicture({ found: true, data: PNG })).toBe(PNG)
    expect(parsePicture({ found: false })).toBeNull()
    expect(parsePicture({ found: true, data: 'javascript:alert(1)' })).toBeNull()
  })

  it('sniffs a picture by its first bytes, not its name', () => {
    const bytes = (...head: number[]) => new Uint8Array([...head, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(pictureTypeOf(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
    expect(pictureTypeOf(bytes(0xff, 0xd8, 0xff))).toBe('image/jpeg')
    expect(pictureTypeOf(new Uint8Array([...Buffer.from('RIFF'), 1, 2, 3, 4, ...Buffer.from('WEBP')]))).toBe('image/webp')
    expect(pictureTypeOf(new Uint8Array([...Buffer.from('RIFF'), 1, 2, 3, 4, ...Buffer.from('WAVE')]))).toBeNull()
    expect(pictureTypeOf(Buffer.from('GIF89a'))).toBeNull()
    expect(pictureTypeOf(new Uint8Array())).toBeNull()
  })
})
