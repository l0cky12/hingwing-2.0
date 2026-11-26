import { menuStep } from '../chat/menu'

/** What opened a row's menu: a right-click at a point, the row's ⋯, or a menu key on the row. */
export type Opener =
  | { readonly by: 'pointer'; readonly x: number; readonly y: number }
  | { readonly by: 'more' }
  | { readonly by: 'keys' }

export const isMenuKey = (event: { readonly key: string; readonly shiftKey: boolean }): boolean =>
  event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)

export interface Box { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export interface Size { readonly width: number; readonly height: number }

export type Anchor =
  | { readonly at: 'point'; readonly x: number; readonly y: number }
  | { readonly at: 'under'; readonly right: number; readonly top: number; readonly bottom: number }

export const GAP = 2
export const EDGE = 8

/** At the pointer for a right-click. Otherwise under `under`, right-aligned to `right`. */
export function anchorAt(opener: Opener, under: Box, right: number): Anchor {
  return opener.by === 'pointer' ? { at: 'point', x: opener.x, y: opener.y } : { at: 'under', right, top: under.top, bottom: under.bottom }
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high))
const fits = (start: number, length: number, room: number) => start + length <= room - EDGE

export function placeMenu(anchor: Anchor, menu: Size, window: Size): { readonly left: number; readonly top: number } {
  const [left, top] = anchor.at === 'point'
    ? [fits(anchor.x, menu.width, window.width) ? anchor.x : anchor.x - menu.width, fits(anchor.y, menu.height, window.height) ? anchor.y : anchor.y - menu.height]
    : [anchor.right - menu.width, fits(anchor.bottom + GAP, menu.height, window.height) ? anchor.bottom + GAP : anchor.top - GAP - menu.height]
  return {
    left: clamp(left, EDGE, window.width - menu.width - EDGE),
    top: clamp(top, EDGE, window.height - menu.height - EDGE)
  }
}

/**
 * Beside the menu, right of it or left of it when the window has no room, with its first choice level with `item`.
 * `inset` is how far a menu's first item sits below its top edge.
 */
export function placeSubmenu(item: Box, menu: Box, sub: Size, window: Size, inset: number): { readonly left: number; readonly top: number } {
  const left = fits(menu.right + GAP, sub.width, window.width) ? menu.right + GAP : menu.left - GAP - sub.width
  return {
    left: clamp(left, EDGE, window.width - sub.width - EDGE),
    top: clamp(item.top - inset, EDGE, window.height - sub.height - EDGE)
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
