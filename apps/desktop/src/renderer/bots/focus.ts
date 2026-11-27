import type { BotId, GroupId } from '@highwing/hermes/domain'
import type { MenuOwner, OpenMenu } from './bot-menu'
import { rowsIn, type SidebarView } from './sidebar-view'

export type FocusTarget =
  | { readonly to: 'row'; readonly bot: BotId }
  | { readonly to: 'more'; readonly bot: BotId }
  | { readonly to: 'group'; readonly group: GroupId }
  | { readonly to: 'group-more'; readonly group: GroupId }
  | { readonly to: 'hidden' }
  | { readonly to: 'search' }

export const rowOf = (owner: MenuOwner): FocusTarget => (owner.kind === 'bot' ? { to: 'row', bot: owner.bot } : { to: 'group', group: owner.group })
export const moreOf = (owner: MenuOwner): FocusTarget => (owner.kind === 'bot' ? { to: 'more', bot: owner.bot } : { to: 'group-more', group: owner.group })

export const openerTarget = ({ owner, opener }: OpenMenu): FocusTarget => (opener.by === 'more' ? moreOf(owner) : rowOf(owner))

const botRows = (view: SidebarView) => rowsIn(view).map((row): FocusTarget => ({ to: 'row', bot: row.bot.id }))

export const fallbackOf = (wanted: FocusTarget, view: SidebarView): readonly FocusTarget[] => [wanted, ...botRows(view), { to: 'search' }]

/** Where focus goes once a group's row leaves the list: the group below it, else the one above, else the first bot. */
export function afterGroupOf(group: GroupId, groups: readonly GroupId[], view: SidebarView): readonly FocusTarget[] {
  const at = groups.indexOf(group)
  const near = [...groups.slice(at + 1), ...groups.slice(0, Math.max(at, 0)).reverse()]
  return [...near.map((id): FocusTarget => ({ to: 'group', group: id })), ...botRows(view), { to: 'search' }]
}

const ATTRIBUTES: { readonly [T in FocusTarget['to']]: string } = {
  row: 'data-bot', more: 'data-more', group: 'data-group', 'group-more': 'data-group-more', hidden: 'data-hidden-toggle', search: 'data-bots-search'
}

const keyOf = (target: FocusTarget): string | null => ('bot' in target ? target.bot : 'group' in target ? target.group : null)

export function elementIn(sidebar: HTMLElement, target: FocusTarget): HTMLElement | undefined {
  const attribute = ATTRIBUTES[target.to]
  const key = keyOf(target)
  const found = [...sidebar.querySelectorAll<HTMLElement>(`[${attribute}]`)]
  return key === null ? found[0] : found.find(element => element.getAttribute(attribute) === key)
}

/** Whether `element` is the target or inside it. */
export function isIn(element: Element, target: FocusTarget): boolean {
  const attribute = ATTRIBUTES[target.to]
  const key = keyOf(target)
  const held = element.closest(`[${attribute}]`)
  return held !== null && (key === null || held.getAttribute(attribute) === key)
}

function inView(element: HTMLElement): boolean {
  const list = element.closest('.bots-list')
  if (list === null) return true
  const [box, room] = [element.getBoundingClientRect(), list.getBoundingClientRect()]
  return box.top >= room.top && box.bottom <= room.bottom
}

export function focusIn(sidebar: HTMLElement, targets: readonly FocusTarget[], how: 'scroll' | 'in-view'): boolean {
  for (const target of targets) {
    const element = elementIn(sidebar, target)
    if (element === undefined || (how === 'in-view' && !inView(element))) continue
    element.focus({ preventScroll: how === 'in-view' })
    return true
  }
  return false
}

export const stayedIn = (sidebar: HTMLElement, active: Element | null): boolean =>
  active === null || active === active.ownerDocument.body || sidebar.contains(active)
