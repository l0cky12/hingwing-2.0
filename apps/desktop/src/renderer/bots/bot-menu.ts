import type { BotId, BotMark } from '@highwing/hermes/domain'
import { menuStep } from '../chat/menu'
import type { BotPlace } from './sidebar-view'

export type MenuAction = 'open' | 'new' | 'edit' | BotMark | 'delete'

export const MENUS: { readonly [P in BotPlace]: readonly (readonly MenuAction[])[] } = {
  section: [['open', 'new'], ['edit'], ['pin', 'hide'], ['delete']],
  pinned: [['open', 'new'], ['edit'], ['unpin', 'hide'], ['delete']],
  card: [['open', 'new'], ['edit'], ['hide']],
  hidden: [['open', 'new'], ['edit'], ['show'], ['delete']]
}

export const LABELS: { readonly [A in MenuAction]: string } = {
  open: 'Open chat',
  new: 'New chat',
  edit: 'Edit…',
  pin: 'Pin to top',
  unpin: 'Unpin',
  hide: 'Hide from list',
  show: 'Show in list',
  delete: 'Delete…'
}

/** The default bot is Hermes's launch profile, so its menu has no Delete… wherever it is drawn, hidden included. */
export const menuOf = (place: BotPlace, isDefault: boolean): readonly (readonly MenuAction[])[] =>
  isDefault ? MENUS[place].filter(group => !group.includes('delete')) : MENUS[place]

// Hermes has no gateway method to delete a profile. `hermes profile delete` runs only on the Hermes machine.
export const DELETE_REFUSED = "This Hermes can't delete bots from Highwing."

export type Opener =
  | { readonly by: 'pointer'; readonly x: number; readonly y: number }
  | { readonly by: 'more' }
  | { readonly by: 'keys' }

export const isMenuKey = (event: { readonly key: string; readonly shiftKey: boolean }): boolean =>
  event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)

export interface OpenMenu {
  readonly bot: BotId
  readonly opener: Opener
  readonly above: string
  readonly scrolled: number
}

export interface Box { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export interface Size { readonly width: number; readonly height: number }

export type Anchor =
  | { readonly at: 'point'; readonly x: number; readonly y: number }
  | { readonly at: 'under'; readonly right: number; readonly top: number; readonly bottom: number }

export const GAP = 2
export const EDGE = 8

export function anchorOf(opener: Opener, place: BotPlace, measured: { readonly row: Box; readonly more: Box }): Anchor {
  if (opener.by === 'pointer') return { at: 'point', x: opener.x, y: opener.y }
  const under = place === 'card' ? measured.row : measured.more
  return { at: 'under', right: measured.more.right, top: under.top, bottom: under.bottom }
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high))

export function placeMenu(anchor: Anchor, menu: Size, window: Size): { readonly left: number; readonly top: number } {
  const fits = (start: number, length: number, room: number) => start + length <= room - EDGE
  const [left, top] = anchor.at === 'point'
    ? [fits(anchor.x, menu.width, window.width) ? anchor.x : anchor.x - menu.width, fits(anchor.y, menu.height, window.height) ? anchor.y : anchor.y - menu.height]
    : [anchor.right - menu.width, fits(anchor.bottom + GAP, menu.height, window.height) ? anchor.bottom + GAP : anchor.top - GAP - menu.height]
  return {
    left: clamp(left, EDGE, window.width - menu.width - EDGE),
    top: clamp(top, EDGE, window.height - menu.height - EDGE)
  }
}

export type KeyMove =
  | { readonly do: 'step'; readonly to: number }
  | { readonly do: 'escape' }
  | { readonly do: 'tab' }
  | { readonly do: 'swallow' }

const SWALLOWED: ReadonlySet<string> = new Set(['PageUp', 'PageDown'])

export function keyMove(key: string, at: number, count: number): KeyMove | null {
  if (key === 'Escape') return { do: 'escape' }
  if (key === 'Tab') return { do: 'tab' }
  if (SWALLOWED.has(key)) return { do: 'swallow' }
  const to = menuStep(key, at, count)
  return to === null ? null : { do: 'step', to }
}
