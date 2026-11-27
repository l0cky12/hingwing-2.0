import type { BotFacts, BotId } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { botIn, listOf } from '../src/renderer/bots/roster-view'
import { drawnAbove, HIDDEN_CLOSED, hiddenTriggers, lineOf, nextHidden, NO_MESSAGES, rowsIn, sidebarOf, type HiddenState, type HiddenTrigger, type SidebarView } from '../src/renderer/bots/sidebar-view'
import { fact, listed } from './support/bots'

const id = (name: string) => name as BotId
const HERMES = fact('default', 'Hermes', { isDefault: true })
const WRITING = [
  fact('editor', 'Editor', { section: 'Writing' }),
  fact('copywriter', 'Copywriter', { section: 'Writing' }),
  fact('researcher', 'Researcher', { section: 'Research' }),
  fact('scout', 'Scout')
]
const drawn = (facts: readonly BotFacts[], { open = false, query = null, selected = null }: { open?: boolean; query?: string | null; selected?: string | null } = {}) =>
  sidebarOf(listOf(listed(...facts), query), open, selected === null ? null : id(selected))
const outline = (view: SidebarView) => {
  if (view.show !== 'groups') return view
  return [
    ...(view.card === null ? [] : [`* ${view.card.name}`]),
    ...view.groups.flatMap(group => [group.heading, ...group.bots.map(bot => `  ${bot.name}`)]),
    ...(view.hidden === null ? [] : [`${view.hidden.open ? 'v' : '>'} Hidden (${view.hidden.bots.length})`, ...(view.hidden.open ? view.hidden.bots.map(bot => `  ${bot.name}`) : [])])
  ]
}
const marked = (bot: string, more: Partial<BotFacts>) => [HERMES, ...WRITING].map(held => (held.id === bot ? { ...held, ...more } : held))

describe('what the Bots column draws', () => {
  it('draws the default bot as the card, then each Hermes section, with no Pinned heading and no Hidden group when no bot is marked', () => {
    expect(outline(drawn([HERMES, ...WRITING]))).toEqual(['* Hermes', 'Writing', '  Editor', '  Copywriter', 'Research', '  Researcher', 'Unassigned', '  Scout'])
  })

  it('moves a pinned bot under Pinned, below the card, and drops a section it emptied', () => {
    expect(outline(drawn(marked('researcher', { pinned: true })))).toEqual(['* Hermes', 'Pinned', '  Researcher', 'Writing', '  Editor', '  Copywriter', 'Unassigned', '  Scout'])
  })

  it('orders Pinned by section as Hermes lists them, then by Hermes order, with bots in no section last', () => {
    const facts = [HERMES, fact('scout', 'Scout', { pinned: true }), fact('copywriter', 'Copywriter', { section: 'Writing', pinned: true }), fact('editor', 'Editor', { section: 'Writing', pinned: true })]
    expect(outline(drawn(facts))).toEqual(['* Hermes', 'Pinned', '  Copywriter', '  Editor', '  Scout'])
  })

  it('keeps the default bot as the card when Hermes has it pinned, and never draws it twice', () => {
    expect(outline(drawn(marked('default', { pinned: true })))).toEqual(outline(drawn([HERMES, ...WRITING])))
  })

  it('collapses hidden bots into Hidden (N) at the bottom, and draws their rows only while it is open', () => {
    const facts = marked('copywriter', { hidden: true })
    expect(outline(drawn(facts))).toEqual(['* Hermes', 'Writing', '  Editor', 'Research', '  Researcher', 'Unassigned', '  Scout', '> Hidden (1)'])
    expect(outline(drawn(facts, { open: true }))).toEqual(['* Hermes', 'Writing', '  Editor', 'Research', '  Researcher', 'Unassigned', '  Scout', 'v Hidden (1)', '  Copywriter'])
  })

  it('draws no card for a hidden default bot, and lists it first under Hidden', () => {
    const facts = [{ ...HERMES, hidden: true }, ...WRITING.map(bot => (bot.id === 'scout' ? { ...bot, hidden: true } : bot))]
    expect(outline(drawn(facts, { open: true }))).toEqual(['Writing', '  Editor', '  Copywriter', 'Research', '  Researcher', 'v Hidden (2)', '  Hermes', '  Scout'])
  })

  it('draws a hidden pinned bot under Hidden only, and back under Pinned once it is shown', () => {
    expect(outline(drawn(marked('researcher', { pinned: true, hidden: true }), { open: true }))).not.toContain('Pinned')
    expect(outline(drawn(marked('researcher', { pinned: true, hidden: false })))).toContain('Pinned')
  })

  it('draws only Hidden when every bot is hidden', () => {
    expect(outline(drawn([HERMES, ...WRITING].map(bot => ({ ...bot, hidden: true }))))).toEqual(['> Hidden (5)'])
  })

  it('finds hidden bots by search, and still says when nothing matches', () => {
    expect(outline(drawn(marked('copywriter', { hidden: true }), { query: 'copy', open: true }))).toEqual(['v Hidden (1)', '  Copywriter'])
    expect(drawn(marked('copywriter', { hidden: true }), { query: 'zzz' })).toEqual({ show: 'note', words: 'No bots match “zzz”' })
  })

  it('marks Hidden as holding the open bot', () => {
    const facts = marked('copywriter', { hidden: true })
    const hiddenOf = (view: SidebarView) => (view.show === 'groups' ? view.hidden?.holdsOpenBot : undefined)
    expect(hiddenOf(drawn(facts, { selected: 'copywriter' }))).toBe(true)
    expect(hiddenOf(drawn(facts, { selected: 'editor' }))).toBe(false)
  })

  it('passes loading and every note through', () => {
    expect(sidebarOf({ show: 'loading' }, false, null)).toEqual({ show: 'loading' })
    expect(sidebarOf({ show: 'note', words: 'No bots yet.' }, false, null)).toEqual({ show: 'note', words: 'No bots yet.' })
  })
})

describe("the line under a bot's name", () => {
  const rowFor = (view: SidebarView, bot: string) => rowsIn(view).find(row => row.bot.id === bot)!
  const editor = rowFor(drawn(marked('editor', { preview: 'The intro reads well now' })), 'editor').bot
  const drafts = (text: string) => new Map([[id('editor'), text]])

  it('shows the first line of an unsent draft', () => {
    expect(lineOf(editor, drafts('Tighten the intro\nand the outro'), null)).toEqual({ kind: 'draft', text: 'Tighten the intro' })
  })

  it("shows the open chat's bot its last message, since its draft is in the composer", () => {
    expect(lineOf(editor, drafts('Tighten the intro'), id('editor'))).toEqual({ kind: 'last', text: 'The intro reads well now' })
  })

  it('shows the last message with no draft, or that there are none', () => {
    expect(lineOf(editor, new Map(), null)).toEqual({ kind: 'last', text: 'The intro reads well now' })
    expect(lineOf(rowFor(drawn([HERMES, ...WRITING]), 'scout').bot, drafts('Tighten the intro'), null)).toEqual({ kind: 'last', text: NO_MESSAGES })
  })

  it('skips blank lines and trims the line it shows', () => {
    expect(lineOf(editor, drafts('\n   \n  Tighten the intro  \nand the outro'), null)).toEqual({ kind: 'draft', text: 'Tighten the intro' })
  })

  it('shows the label alone for a draft of attachments only', () => {
    expect(lineOf(editor, drafts(''), null)).toEqual({ kind: 'draft', text: '' })
  })

  it('shows a draft on a Pinned row and on a row under Hidden', () => {
    const pinned = rowFor(drawn(marked('editor', { pinned: true })), 'editor')
    const hidden = rowFor(drawn(marked('editor', { hidden: true }), { open: true }), 'editor')
    expect([pinned.place, hidden.place]).toEqual(['pinned', 'hidden'])
    for (const row of [pinned, hidden]) expect(lineOf(row.bot, drafts('Tighten the intro'), null)).toEqual({ kind: 'draft', text: 'Tighten the intro' })
  })
})

describe('the rows in the page', () => {
  it('are the card, each group, then an open Hidden, top to bottom, each with its place', () => {
    const facts = [HERMES, ...WRITING.map(bot => (bot.id === 'researcher' ? { ...bot, pinned: true } : bot.id === 'scout' ? { ...bot, hidden: true } : bot))]
    const rows = (open: boolean) => rowsIn(drawn(facts, { open })).map(row => `${row.bot.id} ${row.place}`)
    expect(rows(false)).toEqual(['default card', 'researcher pinned', 'editor section', 'copywriter section'])
    expect(rows(true)).toEqual(['default card', 'researcher pinned', 'editor section', 'copywriter section', 'scout hidden'])
  })

  it('are none while loading or showing a note', () => {
    expect(rowsIn({ show: 'loading' })).toEqual([])
  })
})

describe('what is drawn above a row', () => {
  const before = drawn([HERMES, ...WRITING])

  it('stays the same when only rows below it change', () => {
    expect(drawnAbove(drawn([HERMES, ...WRITING.slice(0, 2)]), id('copywriter'))).toBe(drawnAbove(before, id('copywriter')))
    expect(drawnAbove(drawn(marked('scout', { hidden: true })), id('editor'))).toBe(drawnAbove(before, id('editor')))
  })

  it('changes when a row or a heading above it comes or goes', () => {
    expect(drawnAbove(drawn(marked('editor', { hidden: true })), id('copywriter'))).not.toBe(drawnAbove(before, id('copywriter')))
    expect(drawnAbove(drawn(marked('scout', { pinned: true })), id('editor')), 'a new Pinned heading').not.toBe(drawnAbove(before, id('editor')))
    expect(drawnAbove(drawn(marked('copywriter', { hidden: true }), { open: true }), id('copywriter')), 'from Writing to Hidden').not.toBe(drawnAbove(before, id('copywriter')))
  })

  it('is something for a hidden row only while Hidden is open', () => {
    const facts = marked('copywriter', { hidden: true })
    expect(drawnAbove(drawn(facts, { open: true }), id('copywriter'))).not.toBeNull()
    expect(drawnAbove(drawn(facts, { open: false }), id('copywriter')), 'a collapsed Hidden draws no row').toBeNull()
  })

  it('is nothing for a bot not in the page', () => {
    expect(drawnAbove(before, id('gone'))).toBeNull()
    expect(drawnAbove(drawn([HERMES, ...WRITING], { query: 'edit' }), id('scout'))).toBeNull()
  })
})

describe('the Hidden disclosure', () => {
  const render = (state: HiddenState, ...triggers: HiddenTrigger[]) => nextHidden(state, { on: 'render', triggers })
  const click = (state: HiddenState) => nextHidden(state, { on: 'click' })

  it('starts collapsed, and a click opens and closes it', () => {
    expect(HIDDEN_CLOSED.open).toBe(false)
    expect(click(HIDDEN_CLOSED).open).toBe(true)
    expect(click(click(HIDDEN_CLOSED)).open).toBe(false)
  })

  it('opens once for each reason, so a click can still close it while the reason holds', () => {
    const searched = render(HIDDEN_CLOSED, 'search')
    expect(searched.open).toBe(true)
    const closed = click(searched)
    expect(render(closed, 'search').open).toBe(false)
  })

  it('opens again for a new reason after a click closed it', () => {
    const closed = click(render(HIDDEN_CLOSED, 'open:old'))
    expect(render(closed, 'open:old', 'search').open).toBe(true)
    expect(render(click(render(closed, 'open:old')), 'open:retired').open, 'a second hidden bot opened').toBe(true)
  })

  it('opens again when a reason goes and comes back', () => {
    const closed = click(render(HIDDEN_CLOSED, 'search'))
    expect(render(render(closed), 'search').open).toBe(true)
  })

  it('keeps the same state for the same reasons, in any order', () => {
    const state = render(HIDDEN_CLOSED, 'search', 'open:old')
    expect(render(state, 'open:old', 'search')).toBe(state)
  })
})

describe('the reasons to open Hidden', () => {
  const facts = marked('copywriter', { hidden: true })
  const triggers = (query: string | null, open: string | null = null, all = facts) => {
    const bots = listed(...all)
    return hiddenTriggers(listOf(bots, query), (query ?? '').trim() !== '', open === null ? null : botIn(bots, id(open)))
  }

  it('is a search only while it shows a hidden bot', () => {
    expect(triggers('copy')).toEqual(['search'])
    expect(triggers('edit')).toEqual([])
    expect(triggers('  ')).toEqual([])
  })

  it('is the open chat while its bot is hidden', () => {
    expect(triggers(null, 'copywriter')).toEqual(['open:copywriter'])
    expect(triggers(null, 'editor')).toEqual([])
  })

  it('is every bot being hidden, when nothing is searched', () => {
    const all = facts.map(bot => ({ ...bot, hidden: true }))
    expect(triggers(null, null, all)).toEqual(['all-hidden'])
    expect(triggers('hermes', null, all)).toEqual(['search'])
  })
})
