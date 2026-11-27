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

/** A member whose turn Hermes holds now (`driver_status.member_activity`). */
export interface Answering {
  readonly member: MemberId
  /** `waiting`: queued behind another member. `working`: in a tool, named by `tool`. `stopping`: a Stop reached it. */
  readonly doing: 'waiting' | 'thinking' | 'working' | 'stopping'
  readonly tool: string | null
}

export interface GroupRow {
  readonly id: GroupId
  readonly name: string
  /** In the order they answer. */
  readonly members: readonly GroupMember[]
  /** In the order Hermes admitted them. Empty: nobody is answering, or Highwing has not asked about this group on this connection. */
  readonly answering: readonly Answering[]
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

/**
 * One line of a group's log that the thread draws. `seq` is Hermes's order and `at` its clock in ms. `about` is the
 * id of the message a member's turn answered, so a late line lands under the message it belongs to.
 */
export type GroupEvent =
  /** A message to the group. `id` is Hermes's event id. */
  | { readonly kind: 'said'; readonly seq: number; readonly at: number; readonly id: string; readonly text: string }
  /** A member's whole reply. Hermes posts it once, finished. */
  | { readonly kind: 'reply'; readonly seq: number; readonly at: number; readonly member: MemberId; readonly about: string; readonly text: string }
  /**
   * A member's turn that ended with no reply. `failed`: `detail` is Hermes's words. `superseded`: a newer message came
   * first, so Hermes posted nothing (`superseded_by_newer_user_event`). `stopped`: a Stop ended it. A member that chose
   * to say nothing is not an event.
   */
  | { readonly kind: 'silent'; readonly seq: number; readonly at: number; readonly member: MemberId; readonly about: string; readonly why: 'failed' | 'superseded' | 'stopped'; readonly detail: string | null }

/**
 * The group chat the pane shows. The `groupChat` topic, which is null while the pane shows anything else. `group`
 * names it, so a window never draws one group's thread under another's name.
 */
export type GroupChat =
  /** Hermes has not answered for this group on this connection yet. */
  | { readonly group: GroupId; readonly at: 'loading' }
  /** Hermes has no group by this id. */
  | { readonly group: GroupId; readonly at: 'missing' }
  | {
      readonly group: GroupId
      readonly at: 'read'
      readonly name: string
      readonly members: readonly GroupMember[]
      /** Oldest first. */
      readonly events: readonly GroupEvent[]
      /** Hermes holds lines older than the first of `events`: Highwing reads the newest `LOG_WINDOW` when it first shows a group. */
      readonly earlier: boolean
      readonly answering: readonly Answering[]
      /** The user's messages Hermes has not logged yet, oldest first. */
      readonly sending: readonly { readonly key: string; readonly text: string }[]
    }

export type GroupSupport =
  | { readonly is: 'unknown' }
  | { readonly is: 'unsupported' }
  | { readonly is: 'refused' }
  | { readonly is: 'able'; readonly driver: boolean; readonly seatable: readonly BotId[] | null }

export interface GroupFacts {
  readonly id: GroupId
  readonly name: string
  readonly members: readonly GroupMember[]
  readonly latestSeq: number | null
  /** Hermes's `authority_epoch`. The log only grows within one epoch. */
  readonly epoch: number | null
}

/**
 * A message on its way. `key` is the `event_id` sent and `eventId` the id Hermes files it under (`user:<sha256 of key>`,
 * gateway/hosted_rooms.py:235).
 */
export interface Outgoing {
  readonly key: string
  readonly eventId: string
  readonly text: string
}

export interface GroupLog {
  readonly epoch: number | null
  readonly from: number
  readonly cursor: number
  readonly events: readonly GroupEvent[]
}

export interface HeldGroup {
  readonly facts: GroupFacts
  readonly answering: readonly Answering[]
  readonly pushes: boolean
  readonly log: GroupLog | null
  readonly sending: readonly Outgoing[]
}

export interface GroupDesk {
  readonly offline: boolean
  readonly support: GroupSupport
  /** Hermes's order, most recently changed first. */
  readonly listed: readonly GroupId[] | null
  readonly held: { readonly [group: string]: HeldGroup }
  readonly followed: GroupId | null
  readonly missing: GroupId | null
}

export const EMPTY_GROUPS: GroupDesk = { offline: false, support: { is: 'unknown' }, listed: null, held: {}, followed: null, missing: null }

export type GroupNews =
  | { readonly on: 'link'; readonly offline: boolean }
  | { readonly on: 'support'; readonly support: Exclude<GroupSupport, { readonly is: 'unknown' }> }
  | { readonly on: 'listed'; readonly groups: readonly GroupFacts[] }
  /** Hermes made or renamed this group, which makes it the most recently changed. */
  | { readonly on: 'made'; readonly facts: GroupFacts }
  | { readonly on: 'followed'; readonly group: GroupId | null }
  | { readonly on: 'state'; readonly facts: GroupFacts; readonly answering: readonly Answering[]; readonly pushes: boolean }
  | { readonly on: 'page'; readonly group: GroupId; readonly after: number; readonly epoch: number | null; readonly events: readonly GroupEvent[]; readonly cursor: number }
  /** Hermes has no group by this id. A followed group shows as missing. */
  | { readonly on: 'missing'; readonly group: GroupId }
  /** The user deleted this group. Unlike `missing`, nothing is shown in its place. */
  | { readonly on: 'disbanded'; readonly group: GroupId }
  | { readonly on: 'sending'; readonly group: GroupId; readonly message: Outgoing }
  | { readonly on: 'unsent'; readonly group: GroupId; readonly key: string }

const refusalKeepsList = (desk: GroupDesk, support: GroupSupport) => support.is === 'refused' && desk.listed !== null

/** A room id is any identifier Hermes takes, `constructor` included, so a lookup must not reach `Object.prototype`. */
export const heldIn = (held: GroupDesk['held'], group: string): HeldGroup | undefined => (Object.hasOwn(held, group) ? held[group] : undefined)

const unread = (facts: GroupFacts): HeldGroup => ({ facts, answering: [], pushes: false, log: null, sending: [] })

const withFacts = (desk: GroupDesk, facts: GroupFacts): HeldGroup => {
  const held = heldIn(desk.held, facts.id)
  return held === undefined ? unread(facts) : { ...held, facts }
}

const otherEpoch = (a: number | null, b: number | null) => a !== null && b !== null && a !== b

const stale = (log: GroupLog | null, { latestSeq, epoch }: GroupFacts) =>
  log !== null && (otherEpoch(epoch, log.epoch) || (latestSeq !== null && latestSeq < log.cursor))

const changing = (desk: GroupDesk, group: GroupId, change: (held: HeldGroup) => HeldGroup): GroupDesk => {
  const held = heldIn(desk.held, group)
  return held === undefined ? desk : { ...desk, held: { ...desk.held, [group]: change(held) } }
}

const without = (desk: GroupDesk, group: GroupId): GroupDesk => ({
  ...desk, held: Object.fromEntries(Object.entries(desk.held).filter(([id]) => id !== group)), listed: desk.listed?.filter(id => id !== group) ?? null
})

const logs = (held: HeldGroup, eventId: string) => held.log?.events.some(event => event.kind === 'said' && event.id === eventId) ?? false

function paged(held: HeldGroup, news: Extract<GroupNews, { readonly on: 'page' }>): HeldGroup {
  const { log } = held
  const read = log === null ? { epoch: news.epoch, from: news.after, cursor: news.after, events: [] } : log
  if (read.cursor !== news.after || otherEpoch(news.epoch, read.epoch)) return held
  const logged = new Set(news.events.flatMap(event => (event.kind === 'said' ? [event.id] : [])))
  const sending = held.sending.filter(message => !logged.has(message.eventId))
  if (log !== null && news.cursor === log.cursor && sending.length === held.sending.length) return held
  return { ...held, sending, log: { ...read, cursor: news.cursor, events: news.events.length === 0 ? read.events : [...read.events, ...news.events] } }
}

export function nextGroups(desk: GroupDesk, news: GroupNews): GroupDesk {
  switch (news.on) {
    case 'link':
      return { ...desk, offline: news.offline }
    case 'support':
      return refusalKeepsList(desk, news.support) ? desk : { ...desk, support: news.support }
    case 'listed': {
      const held = Object.fromEntries(news.groups.map(facts => [facts.id, withFacts(desk, facts)]))
      const followed = desk.followed === null ? undefined : heldIn(desk.held, desk.followed)
      return { ...desk, listed: news.groups.map(facts => facts.id), held: followed === undefined ? held : { [followed.facts.id]: followed, ...held } }
    }
    case 'made':
      return { ...desk, listed: [news.facts.id, ...(desk.listed ?? []).filter(id => id !== news.facts.id)], held: { ...desk.held, [news.facts.id]: withFacts(desk, news.facts) } }
    case 'followed':
      return desk.followed === news.group ? desk : { ...desk, followed: news.group, missing: null }
    case 'state': {
      const { facts, answering, pushes } = news
      const held = withFacts(desk, facts)
      return { ...desk, missing: desk.missing === facts.id ? null : desk.missing, held: { ...desk.held, [facts.id]: { ...held, answering, pushes, log: stale(held.log, facts) ? null : held.log } } }
    }
    case 'page':
      return changing(desk, news.group, held => paged(held, news))
    case 'missing':
      return { ...without(desk, news.group), missing: desk.followed === news.group ? news.group : desk.missing }
    case 'disbanded':
      return without(desk, news.group)
    case 'sending':
      return changing(desk, news.group, held => (held.sending.some(message => message.key === news.message.key) || logs(held, news.message.eventId) ? held : { ...held, sending: [...held.sending, news.message] }))
    case 'unsent':
      return changing(desk, news.group, held => ({ ...held, sending: held.sending.filter(message => message.key !== news.key) }))
  }
}

const LOADING: Groups = { state: 'loading' }
const OFFLINE: Groups = { state: 'offline' }

export function groupsOf({ offline, support, listed, held }: GroupDesk): Groups {
  if (support.is === 'unsupported' || support.is === 'refused') return { state: support.is }
  if (support.is === 'unknown' || listed === null) return offline ? OFFLINE : LOADING
  const rows = listed.flatMap(id => {
    const group = heldIn(held, id)
    return group === undefined ? [] : [{ id, name: group.facts.name, members: group.facts.members, answering: group.answering }]
  })
  return { state: 'listed', driver: support.driver, seatable: support.seatable, rows }
}

export function groupChatOf({ followed, missing, held }: GroupDesk): GroupChat | null {
  if (followed === null) return null
  if (missing === followed) return { group: followed, at: 'missing' }
  const group = heldIn(held, followed)
  if (group?.log == null) return { group: followed, at: 'loading' }
  const { facts, log, answering, sending } = group
  return {
    group: followed, at: 'read', name: facts.name, members: facts.members, events: log.events, earlier: log.from > 0, answering,
    sending: sending.map(({ key, text }) => ({ key, text }))
  }
}

const LOG_WINDOW = 400

export function logStart({ facts, log }: HeldGroup): number | null {
  if (log === null) return Math.max(0, (facts.latestSeq ?? 0) - LOG_WINDOW)
  return facts.latestSeq !== null && facts.latestSeq <= log.cursor ? null : log.cursor
}

const BACKSTOP_MS = 15_000
const POLL_MS = 2_000

export function nextPoll(desk: GroupDesk): { readonly ms: number; readonly groups: readonly GroupId[] } | null {
  if (desk.offline || desk.support.is !== 'able') return null
  const kept = Object.values(desk.held).filter(group => group.facts.id === desk.followed || group.answering.length > 0)
  if (kept.length === 0) return null
  return { ms: kept.every(group => group.pushes) ? BACKSTOP_MS : POLL_MS, groups: kept.map(group => group.facts.id) }
}
