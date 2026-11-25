import type { BotId } from '@highwing/hermes/domain'
import type { OpenMenu } from './bot-menu'
import { rowsIn, type SidebarView } from './sidebar-view'

export type FocusTarget =
  | { readonly to: 'row'; readonly bot: BotId }
  | { readonly to: 'more'; readonly bot: BotId }
  | { readonly to: 'hidden' }
  | { readonly to: 'search' }

export const openerTarget = ({ bot, opener }: OpenMenu): FocusTarget => (opener.by === 'more' ? { to: 'more', bot } : { to: 'row', bot })

export const fallbackOf = (wanted: FocusTarget, view: SidebarView): readonly FocusTarget[] =>
  [wanted, ...rowsIn(view).map((row): FocusTarget => ({ to: 'row', bot: row.bot.id })), { to: 'search' }]

const ATTRIBUTES: { readonly [T in FocusTarget['to']]: string } = { row: 'data-bot', more: 'data-more', hidden: 'data-hidden-toggle', search: 'data-bots-search' }

function elementOf(sidebar: HTMLElement, target: FocusTarget): HTMLElement | undefined {
  const attribute = ATTRIBUTES[target.to]
  const found = [...sidebar.querySelectorAll<HTMLElement>(`[${attribute}]`)]
  return 'bot' in target ? found.find(element => element.getAttribute(attribute) === target.bot) : found[0]
}

function inView(element: HTMLElement): boolean {
  const list = element.closest('.bots-list')
  if (list === null) return true
  const [box, room] = [element.getBoundingClientRect(), list.getBoundingClientRect()]
  return box.top >= room.top && box.bottom <= room.bottom
}

export function focusIn(sidebar: HTMLElement, targets: readonly FocusTarget[], how: 'scroll' | 'in-view'): boolean {
  for (const target of targets) {
    const element = elementOf(sidebar, target)
    if (element === undefined || (how === 'in-view' && !inView(element))) continue
    element.focus({ preventScroll: how === 'in-view' })
    return true
  }
  return false
}

export const stayedIn = (sidebar: HTMLElement, active: Element | null): boolean =>
  active === null || active === active.ownerDocument.body || sidebar.contains(active)
