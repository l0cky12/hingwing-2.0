import { rosterOf, type BotFacts, type BotId, type BotMark, type Bots, type GroupId } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { anchorOf, botMenuOf, DELETE_WORDS, deleteRefusal, groupMenuOf, MENUS, type MenuOwner, type OpenMenu } from '../src/renderer/bots/bot-menu'
import { EDGE, GAP, isMenuKey, keyMove, placeMenu, type Box } from '../src/renderer/chrome/popup-menu'
import { afterGroupOf, fallbackOf, openerTarget } from '../src/renderer/bots/focus'
import { busyIn, focusAfter, runsAt, SAID, type MarkRun } from '../src/renderer/bots/marks'
import { listOf } from '../src/renderer/bots/roster-view'
import { sidebarOf, type BotPlace } from '../src/renderer/bots/sidebar-view'
import { fact, listed } from './support/bots'

const id = (name: string) => name as BotId
const words = (place: BotPlace, featured = false) => botMenuOf(place, featured).map(group => group.map(item => item.label))
const actions = (place: BotPlace, featured = false) => botMenuOf(place, featured).flat().map(item => item.action)

describe("a bot's menu", () => {
  it('offers a normal row Open chat and New chat, Edit…, then Pin to top and Hide from list', () => {
    expect(words('section')).toEqual([['Open chat', 'New chat'], ['Edit…'], ['Pin to top', 'Hide from list'], ['Delete…']])
  })

  it('offers Unpin on a pinned row, no Pin on the default bot, and Show in list on a hidden row', () => {
    expect(words('pinned')).toEqual([['Open chat', 'New chat'], ['Edit…'], ['Unpin', 'Hide from list'], ['Delete…']])
    expect(words('card', true)).toEqual([['Open chat', 'New chat'], ['Edit…', 'Memory…'], ['Hide from list']])
    expect(words('hidden', true)).toEqual([['Open chat', 'New chat'], ['Edit…', 'Memory…'], ['Show in list'], ['Delete…']])
    expect(words('hidden')).toEqual([['Open chat', 'New chat'], ['Edit…'], ['Show in list'], ['Delete…']])
  })

  it('offers Delete… last in every menu except the default bot\'s card', () => {
    expect(MENUS.card.flat()).not.toContain('delete')
    expect(actions('card', true)).not.toContain('delete')
    for (const place of ['pinned', 'section', 'hidden'] as const) expect(MENUS[place].flat().at(-1), place).toBe('delete')
  })

  it('says how to delete a bot on the Hermes machine, and that Hermes keeps its default bot', () => {
    const bots = listed(fact('default', 'Hermes', { isDefault: true, hidden: true }), fact('editor', 'Editor'))
    if (bots.state !== 'listed' || bots.roster.featured === null) throw new Error('expected a listed roster with a default bot')
    const editor = bots.roster.sections.flatMap(section => section.bots).find(bot => bot.id === 'editor')!
    expect(deleteRefusal(editor, false)).toBe("This Hermes can't delete bots from Highwing. To delete Editor, run hermes profile delete editor on the Hermes machine.")
    expect(deleteRefusal(bots.roster.featured, true)).toBe("The default bot can't be deleted.")
  })

  it('keeps Edit… third in every menu, and Memory… only on the default bot', () => {
    for (const place of ['card', 'pinned', 'section', 'hidden'] as const) {
      expect(actions(place, false)[2], place).toBe('edit')
      expect(actions(place, true)[2], place).toBe('edit')
      expect(actions(place, true)[3], place).toBe('memory')
      expect(actions(place, false), place).not.toContain('memory')
    }
  })

  it('opens from Shift+F10 and the Menu key, and not from F10 alone', () => {
    expect(isMenuKey({ key: 'F10', shiftKey: true })).toBe(true)
    expect(isMenuKey({ key: 'ContextMenu', shiftKey: false })).toBe(true)
    expect(isMenuKey({ key: 'F10', shiftKey: false })).toBe(false)
    expect(isMenuKey({ key: 'Enter', shiftKey: true })).toBe(false)
  })

  it('can use every item at once', () => {
    for (const place of ['card', 'pinned', 'section', 'hidden'] as const) expect(botMenuOf(place).flat().every(item => item.block === null), place).toBe(true)
  })
})

describe("a group chat's menu", () => {
  it('offers Open and Edit…, then Delete… on its own', () => {
    expect(groupMenuOf({ state: 'online' }).map(group => group.map(item => [item.label, item.block]))).toEqual([[['Open', null], ['Edit…', null]], [['Delete…', null]]])
  })

  it('says why Edit… and Delete… cannot be used while Highwing is not connected, and still opens the group', () => {
    const offline = "Highwing isn't connected to Hermes right now."
    for (const link of [{ state: 'connecting', attempt: 2 } as const, undefined]) {
      expect(groupMenuOf(link).flat().map(item => [item.action, item.block])).toEqual([['open', null], ['edit', offline], ['delete', offline]])
    }
  })

  it('says what deleting takes, and that Hermes cannot bring it back', () => {
    expect(DELETE_WORDS.group).toBe("Hermes ends this group chat and deletes its messages. It can't bring them back.")
    expect(DELETE_WORDS.bot).toBe("Hermes removes the bot, its chats and its settings. It can't bring them back.")
  })
})

describe("where a bot's menu sits", () => {
  const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom })
  const ROW = box(8, 200, 280, 252)
  const MORE = box(244, 212, 272, 240)
  const CARD = box(8, 64, 280, 176)
  const CARD_MORE = box(244, 72, 272, 100)
  const MENU = { width: 150, height: 180 }
  const WINDOW = { width: 1180, height: 860 }

  it('opens at the pointer for a right-click', () => {
    expect(placeMenu(anchorOf({ by: 'pointer', x: 120, y: 230 }, 'section', { row: ROW, more: MORE }), MENU, WINDOW)).toEqual({ left: 120, top: 230 })
  })

  it('opens leftward or upward from the pointer when short of room', () => {
    expect(placeMenu({ at: 'point', x: 1100, y: 800 }, MENU, WINDOW)).toEqual({ left: 950, top: 620 })
  })

  it("opens 2px under a row's ⋯, right-aligned to it, from ⋯ or the keyboard", () => {
    const under = { left: MORE.right - MENU.width, top: MORE.bottom + GAP }
    expect(placeMenu(anchorOf({ by: 'more' }, 'section', { row: ROW, more: MORE }), MENU, WINDOW)).toEqual(under)
    expect(placeMenu(anchorOf({ by: 'keys' }, 'pinned', { row: ROW, more: MORE }), MENU, WINDOW)).toEqual(under)
  })

  it('opens 2px under the whole card for the default bot, right-aligned to its ⋯', () => {
    expect(placeMenu(anchorOf({ by: 'keys' }, 'card', { row: CARD, more: CARD_MORE }), MENU, WINDOW)).toEqual({ left: CARD_MORE.right - MENU.width, top: CARD.bottom + GAP })
  })

  it('flips over ⋯ near the bottom edge', () => {
    const low = box(244, 760, 272, 788)
    expect(placeMenu(anchorOf({ by: 'more' }, 'section', { row: ROW, more: low }), MENU, WINDOW)).toEqual({ left: low.right - MENU.width, top: low.top - GAP - MENU.height })
  })

  it('stays inside the window on both axes, never touching its edge', () => {
    expect(placeMenu({ at: 'under', right: 60, top: 4, bottom: 10 }, MENU, { width: 300, height: 150 })).toEqual({ left: EDGE, top: EDGE })
  })
})

describe('keys in the menu', () => {
  it('step with the arrows, Home and End, wrapping at both ends', () => {
    expect(keyMove('ArrowDown', 4, 5)).toEqual({ do: 'step', to: 0 })
    expect(keyMove('ArrowUp', 0, 5)).toEqual({ do: 'step', to: 4 })
    expect(keyMove('End', 1, 5)).toEqual({ do: 'step', to: 4 })
    expect(keyMove('Home', 3, 5)).toEqual({ do: 'step', to: 0 })
  })

  it('close on Escape and Tab, keep the paging keys from the thread, and leave Enter and letters alone', () => {
    expect(keyMove('Escape', 0, 5)).toEqual({ do: 'escape' })
    expect(keyMove('Tab', 0, 5)).toEqual({ do: 'tab' })
    expect(keyMove('PageDown', 0, 5)).toEqual({ do: 'swallow' })
    expect(keyMove('Enter', 0, 5)).toBeNull()
    expect(keyMove('a', 0, 5)).toBeNull()
  })
})

describe('focus when the menu closes', () => {
  const menu = (by: 'pointer' | 'more' | 'keys', owner: MenuOwner = { kind: 'bot', bot: id('scout') }): OpenMenu =>
    ({ owner, opener: by === 'pointer' ? { by, x: 1, y: 1 } : { by }, above: '[]', scrolled: 0 })
  const view = sidebarOf(listOf(listed(fact('default', 'Hermes', { isDefault: true }), fact('editor', 'Editor')), null), false, null)

  it('goes back to ⋯ only when ⋯ opened the menu, and to the row otherwise', () => {
    expect(openerTarget(menu('more'))).toEqual({ to: 'more', bot: 'scout' })
    expect(openerTarget(menu('pointer'))).toEqual({ to: 'row', bot: 'scout' })
    expect(openerTarget(menu('keys'))).toEqual({ to: 'row', bot: 'scout' })
  })

  it("goes back to a group's own ⋯ or row, never a bot's of the same name", () => {
    const plan: MenuOwner = { kind: 'group', group: 'scout' as GroupId }
    expect(openerTarget(menu('more', plan))).toEqual({ to: 'group-more', group: 'scout' })
    expect(openerTarget(menu('keys', plan))).toEqual({ to: 'group', group: 'scout' })
  })

  it('falls back to each row in the page from the top, then search', () => {
    expect(fallbackOf({ to: 'row', bot: id('gone') }, view)).toEqual([{ to: 'row', bot: 'gone' }, { to: 'row', bot: 'default' }, { to: 'row', bot: 'editor' }, { to: 'search' }])
  })

  it('moves from a deleted group to the group below it, else the one above, else the first bot', () => {
    const groups = ['plan', 'standup', 'ops'] as GroupId[]
    const group = (name: string) => ({ to: 'group', group: name })
    const bots = [{ to: 'row', bot: 'default' }, { to: 'row', bot: 'editor' }, { to: 'search' }]
    expect(afterGroupOf('standup' as GroupId, groups, view)).toEqual([group('ops'), group('plan'), ...bots])
    expect(afterGroupOf('ops' as GroupId, groups, view)).toEqual([group('standup'), group('plan'), ...bots])
    expect(afterGroupOf('plan' as GroupId, ['plan'] as GroupId[], view)).toEqual(bots)
  })
})

describe('a pin or a hide on its way to Hermes', () => {
  const run = (mark: BotMark, more: Partial<MarkRun> = {}): MarkRun =>
    ({ id: 1, bot: id('copywriter'), name: 'Copywriter', mark, rows: [], since: 3, edition: null, ...more })
  const at = (edition: number): Bots => ({ state: 'listed', roster: rosterOf([fact('copywriter', 'Copywriter')]), edition })

  it('says what happened, in words for each mark', () => {
    expect(SAID.pin('Researcher')).toBe('Pinned Researcher.')
    expect(SAID.unpin('Researcher')).toBe('Unpinned Researcher.')
    expect(SAID.hide('Copywriter')).toBe("Hid Copywriter. It's under Hidden.")
    expect(SAID.show('Old Helper')).toBe('Old Helper is back in the list.')
  })

  it('keeps its row busy until it lands', () => {
    expect([...busyIn([run('pin'), run('hide', { id: 2, bot: id('editor') })])]).toEqual(['copywriter', 'editor'])
  })

  it('waits for Hermes, then lands once the roster reaches the edition Hermes answered', () => {
    const saving = run('pin')
    expect(runsAt([saving], at(3))).toEqual({ landed: [], waiting: [saving] })
    const saved = run('pin', { edition: 4 })
    expect(runsAt([saved], at(3)), 'the reply came before the roster').toEqual({ landed: [], waiting: [saved] })
    expect(runsAt([saved], at(4))).toEqual({ landed: [saved], waiting: [] })
    expect(runsAt([saved], at(6)), 'the roster came first, and moved on since').toEqual({ landed: [saved], waiting: [] })
  })

  it('is dropped when the roster stops being listed, or a new connection starts its count again', () => {
    const saved = run('hide', { edition: 4 })
    expect(runsAt([saved], { state: 'loading' })).toEqual({ landed: [], waiting: [] })
    expect(runsAt([saved, run('pin', { id: 2 })], at(1))).toEqual({ landed: [], waiting: [] })
  })
})

describe('focus once a mark lands', () => {
  const BOTS = ['editor', 'copywriter', 'researcher', 'scout'] as const
  const drawn = (marks: Partial<Record<(typeof BOTS)[number], Partial<BotFacts>>>, hiddenOpen = false) =>
    sidebarOf(listOf(listed(...BOTS.map(bot => fact(bot, bot, { section: bot === 'scout' ? null : 'Work', ...marks[bot] }))), null), hiddenOpen, null)
  const landed = (mark: BotMark, bot: (typeof BOTS)[number], rows: readonly string[] = BOTS): MarkRun =>
    ({ id: 1, bot: id(bot), name: bot, mark, rows: rows.map(id), since: 1, edition: 2 })

  it('follows a pinned, unpinned or shown bot to its new row', () => {
    expect(focusAfter(landed('pin', 'researcher'), drawn({ researcher: { pinned: true } }))[0]).toEqual({ to: 'row', bot: 'researcher' })
    expect(focusAfter(landed('show', 'scout'), drawn({}))[0]).toEqual({ to: 'row', bot: 'scout' })
  })

  it('moves from a hidden bot to the next row below it still in the list, never to its dimmed row', () => {
    expect(focusAfter(landed('hide', 'copywriter'), drawn({ copywriter: { hidden: true } }, true))).toEqual([{ to: 'row', bot: 'researcher' }])
    expect(focusAfter(landed('hide', 'copywriter'), drawn({ copywriter: { hidden: true }, researcher: { hidden: true } }))).toEqual([{ to: 'row', bot: 'scout' }])
  })

  it('moves to the row above when none below is left, and to the Hidden toggle when none is left at all', () => {
    expect(focusAfter(landed('hide', 'scout'), drawn({ scout: { hidden: true } }))).toEqual([{ to: 'row', bot: 'researcher' }])
    const allHidden = drawn({ editor: { hidden: true }, copywriter: { hidden: true }, researcher: { hidden: true }, scout: { hidden: true } })
    expect(focusAfter(landed('hide', 'scout'), allHidden)[0]).toEqual({ to: 'hidden' })
  })
})
