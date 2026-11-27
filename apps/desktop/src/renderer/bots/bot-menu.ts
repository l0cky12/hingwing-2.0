import type { Bot, BotId, BotMark, GroupId, Link } from '@highwing/hermes/domain'
import { anchorAt, type Anchor, type Box, type Opener } from '../chrome/popup-menu'
import { NEW_GROUP_BLOCKS } from './plus-menu'
import type { BotPlace } from './sidebar-view'

export type MenuAction = 'open' | 'new' | 'edit' | BotMark | 'delete'
export type GroupAction = Extract<MenuAction, 'open' | 'edit' | 'delete'>

export const MENUS: { readonly [P in BotPlace]: readonly (readonly MenuAction[])[] } = {
  section: [['open', 'new'], ['edit'], ['pin', 'hide'], ['delete']],
  pinned: [['open', 'new'], ['edit'], ['unpin', 'hide'], ['delete']],
  card: [['open', 'new'], ['edit'], ['hide']],
  hidden: [['open', 'new'], ['edit'], ['show'], ['delete']]
}

const LABELS: { readonly [A in MenuAction]: string } = {
  open: 'Open chat',
  new: 'New chat',
  edit: 'Edit…',
  pin: 'Pin to top',
  unpin: 'Unpin',
  hide: 'Hide from list',
  show: 'Show in list',
  delete: 'Delete…'
}

/** `asks`: the item calls Hermes, so it can't be used while the link is down. */
const GROUP_MENU: readonly (readonly { readonly action: GroupAction; readonly label: string; readonly asks: boolean }[])[] = [
  [{ action: 'open', label: 'Open', asks: false }, { action: 'edit', label: 'Edit…', asks: true }],
  [{ action: 'delete', label: 'Delete…', asks: true }]
]

/** A row of a row's menu. `block`: why it can't be used now, said to a screen reader and shown as its title. The row stays focusable. */
export interface MenuItem<A extends MenuAction = MenuAction> {
  readonly action: A
  readonly label: string
  readonly block: string | null
}

export const botMenuOf = (place: BotPlace): readonly (readonly MenuItem[])[] =>
  MENUS[place].map(group => group.map(action => ({ action, label: LABELS[action], block: null })))

export const groupMenuOf = (link: Link | undefined): readonly (readonly MenuItem<GroupAction>[])[] => {
  const block = link?.state === 'online' ? null : NEW_GROUP_BLOCKS.offline
  return GROUP_MENU.map(group => group.map(({ action, label, asks }) => ({ action, label, block: asks ? block : null })))
}

/**
 * Hermes deletes a profile only from its own machine (`hermes profile delete`, hermes_cli/profiles.py), and never its
 * default one. The gateway has no call for it, so Delete… says how instead of deleting.
 */
export const deleteRefusal = (bot: Bot, featured: boolean): string =>
  featured
    ? "The default bot can't be deleted."
    : `This Hermes can't delete bots from Highwing. To delete ${bot.name}, run hermes profile delete ${bot.id} on the Hermes machine.`

export const DELETE_WORDS: { readonly [K in MenuOwner['kind']]: string } = {
  bot: "Hermes removes the bot, its chats and its settings. It can't bring them back.",
  group: "Hermes ends this group chat and deletes its messages. It can't bring them back."
}

export type MenuOwner = { readonly kind: 'bot'; readonly bot: BotId } | { readonly kind: 'group'; readonly group: GroupId }

export const sameOwner = (a: MenuOwner, b: MenuOwner): boolean =>
  a.kind === 'bot' ? b.kind === 'bot' && a.bot === b.bot : b.kind === 'group' && a.group === b.group

export interface OpenMenu {
  readonly owner: MenuOwner
  readonly opener: Opener
  readonly above: string
  readonly scrolled: number
}

/** Under the row's ⋯, or under the whole card for the default bot, from ⋯ or the keyboard. Beside a row with no ⋯ drawn (`more` null). */
export const anchorOf = (opener: Opener, place: BotPlace, { row, more }: { readonly row: Box; readonly more: Box | null }): Anchor =>
  more === null
    ? (opener.by === 'pointer' ? anchorAt(opener, row, row.right) : { at: 'point', x: row.right, y: row.top })
    : anchorAt(opener, place === 'card' ? row : more, more.right)
