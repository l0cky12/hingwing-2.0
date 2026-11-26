import type { ReactNode } from 'react'
import { MENU_ICONS } from '../chrome/menu-icons'
import type { Anchor } from '../chrome/popup-menu'
import { ICON, PopupMenu } from '../chrome/PopupMenu'
import type { MenuAction, MenuItem } from './bot-menu'
import { isIn, type FocusTarget } from './focus'

const BUBBLE = 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'

const ICONS: { readonly [A in MenuAction]: ReactNode } = {
  open: <svg {...ICON}><path d={BUBBLE} /></svg>,
  new: <svg {...ICON}><path d={BUBBLE} /><path d="M12 7v6M9 10h6" /></svg>,
  edit: MENU_ICONS.edit,
  pin: MENU_ICONS.pin,
  unpin: MENU_ICONS.unpin,
  hide: <svg {...ICON}><path d="M10.7 5.1A10 10 0 0 1 12 5c7 0 10 7 10 7a13 13 0 0 1-1.7 2.7M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2M3 3l18 18" /></svg>,
  show: <svg {...ICON}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  delete: MENU_ICONS.delete
}

export interface RowMenuProps<A extends MenuAction> {
  readonly name: string
  readonly items: readonly (readonly MenuItem<A>[])[]
  /** The row's ⋯ button. A press on it closes the menu by toggling, not as a press away. */
  readonly more: FocusTarget
  readonly anchor: () => Anchor
  readonly onChoose: (action: A) => void
  readonly onClose: (how: 'escape' | 'tab' | 'away') => void
}

export function RowMenu<A extends MenuAction>({ name, items, more, anchor, onChoose, onClose }: RowMenuProps<A>) {
  return (
    <PopupMenu
      label={`More for ${name}`} className="bot-menu"
      groups={items.map(group => group.map(({ action, label, block }) => ({ id: action, label, icon: ICONS[action], ...(block === null ? {} : { block }) })))}
      anchor={anchor} owns={target => isIn(target, more)} onChoose={onChoose} onClose={onClose}
    />
  )
}
