import { botsIn, GROUP_SIZE, shownUnasked, type Bot, type Bots, type Groups, type Link, type OpenChat } from '@highwing/hermes/domain'
import { botNameOf } from '../chats/chat-list'
import { newChatKeys } from '../new-chat'
import { NEW_BOT_BLOCKS, newBotBlock, NOTES } from './roster-view'

export const NEW_GROUP_BLOCKS: { readonly [S in Exclude<Groups['state'], 'listed'>]: string } = {
  loading: 'Highwing is still asking this Hermes about group chats.',
  offline: "Highwing isn't connected to Hermes right now.",
  unsupported: 'This Hermes has no group chats. Update Hermes on that machine, then reconnect.',
  refused: "Hermes won't let this connection use group chats."
}
const ROSTER_BLOCKS: { readonly [S in Exclude<Bots['state'], 'listed'>]: string } = { ...NOTES, loading: NEW_BOT_BLOCKS.loading }
export const TOO_FEW = `A group chat needs at least ${GROUP_SIZE.min} bots.`

export function seatableIn(bots: Bots | undefined, groups: Groups | undefined): readonly Bot[] {
  if (bots?.state !== 'listed' || groups?.state !== 'listed') return []
  const { seatable } = groups
  return botsIn(bots.roster).filter(bot => shownUnasked(bot) && (seatable === null || seatable.includes(bot.id)))
}

/**
 * Why New group chat can't be used now, in plain words, or null when it can. Hermes makes a group while it is not
 * running group chats (`driver` false), so that does not block it.
 */
export function newGroupBlock(link: Link | undefined, bots: Bots | undefined, groups: Groups | undefined): string | null {
  if (link === undefined || groups === undefined) return NEW_GROUP_BLOCKS.loading
  if (link.state !== 'online') return NEW_GROUP_BLOCKS.offline
  if (groups.state !== 'listed') return NEW_GROUP_BLOCKS[groups.state]
  if (bots === undefined || bots.state !== 'listed') return ROSTER_BLOCKS[bots?.state ?? 'loading']
  return seatableIn(bots, groups).length < GROUP_SIZE.min ? TOO_FEW : null
}

/** A row of the plus menu. `block`: why it can't be used now, said to a screen reader and shown as its title. The row stays focusable. */
export interface PlusItem {
  readonly id: 'new-chat' | 'new-group' | 'new-bot'
  readonly label: string
  readonly keys: ReturnType<typeof newChatKeys> | null
  readonly block: string | null
  readonly dividerAbove: boolean
}

export interface PlusScene {
  readonly link: Link | undefined
  readonly bots: Bots | undefined
  readonly groups: Groups | undefined
  readonly open: OpenChat | undefined
  readonly mac: boolean
}

export function plusMenuOf({ link, bots, groups, open, mac }: PlusScene): readonly PlusItem[] {
  const bot = botNameOf(bots, open?.shown?.bot ?? null)
  return [
    { id: 'new-chat', label: bot === null ? 'New chat' : `New chat with ${bot}`, keys: newChatKeys(mac), block: null, dividerAbove: false },
    { id: 'new-group', label: 'New group chat…', keys: null, block: newGroupBlock(link, bots, groups), dividerAbove: false },
    { id: 'new-bot', label: 'New bot…', keys: null, block: newBotBlock(link, bots), dividerAbove: true }
  ]
}
