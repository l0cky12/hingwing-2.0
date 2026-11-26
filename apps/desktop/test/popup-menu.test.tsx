import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { anchorAt, EDGE, GAP, placeSubmenu, type Box } from '../src/renderer/chrome/popup-menu'
import { PopupMenu } from '../src/renderer/chrome/PopupMenu'

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom })

describe('where a menu opens', () => {
  const MORE = box(244, 212, 272, 240)

  it('is the pointer for a right-click, and under the box named, right-aligned, otherwise', () => {
    expect(anchorAt({ by: 'pointer', x: 120, y: 230 }, MORE, MORE.right)).toEqual({ at: 'point', x: 120, y: 230 })
    expect(anchorAt({ by: 'more' }, MORE, MORE.right)).toEqual({ at: 'under', right: 272, top: 212, bottom: 240 })
    expect(anchorAt({ by: 'keys' }, box(8, 200, 280, 252), MORE.right)).toEqual({ at: 'under', right: 272, top: 200, bottom: 252 })
  })
})

describe('where a submenu opens', () => {
  const MENU = box(100, 200, 300, 500)
  const ITEM = box(103, 240, 297, 268)
  const SUB = { width: 220, height: 160 }
  const WINDOW = { width: 1180, height: 860 }

  it('opens right of the menu with its first choice level with the item', () => {
    expect(placeSubmenu(ITEM, MENU, SUB, WINDOW, 4)).toEqual({ left: MENU.right + GAP, top: ITEM.top - 4 })
  })

  it('opens left of the menu when the window has no room on the right', () => {
    const right = box(900, 200, 1100, 500)
    expect(placeSubmenu(box(903, 240, 1097, 268), right, SUB, WINDOW, 4)).toEqual({ left: right.left - GAP - SUB.width, top: 236 })
  })

  it('stays inside the window, never touching its edge', () => {
    expect(placeSubmenu(box(103, 800, 297, 828), MENU, SUB, WINDOW, 4)).toEqual({ left: MENU.right + GAP, top: WINDOW.height - SUB.height - EDGE })
    expect(placeSubmenu(ITEM, box(2, 200, 200, 500), SUB, { width: 300, height: 860 }, 4).left).toBe(EDGE)
  })
})

describe('a popup menu', () => {
  const markup = renderToStaticMarkup(
    <PopupMenu
      label="More for Sort the invoices" className="chat-menu" anchor={() => ({ at: 'point', x: 0, y: 0 })} owns={() => false} onChoose={() => {}} onClose={() => {}}
      groups={[[{ id: 'pin', label: 'Pin' }, { id: 'snooze', label: 'Snooze', submenu: [{ id: 'hour', label: 'In 1 hour', hint: '1:00 PM' }] }], [{ id: 'rename', label: 'Rename…' }]]}
    />
  )
  const items = [...markup.matchAll(/<button[^>]*role="menuitem"[^>]*>(.*?)<\/button>/g)].map(([tag, inner]) => ({ tag, name: inner!.replace(/<[^>]*>/g, '') }))

  it('is a menu named for its row, its groups split by separators, with no item in the tab order', () => {
    expect(markup).toMatch(/role="menu" aria-label="More for Sort the invoices"/)
    expect(items.map(item => item.name)).toEqual(['Pin', 'Snooze', 'Rename…'])
    expect(markup.match(/role="separator"/g)).toHaveLength(1)
    expect(items.every(item => item.tag.includes('tabindex="-1"'))).toBe(true)
  })

  it('marks an item that opens a submenu, closed until it is opened', () => {
    const snooze = items.find(item => item.name === 'Snooze')!.tag
    expect(snooze).toContain('aria-haspopup="menu"')
    expect(snooze).toContain('aria-expanded="false"')
    expect(items.find(item => item.name === 'Pin')!.tag).not.toContain('aria-haspopup')
    expect(markup).not.toContain('In 1 hour')
  })
})
