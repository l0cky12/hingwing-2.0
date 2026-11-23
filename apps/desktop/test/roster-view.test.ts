import type { BotId, Bots } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { initialOf, listOf, selectedIn, type ListView } from '../src/renderer/bots/roster-view'
import { APPROVED, fact, listed } from './support/bots'

const outline = (view: ListView) => (view.show !== 'roster' ? view : [
  ...(view.featured === null ? [] : [`* ${view.featured.name}`]),
  ...view.sections.flatMap(section => [section.name ?? '(no section)', ...section.bots.map(bot => `  ${bot.name}`)])
])
const id = (name: string) => name as BotId

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
    const all = ['* Hermes Agent', 'Work', '  Researcher', '  Reviewer', '(no section)', '  Ops', '  Scribe']
    expect(outline(listOf(APPROVED, null))).toEqual(all)
    expect(outline(listOf(APPROVED, '')), 'an open, empty search').toEqual(all)
    expect(outline(listOf(APPROVED, '   ')), 'a search of spaces').toEqual(all)
  })

  it('narrows by name, whatever the case and the spaces around the words', () => {
    expect(outline(listOf(APPROVED, 'RE'))).toEqual(['Work', '  Researcher', '  Reviewer'])
    expect(outline(listOf(APPROVED, ' ops '))).toEqual(['(no section)', '  Ops'])
    expect(outline(listOf(APPROVED, 'hermes'))).toEqual(['* Hermes Agent'])
  })

  it('says so, with the search as typed, when no bot matches', () => {
    expect(listOf(APPROVED, ' Zzz ')).toEqual({ show: 'note', words: 'No bots match “ Zzz ”' })
  })

  it('keeps each bot its tone while the list is narrowed', () => {
    const full = listOf(APPROVED, null)
    const narrowed = listOf(APPROVED, 'scribe')
    if (full.show !== 'roster' || narrowed.show !== 'roster') throw new Error('expected two rosters')
    const scribe = full.sections.flatMap(section => section.bots).find(bot => bot.name === 'Scribe')
    expect(narrowed.sections[0]?.bots).toEqual([scribe])
    expect(scribe?.tone).toBe('olive')
  })
})

describe('the selected bot', () => {
  it('is the default bot until a click, then the clicked bot', () => {
    expect(selectedIn(APPROVED, null)).toBe('default')
    expect(selectedIn(APPROVED, id('reviewer'))).toBe('reviewer')
    expect(selectedIn(APPROVED, id('default'))).toBe('default')
  })

  it('is the default bot again when the clicked bot is gone, and no bot when there is no default', () => {
    expect(selectedIn(APPROVED, id('retired'))).toBe('default')
    const noDefault = listed(fact('a', 'A'), fact('b', 'B'))
    expect(selectedIn(noDefault, null)).toBeNull()
    expect(selectedIn(noDefault, id('b'))).toBe('b')
    expect(selectedIn(noDefault, id('retired'))).toBeNull()
  })

  it('is no bot while there is no roster', () => {
    expect(selectedIn(undefined, id('reviewer'))).toBeNull()
    expect(selectedIn({ state: 'offline' }, id('reviewer'))).toBeNull()
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
