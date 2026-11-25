import { describe, expect, it } from 'vitest'
import edgeReply from '../../../fixtures/profiles/edge.json' with { type: 'json' }
import rosterReply from '../../../fixtures/profiles/roster.json' with { type: 'json' }
import { BOT_TONES, rosterOf, type Bot, type BotFacts, type Roster } from '../src/domain/bots'
import type { CanonicalProfileRow, CanonicalProfilesResult } from '../src/wire/contract.generated'
import { parseBots, parseTitled } from '../src/wire/parse'

const ROSTER: CanonicalProfilesResult = rosterReply
const EDGE: CanonicalProfilesResult = edgeReply

const listed = (reply: unknown) => rosterOf(parseBots(reply as CanonicalProfilesResult))
const row = (name: string, more: Partial<CanonicalProfileRow> = {}): CanonicalProfileRow => ({ name, path: `/profiles/${name}`, ...more })
const filed = (meta: Record<string, unknown>) => ({ ui_meta: { 'hermes-bots': meta } })
const line = (bot: Bot) => `${bot.name} [${bot.tone}] ${bot.preview ?? 'no messages'}`
const outline = (roster: Roster) => [
  roster.featured === null ? '(no default bot)' : `* ${line(roster.featured)}`,
  ...roster.sections.flatMap(section => [section.name ?? '(no section)', ...section.bots.map(bot => `  ${line(bot)}`)])
]
const inOrder = (roster: Roster) => [...(roster.featured === null ? [] : [roster.featured]), ...roster.sections.flatMap(section => section.bots)]

function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6D2B79F5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

describe("the user's roster", () => {
  it('reads as their own Hermes draws it: Emu, New section, then Unassigned', () => {
    expect(outline(listed(ROSTER))).toEqual([
      '* Emu [ink] no messages',
      'New section',
      '  dr eggbot [slate] the SOUL.md is the same thi',
      '(no section)',
      "  Research [umber] In Let's talk about QAing your",
      '  Timothy · CEO [plum] Should I start building Launch',
      '  Hermes [olive] Use case 6 is the video\'s "aut',
      '  highwing [mauve] The step 1 plan is ready in the'
    ])
  })
})

describe('a profiles.list reply', () => {
  it('shows the title, else the display name, else the profile name, skipping blanks', () => {
    const { sections } = listed({ profiles: [
      row('titled', { display_name: 'Display', ...filed({ title: ' Title ' }) }), row('blank-title', { display_name: 'Display', ...filed({ title: ' ' }) }),
      row('bare'), row('blank', { display_name: '  ', ...filed({ title: '' }) })
    ] })
    expect(sections[0]?.bots.map(bot => [bot.id, bot.name])).toEqual([['titled', 'Title'], ['blank-title', 'Display'], ['bare', 'bare'], ['blank', 'blank']])
  })

  it('reads what a bot is for from its description, and a blank one as none', () => {
    const { sections } = listed({ profiles: [row('sam', { description: ' Finds and fixes bugs ' }), row('rae', { description: ' ' }), row('bare')] })
    expect(sections[0]?.bots.map(bot => bot.description)).toEqual(['Finds and fixes bugs', null, null])
  })

  it('shows a title that holds a dot as the whole name', () => {
    expect(listed({ profiles: [row('timothy', filed({ title: 'Timothy · CEO' }))] }).sections[0]?.bots[0]?.name).toBe('Timothy · CEO')
  })

  it('previews the chat a click opens, and the newest chat only when there is none', () => {
    const session = (preview?: string) => ({ id: 's', resolved_id: 's', ...(preview === undefined ? {} : { preview }) })
    const { sections } = listed({ profiles: [
      row('canonical', { canonical_session: session('Bot Chat line.'), last_session: session('Newer line.') }),
      row('quiet-canonical', { canonical_session: session(' '), last_session: session('Newer line.') }),
      row('newest', { canonical_session: null, last_session: session(' Hello. ') }),
      row('blank', { last_session: session(' ') }), row('silent', { last_session: session() }), row('new', { last_session: null }), row('older')
    ] })
    expect(sections[0]?.bots.map(bot => [bot.id, bot.preview])).toEqual([
      ['canonical', 'Bot Chat line.'], ['quiet-canonical', null], ['newest', 'Hello.'], ['blank', null], ['silent', null], ['new', null], ['older', null]
    ])
  })

  it('names the session a click opens only for a bot with a Bot Chat, and its latest session after a compression', () => {
    const chats = parseBots({ profiles: [
      row('chatty', { canonical_session: { id: 'root', resolved_id: 'tip' } }), row('plain', { canonical_session: { id: 'root-2', resolved_id: '' } }),
      row('other-chat', { canonical_session: null, last_session: { id: 'newest', resolved_id: 'newest' } }), row('bound')
    ] } as CanonicalProfilesResult).map(bot => [bot.id, bot.chat])
    expect(chats).toEqual([['chatty', 'tip'], ['plain', 'root-2'], ['other-chat', null], ['bound', null]])
  })

  it('reads the session a title lookup answers, or none', () => {
    const found = { session_id: 'tip', id: 'root', resolved_id: 'tip', title: 'Bot Chat', source: 'gui', started_at: null, message_count: 3, running: false }
    expect(parseTitled({ sessions: [found], scope: 'stored' })).toBe('tip')
    expect(parseTitled({ sessions: [{ ...found, resolved_id: null }], scope: 'stored' })).toBe('root')
    expect(parseTitled({ sessions: [], scope: 'stored' })).toBeNull()
  })

  it('groups bots by section name, in the order each section first arrives, with the bots in no section last', () => {
    const roster = listed({ profiles: [
      row('loose'), row('b1', filed({ sectionId: 'sec-b', sectionName: 'Beta' })), row('a1', filed({ sectionName: 'Alpha' })),
      row('b2', filed({ sectionId: 'sec-b', sectionName: ' Beta ' })), row('unnamed', filed({ sectionId: 'sec-c' })), row('stray', filed({ sectionName: null }))
    ] })
    expect(roster.sections.map(section => [section.name, section.bots.map(bot => bot.id)])).toEqual([
      ['Beta', ['b1', 'b2']], ['Alpha', ['a1']], [null, ['loose', 'unnamed', 'stray']]
    ])
  })

  it('keeps a bot the user hid, marked, and a hidden default bot stays featured', () => {
    const roster = listed({ profiles: [
      row('default', { is_default: true, ...filed({ hidden: true }) }), row('spare', { is_default: true }),
      row('gone', filed({ hidden: true, sectionName: 'Work' })), row('kept', filed({ hidden: false, sectionName: 'Work' })), row('odd', filed({ hidden: 'true' }))
    ] })
    expect([roster.featured?.id, roster.featured?.hidden]).toEqual(['default', true])
    expect(roster.sections.map(section => [section.name, section.bots.map(bot => [bot.id, bot.hidden])])).toEqual([
      ['Work', [['gone', true], ['kept', false]]], [null, [['spare', false], ['odd', false]]]
    ])
  })

  it('reads a pin only when Hermes stored the boolean true', () => {
    const { sections } = listed({ profiles: [row('pinned', filed({ pinned: true })), row('unpinned', filed({ pinned: false })), row('odd', filed({ pinned: 'true' })), row('bare')] })
    expect(sections[0]?.bots.map(bot => [bot.id, bot.pinned])).toEqual([['pinned', true], ['unpinned', false], ['odd', false], ['bare', false]])
  })

  it.each([
    ['null', null],
    ['an array', ['hermes-bots', { sectionName: 'Work' }]],
    ['holding the keys at its top level', { title: 'Guessed', section: 'Work', sectionName: 'Work', hidden: true, pinned: true }],
    ['another plugin\'s', { 'other-plugin': { title: 'Guessed', sectionName: 'Work', hidden: true, pinned: true } }],
    ['holding hermes-bots as null', { 'hermes-bots': null }],
    ['holding hermes-bots as an array', { 'hermes-bots': [{ title: 'Guessed' }] }],
    ['holding numbers under hermes-bots', { 'hermes-bots': { title: 7, sectionName: 7, hidden: 1, pinned: 1 } }],
    ['holding blank words under hermes-bots', { 'hermes-bots': { title: ' ', sectionName: '' } }]
  ])('reads a ui_meta that is %s as saying nothing', (_, ui_meta) => {
    expect(listed({ profiles: [row('plain', { ui_meta: ui_meta as never })] }).sections).toEqual([
      { name: null, bots: [{ id: 'plain', name: 'plain', preview: null, description: null, tone: 'slate', picture: false, pinned: false, hidden: false }] }
    ])
  })

  it('paints a bot over the colour Hermes stored for it', () => {
    const roster = listed({ profiles: [row('red', filed({ color: '#ff0000' })), row('slate', filed({ color: 'slate' }))] })
    expect(roster.sections[0]?.bots.map(bot => bot.tone)).toEqual(['slate', 'umber'])
  })

  it('drops a row with no name and a second row with a name already seen', () => {
    const roster = listed({ profiles: [row('twin', { display_name: 'First' }), { path: '/nameless' }, row(''), row('twin', { display_name: 'Second' }), 'nonsense', null] })
    expect(inOrder(roster).map(bot => bot.name)).toEqual(['First'])
  })

  it('features no bot when Hermes marks no default', () => {
    expect(listed({ profiles: [row('a'), row('b', { is_default: false })] }).featured).toBeNull()
  })

  it.each([['null', null], ['a list', []], ['text', 'profiles'], ['an object with no profiles', { install_id: 'x' }]])('reads a reply that is %s as no bots', (_, reply) => {
    expect(listed(reply)).toEqual({ featured: null, sections: [] })
  })
})

describe('the awkward roster', () => {
  const roster = listed(EDGE)
  const named = (name: string) => inOrder(roster).find(bot => bot.name === name)

  it('features the first default bot in ink and leaves a second one in its section', () => {
    expect(roster.featured?.name).toBe('Hermes Agent')
    expect(roster.sections.find(section => section.name === 'Work')?.bots.map(bot => bot.name)).toContain('Standby Agent')
    expect(inOrder(roster).filter(bot => bot.tone === 'ink').map(bot => bot.name)).toEqual(['Hermes Agent'])
  })

  it('keeps the hidden bot in its section, marked, among all thirty-one', () => {
    expect(roster.sections.find(section => section.name === 'Work')?.bots.filter(bot => bot.hidden).map(bot => bot.id)).toEqual(['retired'])
    expect(inOrder(roster)).toHaveLength(31)
  })

  it('shows the title over the display name, and paints over a hex colour and any other CSS colour', () => {
    expect(named('The exceptionally long-named quarterly planning and forecasting assistant')?.id).toBe('planner')
    expect(named('Planner')).toBeUndefined()
    expect(BOT_TONES).toContain(named('Hexer')?.tone)
    expect(BOT_TONES).toContain(named('Painter')?.tone)
  })

  it('previews the Bot Chat over a newer chat', () => {
    expect(named('🇮🇪 Dublin desk')?.preview).toBe('Morning summary is ready.')
  })

  it('reads nothing from keys outside hermes-bots', () => {
    expect(named('zed')).toBeDefined()
    expect(roster.sections.find(section => section.bots.some(bot => bot.name === 'zed'))?.name).toBeNull()
  })

  it('lists every bot exactly once, however the reply is ordered', () => {
    const random = seeded(7)
    for (let round = 0; round < 50; round++) {
      const profiles = EDGE.profiles.map(profile => ({ profile, key: random() })).sort((a, b) => a.key - b.key).map(({ profile }) => profile)
      const ids = inOrder(listed({ profiles })).map(bot => bot.id)
      expect([...ids].sort(), `shuffle ${round}`).toEqual(EDGE.profiles.map(profile => profile.name).sort())
    }
  })
})

describe('avatar tones', () => {
  it('never give a bot the tone of the bot above it, and keep ink for the default bot', () => {
    const random = seeded(23)
    for (let round = 0; round < 200; round++) {
      const facts: BotFacts[] = Array.from({ length: 1 + Math.floor(random() * 24) }, (_, at) => ({
        id: `bot-${at}` as BotFacts['id'], name: `Bot ${at}`, isDefault: random() < 0.1, preview: null, description: null, chat: null, picture: false,
        pinned: random() < 0.2, hidden: random() < 0.2, section: (['Work', 'Home', null] as const)[Math.floor(random() * 3)] ?? null
      }))
      const roster = rosterOf(facts)
      const rows = roster.sections.flatMap(section => section.bots)
      rows.forEach((bot, at) => {
        expect(bot.tone, `round ${round}: ${bot.id} is not the default bot`).not.toBe('ink')
        if (at > 0) expect(bot.tone, `round ${round}: ${bot.id} under ${rows[at - 1]?.id}`).not.toBe(rows[at - 1]?.tone)
      })
      expect(roster.featured?.tone ?? 'ink', `round ${round}: the default bot`).toBe('ink')
    }
  })

  it('stay with each bot when another is hidden, shown, pinned or unpinned', () => {
    const tones = (reply: unknown) => inOrder(listed(reply)).map(bot => `${bot.id} ${bot.tone}`)
    const plain = { profiles: [row('a'), row('b'), row('c', filed({ sectionName: 'Work' })), row('d')] }
    const marked = { profiles: [row('a', filed({ hidden: true })), row('b', filed({ pinned: true })), row('c', filed({ sectionName: 'Work', hidden: true, pinned: true })), row('d')] }
    expect(tones(marked)).toEqual(tones(plain))
  })
})
