import type { SlashCatalog } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { completionOf, menuOf, type MenuState } from '../src/renderer/composer/slash-menu'

const CATALOG: SlashCatalog = [
  { kind: 'command', name: 'context', description: 'Show detailed context window view' },
  { kind: 'command', name: 'convert', description: 'Convert the units in the last answer' },
  { kind: 'command', name: 'status', description: 'Show session, model, token, and context info' },
  { kind: 'skill', name: 'code-review', description: 'Review the current diff' }
]
const fresh: MenuState = { active: 0, dismissedDraft: null }
const names = (draft: string, state: MenuState = fresh) => {
  const menu = menuOf(draft, CATALOG, state)
  return menu.open ? menu.matches.map(entry => entry.name) : null
}

describe('menuOf', () => {
  it('lists every entry for a lone slash, commands before skills as the catalog orders them', () => {
    expect(names('/')).toEqual(['context', 'convert', 'status', 'code-review'])
  })

  it('narrows to the names that start with what follows the slash, ignoring case', () => {
    expect(names('/co')).toEqual(['context', 'convert', 'code-review'])
    expect(names('/CON')).toEqual(['context', 'convert'])
  })

  it('opens nothing for a slash mid-sentence, after a space, with no match, or with no catalog', () => {
    expect(names('hello /')).toBeNull()
    expect(names('/status ')).toBeNull()
    expect(names('/zzz')).toBeNull()
    expect(menuOf('/', [], fresh)).toEqual({ open: false })
  })

  it('stays closed on the text Escape closed it on, and opens again once the text changes', () => {
    expect(names('/co', { active: 0, dismissedDraft: '/co' })).toBeNull()
    expect(names('/cod', { active: 0, dismissedDraft: '/co' })).toEqual(['code-review'])
  })

  it('wraps the active row both ways', () => {
    expect(menuOf('/co', CATALOG, { active: 3, dismissedDraft: null })).toMatchObject({ active: 0 })
    expect(menuOf('/co', CATALOG, { active: -1, dismissedDraft: null })).toMatchObject({ active: 2 })
  })
})

describe('completionOf', () => {
  it('puts the full name and a space in the box', () => {
    expect(completionOf(CATALOG[1]!)).toBe('/convert ')
  })
})
