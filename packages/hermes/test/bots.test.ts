import { describe, expect, it } from 'vitest'
import edgeReply from '../../../fixtures/profiles/edge.json' with { type: 'json' }
import rosterReply from '../../../fixtures/profiles/roster.json' with { type: 'json' }
import { BOT_TONES, rosterOf, type Bot, type BotFacts, type Roster } from '../src/domain/bots'
import type { CanonicalProfileRow, CanonicalProfilesResult } from '../src/wire/contract.generated'
import { parseBots } from '../src/wire/parse'

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

  it('groups bots by section name, in the order each section first arrives, with the bots in no section last', () => {
    const roster = listed({ profiles: [
      row('loose'), row('b1', filed({ sectionId: 'sec-b', sectionName: 'Beta' })), row('a1', filed({ sectionName: 'Alpha' })),
      row('b2', filed({ sectionId: 'sec-b', sectionName: ' Beta ' })), row('unnamed', filed({ sectionId: 'sec-c' })), row('stray', filed({ sectionName: null }))
    ] })
    expect(roster.sections.map(section => [section.name, section.bots.map(bot => bot.id)])).toEqual([
      ['Beta', ['b1', 'b2']], ['Alpha', ['a1']], [null, ['loose', 'unnamed', 'stray']]
    ])
  })

  it('leaves out a bot the user hid, even the default bot', () => {
    const roster = listed({ profiles: [
      row('default', { is_default: true, ...filed({ hidden: true }) }), row('spare', { is_default: true }),
      row('gone', filed({ hidden: true, sectionName: 'Work' })), row('kept', filed({ hidden: false, sectionName: 'Work' })), row('odd', filed({ hidden: 'true' }))
    ] })
    expect(roster.featured?.id).toBe('spare')
    expect(roster.sections.map(section => [section.name, section.bots.map(bot => bot.id)])).toEqual([['Work', ['kept']], [null, ['odd']]])
  })

  it.each([
    ['null', null],
    ['an array', ['hermes-bots', { sectionName: 'Work' }]],
    ['holding the keys at its top level', { title: 'Guessed', section: 'Work', sectionName: 'Work', hidden: true }],
    ['another plugin\'s', { 'other-plugin': { title: 'Guessed', sectionName: 'Work', hidden: true } }],
    ['holding hermes-bots as null', { 'hermes-bots': null }],
    ['holding hermes-bots as an array', { 'hermes-bots': [{ title: 'Guessed' }] }],
    ['holding numbers under hermes-bots', { 'hermes-bots': { title: 7, sectionName: 7, hidden: 1 } }],
    ['holding blank words under hermes-bots', { 'hermes-bots': { title: ' ', sectionName: '' } }]
  ])('reads a ui_meta that is %s as saying nothing', (_, ui_meta) => {
    expect(listed({ profiles: [row('plain', { ui_meta: ui_meta as never })] }).sections).toEqual([
      { name: null, bots: [{ id: 'plain', name: 'plain', preview: null, tone: 'slate' }] }
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
  const shown = EDGE.profiles.filter(profile => (profile.ui_meta?.['hermes-bots'] as { hidden?: boolean } | undefined)?.hidden !== true)

  it('features the first default bot in ink and leaves a second one in its section', () => {
    expect(roster.featured?.name).toBe('Hermes Agent')
    expect(roster.sections.find(section => section.name === 'Work')?.bots.map(bot => bot.name)).toContain('Standby Agent')
    expect(inOrder(roster).filter(bot => bot.tone === 'ink').map(bot => bot.name)).toEqual(['Hermes Agent'])
  })

  it('leaves out the hidden bot, and lists the other thirty', () => {
    expect(inOrder(roster).map(bot => bot.id)).not.toContain('retired')
    expect(inOrder(roster)).toHaveLength(30)
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

  it('lists every shown bot exactly once, however the reply is ordered', () => {
    const random = seeded(7)
    for (let round = 0; round < 50; round++) {
      const profiles = EDGE.profiles.map(profile => ({ profile, key: random() })).sort((a, b) => a.key - b.key).map(({ profile }) => profile)
      const ids = inOrder(listed({ profiles })).map(bot => bot.id)
      expect([...ids].sort(), `shuffle ${round}`).toEqual(shown.map(profile => profile.name).sort())
    }
  })
})

describe('avatar tones', () => {
  it('never give a bot the tone of the bot above it, and keep ink for the default bot', () => {
    const random = seeded(23)
    for (let round = 0; round < 200; round++) {
      const facts: BotFacts[] = Array.from({ length: 1 + Math.floor(random() * 24) }, (_, at) => ({
        id: `bot-${at}` as BotFacts['id'], name: `Bot ${at}`, isDefault: random() < 0.1, preview: null,
        section: (['Work', 'Home', null] as const)[Math.floor(random() * 3)] ?? null
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
})
