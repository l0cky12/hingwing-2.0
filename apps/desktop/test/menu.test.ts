import type { BotId, PathMatch, RelayDesk, SlashCatalog } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { completionOf, mentionable, mentionWord, menuOf, picked, type Menu, type MenuItem, type MenuSources, type MenuState } from '../src/renderer/composer/menu'
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
const NOTES: readonly PathMatch[] = [
  { path: 'notes.md', folder: false },
  { path: 'archive/notes-2024.md', folder: false },
  { path: 'notebooks/', folder: true }
]
const SOURCES: MenuSources = { catalog: CATALOG, bots: mentionable(TEAM, CAN_RELAY, ADA), files: { word: null, matches: [] } }
const WITH_FILES: MenuSources = { ...SOURCES, files: { word: '@not', matches: NOTES } }
const fresh: MenuState = { active: 0, dismissed: null }
const nameOf = (item: MenuItem) => {
  switch (item.kind) {
    case 'bot': return item.bot.name
    case 'file': return item.match.path
    default: return item.entry.name
  }
}
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

  it('leaves a hidden bot out of a bare @, offers it once a letter is typed, and still names it apart from the bots shown', () => {
    const team = listed(fact('default', 'Ada', { isDefault: true }), fact('rae', 'Old Helper', { hidden: true }), fact('rae-writer', 'rae'))
    const sources: MenuSources = { ...SOURCES, bots: mentionable(team, CAN_RELAY, ADA) }
    const shownFor = (text: string) => {
      const menu = at(text, text.length, fresh, sources)
      return menu.open ? menu.items.map(nameOf) : null
    }
    expect(shownFor('Ask @')).toEqual(['rae'])
    expect(shownFor('Ask @o')).toEqual(['Old Helper'])
    const bare = opened(at('Ask @', 5, fresh, sources))
    expect(picked('Ask @', bare.range, bare.items[0]!), '@rae would name the hidden bot').toEqual({ text: 'Ask @rae-writer ', caret: 16 })
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

  it('replaces the whole @ word when the caret sits inside it', () => {
    const inside = opened(at('Ask @Rae about it', 6))
    expect(picked('Ask @Rae about it', inside.range, inside.items[0]!)).toEqual({ text: 'Ask @Rae about it', caret: 9 })
    const quoted = opened(at('Ask @"Tim oth" now', 9))
    expect(picked('Ask @"Tim oth" now', quoted.range, quoted.items[0]!)).toEqual({ text: 'Ask @"Timothy · CEO" now', caret: 21 })
    const before = opened(at('Ask @"Timothy CEO" now', 5))
    const timothy = before.items.find(item => item.kind === 'bot' && item.bot.name === 'Timothy · CEO')!
    expect(picked('Ask @"Timothy CEO" now', before.range, timothy), 'caret before the opening quote').toEqual({ text: 'Ask @"Timothy · CEO" now', caret: 21 })
    const open = opened(at('Ask @"Tim about it', 9))
    expect(picked('Ask @"Tim about it', open.range, open.items[0]!), 'an unclosed quote takes only its word').toEqual({ text: 'Ask @"Timothy · CEO" about it', caret: 21 })
  })

  it('stays closed on the text Escape closed it on, and wraps the active row', () => {
    expect(names('Ask @sa', { active: 0, dismissed: 'Ask @sa' })).toBeNull()
    expect(names('Ask @sam', { active: 0, dismissed: 'Ask @sa' })).toEqual(['Sam', 'Mira'])
    expect(at('Ask @sa', 7, { active: 2, dismissed: null })).toMatchObject({ active: 0 })
  })
})

describe('the files in the @ list', () => {
  const files = (text: string, caret = text.length, sources = WITH_FILES) => at(text, caret, fresh, sources)
  const pick = (text: string, path: string, caret = text.length, matches: readonly PathMatch[] = NOTES) => {
    const menu = opened(files(text, caret, { ...SOURCES, files: { word: mentionWord(text, caret), matches } }))
    return picked(text, menu.range, menu.items.find(item => nameOf(item) === path)!)
  }

  it('come under Files after Bots, in the order Hermes gave them', () => {
    expect(outline(files('Rename the heading in @sa', 25, { ...SOURCES, files: { word: '@sa', matches: [{ path: 'sample.txt', folder: false }] } }))).toEqual({
      label: 'Mentions', sections: [['Bots', 'Sam', 'Mira'], ['Files', 'sample.txt']]
    })
    expect(outline(files('Rename the heading in @not'))?.sections).toEqual([['Files', 'notes.md', 'archive/notes-2024.md', 'notebooks/']])
  })

  it('open nothing for a mention with no match in bots or files, and nothing inside an address', () => {
    expect(files('Rename @zzz', 11, SOURCES)).toEqual({ open: false })
    expect(files('mail me at sam@example', 22, SOURCES)).toEqual({ open: false })
    expect(mentionWord('mail me at sam@example', 22)).toBeNull()
  })

  it('put the plain path and a space in the box, and the caret after it', () => {
    expect(pick('Rename the heading in @not', 'notes.md')).toEqual({ text: 'Rename the heading in notes.md ', caret: 31 })
    expect(pick('Rename the heading in @not', 'archive/notes-2024.md').text).toBe('Rename the heading in archive/notes-2024.md ')
  })

  it('quote a path that holds a space, and close the quote', () => {
    expect(pick('Open @My', 'My Notes.md', 8, [{ path: 'My Notes.md', folder: false }])).toEqual({ text: 'Open "My Notes.md" ', caret: 19 })
  })

  it('keep the space already after the word, not double it', () => {
    expect(pick('Open @not now', 'notes.md', 9)).toEqual({ text: 'Open notes.md now', caret: 14 })
  })

  it('leave a folder as a mention with no space, so the list goes on into it', () => {
    const next = pick('Open @not', 'notebooks/')
    expect(next).toEqual({ text: 'Open @notebooks/', caret: 16 })
    expect(mentionWord(next.text, next.caret)).toBe('@notebooks/')
    expect(files(next.text, next.caret).open).toBe(true)
    const inside = pick('Open @My', 'My Folder/', 8, [{ path: 'My Folder/', folder: true }])
    expect(inside).toEqual({ text: 'Open @"My Folder/', caret: 17 })
    expect(mentionWord(inside.text, inside.caret), 'the quote stays open').toBe('@My Folder/')
  })

  it('go on into a folder whose path holds a double quote and no space', () => {
    const next = pick('Open @a', 'a"b/', 7, [{ path: 'a"b/', folder: true }])
    expect(next).toEqual({ text: 'Open @a"b/', caret: 10 })
    expect(mentionWord(next.text, next.caret)).toBe('@a"b/')
  })

  it('put a folder whose path holds a space and a double quote in as plain text, since a quoted mention cannot hold the quote', () => {
    expect(pick('Open @My', 'My "Notes"/', 8, [{ path: 'My "Notes"/', folder: true }])).toEqual({ text: 'Open "My "Notes"/" ', caret: 19 })
  })

  it('mark rows left from an older word as not current until the new word is answered', () => {
    const current = (sources: MenuSources) => opened(files('Open @notebooks/', 16, sources)).items.map(item => item.kind === 'file' && item.current)
    expect(current(WITH_FILES)).toEqual([false, false, false])
    expect(current({ ...SOURCES, files: { word: '@notebooks/', matches: [{ path: 'notebooks/plan.md', folder: false }] } })).toEqual([true])
  })

  it('keep the text after a folder pick as it was', () => {
    expect(pick('Open @not now', 'notebooks/', 9)).toEqual({ text: 'Open @notebooks/ now', caret: 16 })
  })

  it('give completion text for a file or folder with no space in its path', () => {
    expect(completionOf({ kind: 'file', match: { path: 'a/b.md', folder: false }, current: true })).toBe('a/b.md ')
    expect(completionOf({ kind: 'file', match: { path: 'a/', folder: true }, current: true })).toBe('@a/')
  })
})

describe('the word Hermes completes', () => {
  it('is the @ and what follows it, without a quote, at the caret', () => {
    expect(mentionWord('Rename the heading in @not', 26)).toBe('@not')
    expect(mentionWord('Open @notebooks/', 16)).toBe('@notebooks/')
    expect(mentionWord('Open @"My Fol', 13)).toBe('@My Fol')
    expect(mentionWord('Open @', 6)).toBe('@')
  })

  it('is nothing outside a mention', () => {
    expect(mentionWord('Rename the heading', 18)).toBeNull()
    expect(mentionWord('Open @notes.md now', 18)).toBeNull()
    expect(mentionWord('/status', 7)).toBeNull()
  })
})

describe('the bots a message can be handed to', () => {
  const ids = (...args: Parameters<typeof mentionable>) => mentionable(...args).map(({ bot }) => bot.id)

  it('are every listed bot but the one of the open chat', () => {
    expect(ids(TEAM, CAN_RELAY, 'sam' as BotId)).toEqual(['default', 'rae-writer', 'timothy', 'samira'])
    expect(ids(TEAM, CAN_RELAY, null)).toHaveLength(5)
  })

  it('are none on a Hermes that cannot hand a message over, or before it listed its bots', () => {
    expect(ids(TEAM, { supported: false, bySession: {} }, ADA)).toEqual([])
    expect(ids(TEAM, undefined, ADA)).toEqual([])
    expect(ids({ state: 'loading' }, CAN_RELAY, ADA)).toEqual([])
    expect(ids(undefined, CAN_RELAY, ADA)).toEqual([])
    expect(at('Ask @', 5, fresh, { catalog: CATALOG, bots: [], files: { word: null, matches: [] } })).toEqual({ open: false })
  })
})
