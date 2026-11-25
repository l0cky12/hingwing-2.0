/**
 * Group chats: Hermes's hosted rooms, where 2 to 6 bots answer one conversation. Plain JSON data and pure functions,
 * like `session.ts`, because `Groups` crosses Electron IPC.
 */
import type { Bot, BotId } from './bots'

declare const brand: unique symbol

/** Hermes's id for a group chat, its `room_id`. Highwing mints the id of a group it makes. */
export type GroupId = string & { readonly [brand]: 'GroupId' }
/** One seat of a group, Hermes's `member_id`. */
export type MemberId = string & { readonly [brand]: 'MemberId' }

/** Hermes seats 2 to 6 bots and never changes them (gateway/hosted_room_discussion.py:30-31, `validate_roster`). */
export const GROUP_SIZE = { min: 2, max: 6 } as const
/** `MAX_ROOM_NAME_CHARS` (gateway/hosted_rooms.py:37). */
export const GROUP_NAME_MAX = 200

/** `IDENTIFIER_RE` and its 128-character cap (gateway/hosted_rooms_common.py:19 and :23), which Hermes holds a room id and a handle to. */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export const isGroupId = (raw: unknown): raw is GroupId => typeof raw === 'string' && IDENTIFIER.test(raw)

/**
 * The id of the group a dialog is about to make. `dialog` is minted once when the dialog opens, and `tries` counts
 * the creates Hermes refused. So a create whose answer was lost goes out again under the same id, which Hermes
 * answers with the group the first one made, and an id Hermes refused is never sent again.
 */
export const groupIdFor = (seed: string, refusals: number): GroupId => (refusals === 0 ? seed : `${seed}-${refusals}`) as GroupId

/** One bot's seat in a group. Frozen when the group is made. */
export interface GroupMember {
  readonly id: MemberId
  /** The profile seated here. A bot the roster no longer lists keeps its seat. */
  readonly bot: BotId
  /** What a message types after `@` to ask this member. Never `all` or `everyone`, which Hermes keeps for the whole group. */
  readonly handle: string
  /** The seat's own name: Hermes's `display_name`, else its handle. Never blank. */
  readonly name: string
}

/** What the New group chat dialog sends. `bots` is the order they answer in: the roster's, not the order ticked. */
export interface GroupDraft {
  readonly group: GroupId
  readonly name: string
  readonly bots: readonly BotId[]
}

const RESERVED_HANDLES = ['all', 'everyone']

const slug = (name: string) =>
  name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64).replace(/^-+|-+$/g, '')

/**
 * One seat per bot, in the order given. The seat's id is the profile, as Hermes Desktop seats a local bot
 * (hermes-bots/canonical-groups.ts:228). The handle is the shown name in lower case, accents dropped, with every run
 * of other characters as one `-`, so `@ada` reaches the bot the sidebar calls Ada whatever its profile is named.
 * A handle that is empty, taken or reserved falls back to the profile, then to the profile with a number.
 */
export function seatsFor(picked: readonly Pick<Bot, 'id' | 'name'>[]): readonly GroupMember[] {
  const taken = new Set(RESERVED_HANDLES)
  return picked.map(({ id, name }) => {
    const profile = slug(id) || 'bot'
    let handle = [slug(name), profile].find(candidate => candidate !== '' && !taken.has(candidate))
    for (let n = 2; handle === undefined; n++) if (!taken.has(`${profile}-${n}`)) handle = `${profile}-${n}`
    taken.add(handle)
    return { id: id as string as MemberId, bot: id, handle, name }
  })
}

export interface GroupRow {
  readonly id: GroupId
  readonly name: string
  /** In the order they answer. */
  readonly members: readonly GroupMember[]
}

export type Groups =
  /** Asked, or about to ask. */
  | { readonly state: 'loading' }
  /** No answer yet and no connection to ask over. */
  | { readonly state: 'offline' }
  /** `groups.capabilities` answered -32601: this Hermes has no group chats. Asked again on the next socket only. */
  | { readonly state: 'unsupported' }
  /** Hermes has the calls and would not answer them for this connection. */
  | { readonly state: 'refused' }
  | {
      readonly state: 'listed'
      /** false: Hermes is not running its group chats right now. It still makes one, and refuses a message to one. */
      readonly driver: boolean
      /** The bots Hermes would seat in a new group for this connection. null: this Hermes does not say, so every listed bot is offered. */
      readonly seatable: readonly BotId[] | null
      /** Most recently changed first. The newest list stays while the connection is down. */
      readonly rows: readonly GroupRow[]
    }

export type GroupSupport =
  | { readonly is: 'unknown' }
  | { readonly is: 'unsupported' }
  | { readonly is: 'refused' }
  | { readonly is: 'able'; readonly driver: boolean; readonly seatable: readonly BotId[] | null }

export interface GroupDesk {
  readonly offline: boolean
  readonly support: GroupSupport
  readonly listed: readonly GroupId[] | null
  readonly held: { readonly [group: string]: GroupRow }
}

export const EMPTY_GROUPS: GroupDesk = { offline: false, support: { is: 'unknown' }, listed: null, held: {} }

export type GroupNews =
  | { readonly on: 'link'; readonly offline: boolean }
  | { readonly on: 'support'; readonly support: Exclude<GroupSupport, { readonly is: 'unknown' }> }
  | { readonly on: 'listed'; readonly groups: readonly GroupRow[] }
  | { readonly on: 'made'; readonly group: GroupRow }

const refusalKeepsList = (desk: GroupDesk, support: GroupSupport) => support.is === 'refused' && desk.listed !== null

export function nextGroups(desk: GroupDesk, news: GroupNews): GroupDesk {
  switch (news.on) {
    case 'link':
      return { ...desk, offline: news.offline }
    case 'support':
      return refusalKeepsList(desk, news.support) ? desk : { ...desk, support: news.support }
    case 'listed':
      return { ...desk, listed: news.groups.map(group => group.id), held: Object.fromEntries(news.groups.map(group => [group.id, group])) }
    case 'made':
      return { ...desk, listed: [news.group.id, ...(desk.listed ?? []).filter(id => id !== news.group.id)], held: { ...desk.held, [news.group.id]: news.group } }
  }
}

const LOADING: Groups = { state: 'loading' }
const OFFLINE: Groups = { state: 'offline' }

export function groupsOf({ offline, support, listed, held }: GroupDesk): Groups {
  if (support.is === 'unsupported' || support.is === 'refused') return { state: support.is }
  if (support.is === 'unknown' || listed === null) return offline ? OFFLINE : LOADING
  return { state: 'listed', driver: support.driver, seatable: support.seatable, rows: listed.flatMap(id => held[id] ?? []) }
}
