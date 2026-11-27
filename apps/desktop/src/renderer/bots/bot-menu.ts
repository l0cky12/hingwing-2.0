import type { Bot, BotId, BotMark } from '@highwing/hermes/domain'
import { anchorAt, type Anchor, type Box, type Opener } from '../chrome/popup-menu'
import type { BotPlace } from './sidebar-view'

export type MenuAction = 'open' | 'new' | 'edit' | 'routines' | BotMark | 'delete'

export const MENUS: { readonly [P in BotPlace]: readonly (readonly MenuAction[])[] } = {
  section: [['open', 'new'], ['edit', 'routines'], ['pin', 'hide'], ['delete']],
  pinned: [['open', 'new'], ['edit', 'routines'], ['unpin', 'hide'], ['delete']],
  card: [['open', 'new'], ['edit', 'routines'], ['hide']],
  hidden: [['open', 'new'], ['edit', 'routines'], ['show'], ['delete']]
}

export const LABELS: { readonly [A in MenuAction]: string } = {
  open: 'Open chat',
  new: 'New chat',
  edit: 'Edit…',
  routines: 'Routines…',
  pin: 'Pin to top',
  unpin: 'Unpin',
  hide: 'Hide from list',
  show: 'Show in list',
  delete: 'Delete…'
}

/**
 * Hermes deletes a profile only from its own machine (`hermes profile delete`, hermes_cli/profiles.py), and never its
 * default one. The gateway has no call for it, so Delete… says how instead of deleting.
 */
export const deleteRefusal = (bot: Bot, featured: boolean): string =>
  featured
    ? "The default bot can't be deleted."
    : `This Hermes can't delete bots from Highwing. To delete ${bot.name}, run hermes profile delete ${bot.id} on the Hermes machine.`

export interface OpenMenu {
  readonly bot: BotId
  readonly opener: Opener
  readonly above: string
  readonly scrolled: number
}

/** Under the row's ⋯, or under the whole card for the default bot, from ⋯ or the keyboard. */
export const anchorOf = (opener: Opener, place: BotPlace, { row, more }: { readonly row: Box; readonly more: Box }): Anchor =>
  anchorAt(opener, place === 'card' ? row : more, more.right)
