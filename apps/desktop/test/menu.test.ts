import type { BotId, RelayDesk, SlashCatalog } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { completionOf, mentionable, menuOf, picked, type Menu, type MenuItem, type MenuSources, type MenuState } from '../src/renderer/composer/menu'
import { fact, listed } from './support/bots'

const CATALOG: SlashCatalog = [
  { kind: 'command', name: 'context', description: 'Show detailed context window view' },
  { kind: 'command', name: 'convert', description: 'Convert the units in the last answer' },
  { kind: 'command', name: 'status', description: 'Show session, model, token, and context info' },
  { kind: 'skill', name: 'code-review', description: 'Review the current diff' }
]
const TEAM = listed(
  fact('default', 'Ada', { isDefault: true }),
  fact('sam', 'Sam', { description: 'Finds and fixes bugs' }),
  fact('rae-writer', 'Rae', { description: 'Writes the weekly report' }),
  fact('timothy', 'Timothy · CEO'),
  fact('samira', 'Mira')
)
const CAN_RELAY: RelayDesk = { supported: true, bySession: {} }
const ADA = 'default' as BotId
const SOURCES: MenuSources = { catalog: CATALOG, bots: mentionable(TEAM, CAN_RELAY, ADA) }
const fresh: MenuState = { active: 0, dismissed: null }
const nameOf = (item: MenuItem) => (item.kind === 'bot' ? item.bot.name : item.entry.name)
const at = (text: string, caret = text.length, state: MenuState = fresh, sources = SOURCES) => menuOf(text, caret, sources, state)
const names = (text: string, state: MenuState = fresh) => {
  const menu = at(text, text.length, state)
  return menu.open ? menu.items.map(nameOf) : null
}
const opened = (menu: Menu) => {
  if (!menu.open) throw new Error('expected an open list')
  return menu
}
const outline = (menu: Menu) => (menu.open ? { label: menu.label, sections: menu.sections.map(section => [section.label, ...section.items.map(nameOf)]) } : null)

describe('the / list', () => {
  it('lists every entry for a lone slash, commands before skills as the catalog orders them', () => {
    expect(names('/')).toEqual(['context', 'convert', 'status', 'code-review'])
    expect(outline(at('/'))).toEqual({ label: 'Commands and skills', sections: [['Commands', 'context', 'convert', 'status'], ['Skills', 'code-review']] })
  })

  it('narrows to the names that start with what follows the slash, ignoring case', () => {
    expect(names('/co')).toEqual(['context', 'convert', 'code-review'])
    expect(names('/CON')).toEqual(['context', 'convert'])
    expect(outline(at('/cod'))?.sections, 'a section with nothing left is gone').toEqual([['Skills', 'code-review']])
  })

  it('opens nothing for a slash mid-sentence, after a space, with no match, or with no catalog', () => {
    expect(names('hello /')).toBeNull()
    expect(names('/status ')).toBeNull()
    expect(names('/zzz')).toBeNull()
    expect(menuOf('/', 1, { ...SOURCES, catalog: [] }, fresh)).toEqual({ open: false })
  })

  it('stays closed on the text Escape closed it on, and opens again once the text changes', () => {
    expect(names('/co', { active: 0, dismissed: '/co' })).toBeNull()
    expect(names('/cod', { active: 0, dismissed: '/co' })).toEqual(['code-review'])
  })

  it('wraps the active row both ways', () => {
    expect(at('/co', 3, { active: 3, dismissed: null })).toMatchObject({ active: 0 })
    expect(at('/co', 3, { active: -1, dismissed: null })).toMatchObject({ active: 2 })
  })

  it('puts the full name and a space in the box, in place of what was typed', () => {
    const menu = opened(at('/conv'))
    expect(completionOf(menu.items[0]!)).toBe('/convert ')
    expect(picked('/conv', menu.range, menu.items[0]!)).toEqual({ text: '/convert ', caret: 9 })
  })
})

describe('the @ list', () => {
  it("lists the other bots under Bots for an @ at a word start, without the open chat's own bot", () => {
    expect(outline(at('@'))).toEqual({ label: 'Mentions', sections: [['Bots', 'Sam', 'Rae', 'Timothy · CEO', 'Mira']] })
    expect(names('Ask @')).toEqual(['Sam', 'Rae', 'Timothy · CEO', 'Mira'])
    expect(names('Ask\n@')).toEqual(['Sam', 'Rae', 'Timothy · CEO', 'Mira'])
  })

  it('narrows to the bots whose name or id starts with what follows the @, ignoring case', () => {
    expect(names('Ask @Ra')).toEqual(['Rae'])
    expect(names('Ask @sa'), 'Mira by her id').toEqual(['Sam', 'Mira'])
    expect(names('Ask @TIM')).toEqual(['Timothy · CEO'])
    expect(names('Ask @zzz')).toBeNull()
  })

  it('goes on through spaces inside an open quote, and ignores the quote', () => {
    expect(names('Ask @"timothy · c')).toEqual(['Timothy · CEO'])
    expect(names('Ask @"Ra')).toEqual(['Rae'])
  })

  it('opens nothing inside an address, or once the name is followed by a space', () => {
    expect(names('mail me at sam@example')).toBeNull()
    expect(names('mail me at sam@')).toBeNull()
    expect(names('Ask @Rae ')).toBeNull()
  })

  it('reads the @ word the caret is in, so a mention can be typed mid-text', () => {
    expect(outline(at('Ask @Ra about it', 7))?.sections).toEqual([['Bots', 'Rae']])
    expect(at('Ask @Ra about it', 16)).toEqual({ open: false })
    expect(at('Ask @Ra about it', 3)).toEqual({ open: false })
  })

  it('replaces only the @ word with the mention, and leaves the caret after it', () => {
    const end = opened(at('Ask @Ra'))
    expect(picked('Ask @Ra', end.range, end.items[0]!)).toEqual({ text: 'Ask @Rae ', caret: 9 })
    const mid = opened(at('Ask @Ra about it', 7))
    expect(picked('Ask @Ra about it', mid.range, mid.items[0]!), 'no second space').toEqual({ text: 'Ask @Rae about it', caret: 9 })
    const quoted = opened(at('Ask @"tim'))
    expect(picked('Ask @"tim', quoted.range, quoted.items[0]!)).toEqual({ text: 'Ask @"Timothy · CEO" ', caret: 21 })
  })

  it('stays closed on the text Escape closed it on, and wraps the active row', () => {
    expect(names('Ask @sa', { active: 0, dismissed: 'Ask @sa' })).toBeNull()
    expect(names('Ask @sam', { active: 0, dismissed: 'Ask @sa' })).toEqual(['Sam', 'Mira'])
    expect(at('Ask @sa', 7, { active: 2, dismissed: null })).toMatchObject({ active: 0 })
  })
})

describe('the bots a message can be handed to', () => {
  const ids = (...args: Parameters<typeof mentionable>) => mentionable(...args).map(bot => bot.id)

  it('are every listed bot but the one of the open chat', () => {
    expect(ids(TEAM, CAN_RELAY, 'sam' as BotId)).toEqual(['default', 'rae-writer', 'timothy', 'samira'])
    expect(ids(TEAM, CAN_RELAY, null)).toHaveLength(5)
  })

  it('are none on a Hermes that cannot hand a message over, or before it listed its bots', () => {
    expect(ids(TEAM, { supported: false, bySession: {} }, ADA)).toEqual([])
    expect(ids(TEAM, undefined, ADA)).toEqual([])
    expect(ids({ state: 'loading' }, CAN_RELAY, ADA)).toEqual([])
    expect(ids(undefined, CAN_RELAY, ADA)).toEqual([])
    expect(at('Ask @', 5, fresh, { catalog: CATALOG, bots: [] })).toEqual({ open: false })
  })
})
