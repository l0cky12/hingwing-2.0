import { describe, expect, it } from 'vitest'
import edgeReply from '../../../fixtures/profiles/edge.json' with { type: 'json' }
import rosterReply from '../../../fixtures/profiles/roster.json' with { type: 'json' }
import { BOT_TONES, rosterOf, type Bot, type BotFacts, type Roster } from '../src/domain/bots'
import type { CanonicalProfileRow, CanonicalProfilesResult } from '../src/wire/contract.generated'
import { parseBots } from '../src/wire/parse'

/** `pnpm typecheck` fails here when a placeholder stops being a `profiles.list` reply, for example after the contract moves. */
const ROSTER: CanonicalProfilesResult = rosterReply
const EDGE: CanonicalProfilesResult = edgeReply

const listed = (reply: unknown) => rosterOf(parseBots(reply as CanonicalProfilesResult))
const row = (name: string, more: Partial<CanonicalProfileRow> = {}): CanonicalProfileRow => ({ name, path: `/profiles/${name}`, ...more })
const line = (bot: Bot) => `${bot.name}${bot.role === null ? '' : ` · ${bot.role}`} [${bot.tone}] ${bot.preview ?? 'no messages'}`
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

describe('the placeholder roster', () => {
  it('reads as the approved layout: the default bot, Work, then the bots in no section', () => {
    expect(outline(listed(ROSTER))).toEqual([
      '* Hermes Agent [ink] no messages',
      'Work',
      '  Researcher [slate] Three of the five sources agree on the 2024 figure; the other two cite an older survey.',
      '  Reviewer · Code review [umber] The slash menu change looks right. One nit about the empty state copy.',
      '(no section)',
      '  Ops · On call [plum] Pruned four worktrees and freed 11 GB on the build box.',
      '  Scribe [olive] no messages'
    ])
  })
})

describe('a profiles.list reply', () => {
  it('shows the display name, or the profile name when that is blank', () => {
    const { sections } = listed({ profiles: [row('named', { display_name: 'Shown' }), row('bare'), row('blank', { display_name: '  ' })] })
    expect(sections[0]?.bots.map(bot => [bot.id, bot.name])).toEqual([['named', 'Shown'], ['bare', 'bare'], ['blank', 'blank']])
  })

  it('reads a blank preview and a missing session as no messages', () => {
    const session = { id: 's', resolved_id: 's' }
    const { sections } = listed({ profiles: [
      row('spoke', { last_session: { ...session, preview: ' Hello. ' } }), row('blank', { last_session: { ...session, preview: ' ' } }),
      row('silent', { last_session: session }), row('new', { last_session: null }), row('older')
    ] })
    expect(sections[0]?.bots.map(bot => bot.preview)).toEqual(['Hello.', null, null, null, null])
  })

  it('keeps sections in the order their first bot arrives, with the bots in no section last', () => {
    const roster = listed({ profiles: [
      row('loose'), row('b1', { ui_meta: { section: 'Beta' } }), row('a1', { ui_meta: { section: 'Alpha' } }), row('b2', { ui_meta: { section: ' Beta ' } }), row('stray')
    ] })
    expect(roster.sections.map(section => [section.name, section.bots.map(bot => bot.id)])).toEqual([
      ['Beta', ['b1', 'b2']], ['Alpha', ['a1']], [null, ['loose', 'stray']]
    ])
  })

  it.each([
    ['null', null],
    ['an array', ['section', 'Work']],
    ['numbers under its keys', { section: 7, role: 7, color: 7 }],
    ['blank words under its keys', { section: ' ', role: '', color: '' }]
  ])('reads a ui_meta that is %s as saying nothing', (_, ui_meta) => {
    expect(listed({ profiles: [row('plain', { ui_meta: ui_meta as never })] }).sections).toEqual([
      { name: null, bots: [{ id: 'plain', name: 'plain', role: null, preview: null, tone: 'slate' }] }
    ])
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

  it('features the first default bot and leaves a second one in its section', () => {
    expect(roster.featured?.name).toBe('Hermes Agent')
    expect(roster.sections.find(section => section.name === 'Work')?.bots.map(bot => bot.name)).toContain('Standby Agent')
    expect(inOrder(roster).filter(bot => bot.tone === 'ink').map(bot => bot.name)).toEqual(['Hermes Agent'])
  })

  it('keeps a tone the user chose, and paints over a colour that is not one of the tones', () => {
    expect(named('Painter')?.tone).toBe('plum')
    expect(BOT_TONES).toContain(named('Hexer')?.tone)
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
  it('never give two neighbours the same tone unless the user chose both, keep every chosen tone, and keep ink for the default bot', () => {
    const random = seeded(23)
    const pick = <T>(from: readonly T[]) => from[Math.floor(random() * from.length)] as T
    for (let round = 0; round < 200; round++) {
      const facts: BotFacts[] = Array.from({ length: 1 + Math.floor(random() * 24) }, (_, at) => ({
        id: `bot-${at}` as BotFacts['id'], name: `Bot ${at}`, isDefault: random() < 0.1, role: null, preview: null,
        section: pick(['Work', 'Home', null]), chosenTone: random() < 0.4 ? pick(BOT_TONES) : null
      }))
      const chosen = new Map(facts.map(bot => [bot.id, bot.chosenTone]))
      const roster = rosterOf(facts)
      const rows = roster.sections.flatMap(section => section.bots)
      rows.forEach((bot, at) => {
        const above = rows[at - 1]
        expect(bot.tone, `round ${round}: ${bot.id} is not the default bot`).not.toBe('ink')
        if (chosen.get(bot.id) !== null) expect(bot.tone, `round ${round}: ${bot.id} keeps its tone`).toBe(chosen.get(bot.id))
        if (above !== undefined && (chosen.get(bot.id) === null || chosen.get(above.id) === null)) expect(bot.tone, `round ${round}: ${bot.id} under ${above.id}`).not.toBe(above.tone)
      })
      expect(roster.featured?.tone ?? 'ink', `round ${round}: the default bot`).toBe('ink')
    }
  })
})
