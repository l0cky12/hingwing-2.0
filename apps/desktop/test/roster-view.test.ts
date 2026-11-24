import type { BotId, Bots, OpenChat, SessionId } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { initialOf, listOf, selectedIn, type ListView } from '../src/renderer/bots/roster-view'
import { APPROVED, listed } from './support/bots'

const outline = (view: ListView) => (view.show !== 'roster' ? view : [
  ...(view.featured === null ? [] : [`* ${view.featured.name}`]),
  ...view.sections.flatMap(section => [section.name ?? '(no section)', ...section.bots.map(bot => `  ${bot.name}`)])
])
const id = (name: string) => name as BotId
const showing = (bot: string | null, sessionId: string | null = 's1'): OpenChat =>
  ({ shown: (bot === null ? { kind: 'chat', bot, sessionId } : { kind: 'bot', bot, sessionId }) as OpenChat['shown'], opening: null })
const drafting = (bot: string | null, sessionId: string | null = null): OpenChat =>
  ({ shown: { kind: 'new', bot: bot as BotId | null, draftId: 'd1', sessionId: sessionId as SessionId }, opening: null })

describe('what the bot list shows', () => {
  it('is empty and busy until Hermes has answered', () => {
    expect(listOf(undefined, null)).toEqual({ show: 'loading' })
    expect(listOf({ state: 'loading' }, 'ops')).toEqual({ show: 'loading' })
  })

  it.each<[Bots, string]>([
    [{ state: 'offline' }, "Can't reach Hermes."],
    [{ state: 'unsupported' }, "This Hermes can't list its bots."],
    [{ state: 'refused' }, "Hermes wouldn't list its bots."],
    [listed(), 'No bots yet.']
  ])('says why there is no bot to draw: %o', (bots, words) => {
    expect(listOf(bots, null)).toEqual({ show: 'note', words })
    expect(listOf(bots, 'ops'), 'a search does not change the reason').toEqual({ show: 'note', words })
  })

  it('draws the default bot, then each section, with the bots in no section last', () => {
    const all = ['* Emu', 'New section', '  dr eggbot', '(no section)', '  Research', '  Timothy · CEO', '  Hermes', '  highwing']
    expect(outline(listOf(APPROVED, null))).toEqual(all)
    expect(outline(listOf(APPROVED, '')), 'an open, empty search').toEqual(all)
    expect(outline(listOf(APPROVED, '   ')), 'a search of spaces').toEqual(all)
  })

  it('narrows by name, whatever the case and the spaces around the words', () => {
    expect(outline(listOf(APPROVED, 'EGG'))).toEqual(['New section', '  dr eggbot'])
    expect(outline(listOf(APPROVED, ' ceo '))).toEqual(['(no section)', '  Timothy · CEO'])
    expect(outline(listOf(APPROVED, 'h'))).toEqual(['(no section)', '  Research', '  Timothy · CEO', '  Hermes', '  highwing'])
    expect(outline(listOf(APPROVED, 'emu'))).toEqual(['* Emu'])
  })

  it('says so, with the search as typed, when no bot matches', () => {
    expect(listOf(APPROVED, ' Zzz ')).toEqual({ show: 'note', words: 'No bots match “ Zzz ”' })
  })

  it('keeps each bot its tone while the list is narrowed', () => {
    const full = listOf(APPROVED, null)
    const narrowed = listOf(APPROVED, 'highwing')
    if (full.show !== 'roster' || narrowed.show !== 'roster') throw new Error('expected two rosters')
    const highwing = full.sections.flatMap(section => section.bots).find(bot => bot.name === 'highwing')
    expect(narrowed.sections[0]?.bots).toEqual([highwing])
    expect(highwing?.tone).toBe('mauve')
  })
})

describe('the selected bot', () => {
  it('is the bot of the open chat, started or not', () => {
    expect(selectedIn(APPROVED, showing('default'))).toBe('default')
    expect(selectedIn(APPROVED, showing('timothy'))).toBe('timothy')
    expect(selectedIn(APPROVED, showing('hermes-dev', null))).toBe('hermes-dev')
  })

  it("is the bot of a new chat, before and after its first message, and none for a new chat in the socket's own profile", () => {
    expect(selectedIn(APPROVED, drafting('timothy'))).toBe('timothy')
    expect(selectedIn(APPROVED, drafting('timothy', 's2'))).toBe('timothy')
    expect(selectedIn(APPROVED, drafting(null))).toBeNull()
  })

  it('stays on the open chat while a click on another bot waits for Hermes', () => {
    expect(selectedIn(APPROVED, { ...showing('default'), opening: { kind: 'bot', bot: id('timothy') } })).toBe('default')
  })

  it('is no bot when the open chat has none, when its bot is gone, or when nothing is open', () => {
    expect(selectedIn(APPROVED, showing(null))).toBeNull()
    expect(selectedIn(APPROVED, showing('retired'))).toBeNull()
    expect(selectedIn(APPROVED, { shown: null, opening: null })).toBeNull()
    expect(selectedIn(APPROVED, undefined)).toBeNull()
  })

  it('is no bot while there is no roster', () => {
    expect(selectedIn(undefined, showing('timothy'))).toBeNull()
    expect(selectedIn({ state: 'offline' }, showing('timothy'))).toBeNull()
  })
})

describe('an avatar initial', () => {
  it('is the first letter, in upper case', () => {
    expect(initialOf('zed')).toBe('Z')
    expect(initialOf('Émile')).toBe('É')
  })

  it('keeps a flag and a joined emoji whole', () => {
    expect(initialOf('\u{1F1EE}\u{1F1EA} Dublin desk')).toBe('\u{1F1EE}\u{1F1EA}')
    expect(initialOf('\u{1F9D1}‍\u{1F680} Launch crew')).toBe('\u{1F9D1}‍\u{1F680}')
  })
})
