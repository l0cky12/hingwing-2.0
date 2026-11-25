/**
 * The versions of a message: the chats that hold the same conversation up to it and a different try from it on.
 * Plain JSON data and pure functions, because `ChatVersions` crosses Electron IPC. Read from Hermes on each ask, never stored.
 */
import type { SessionId } from './session'

/** Where a version's message sits in its chat: the stored row of its request, or 'end' when the chat stops before that message. */
export type Landing = number | 'end'
export interface Version { readonly sessionId: SessionId; readonly landing: Landing }
/** One message tried more than once. `versions` in order of creation, the chat they branched from first. `current` indexes the asked chat. */
export interface Versions { readonly versions: readonly Version[]; readonly current: number }
/** Every message of one chat that has versions. Empty: none, or Hermes could not say. */
export type ChatVersions = readonly Versions[]

/** One chat as Hermes lists it. `parent` is the chat it was branched from, and null for any other chat, a compression's continuation included. */
export interface TreeRow { readonly id: SessionId; readonly parent: SessionId | null; readonly startedAt: number }

/** One stored row of a chat. `key` is what the row says, so two rows with one key are the same message whatever their ids and times. */
export interface Said { readonly user: boolean; readonly rowId: number | null; readonly key: string }

export interface Family {
  /** The chat the asked one was branched from, with every chat branched from it, oldest first. null: it was branched from none. */
  readonly above: { readonly parent: SessionId; readonly children: readonly SessionId[] } | null
  /** The chats branched from the asked one, oldest first. */
  readonly below: readonly SessionId[]
}

/** null: the chat has a turn there, and Hermes names no row for its request, so the version cannot be placed. */
type Anchor = Landing | null

/** The first turn two chats do not share, counted from 0, and where it sits in each. In a table of points `a` is the parent and `b` the chat branched from it. */
export interface BranchPoint { readonly turn: number; readonly a: Anchor; readonly b: Anchor }

export const label = ({ versions, current }: Versions): string => `${current + 1} / ${versions.length}`

/** A chat groups with the chat it was branched from, and with the chats branched from itself. A branch of a branch is no version of the first chat. */
export function familiesOf(rows: readonly TreeRow[], sessionId: SessionId): Family {
  const childrenOf = (parent: SessionId) => rows
    .filter(row => row.parent === parent)
    .sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(row => row.id)
  const parent = rows.find(row => row.id === sessionId)?.parent ?? null
  return { above: parent === null ? null : { parent, children: childrenOf(parent) }, below: childrenOf(sessionId) }
}

interface Turn { readonly request: Said | null; readonly keys: readonly string[] }

function turnsOf(rows: readonly Said[]): readonly Turn[] {
  const turns: { request: Said | null; keys: string[] }[] = []
  for (const row of rows) {
    if (row.user || turns.length === 0) turns.push({ request: row.user ? row : null, keys: [] })
    turns.at(-1)?.keys.push(row.key)
  }
  return turns
}

const anchorOf = (turn: Turn | undefined): Anchor => (turn === undefined ? 'end' : turn.request?.rowId ?? null)

/** null: the two chats say the same, row for row. */
export function branchPoint(a: readonly Said[], b: readonly Said[]): BranchPoint | null {
  const [ours, theirs] = [turnsOf(a), turnsOf(b)]
  for (let turn = 0; turn < Math.max(ours.length, theirs.length); turn++) {
    const [left, right] = [ours[turn], theirs[turn]]
    const same = left !== undefined && right !== undefined && left.keys.length === right.keys.length && left.keys.every((key, at) => key === right.keys[at])
    if (!same) return { turn, a: anchorOf(left), b: anchorOf(right) }
  }
  return null
}

function grouped(asked: SessionId, members: readonly { readonly sessionId: SessionId; readonly landing: Anchor }[]): Versions | null {
  const placed = members.filter((member): member is Version => member.landing !== null)
  const current = placed.findIndex(member => member.sessionId === asked)
  return current < 0 || placed.length < 2 ? null : { versions: placed, current }
}

/**
 * `points` holds, for each chat of the family that was branched from another, where it parts from that chat. A chat
 * that says the same as its parent so far is no version yet. A chat that cannot be placed is left out, and so is a
 * message the asked chat cannot be placed at.
 */
export function versionsOf(asked: SessionId, family: Family, points: ReadonlyMap<SessionId, BranchPoint | null>): ChatVersions {
  const at = (child: SessionId) => points.get(child) ?? null
  const own = at(asked)
  const asChild = family.above === null || own === null ? null : grouped(asked, [
    { sessionId: family.above.parent, landing: own.a },
    ...family.above.children.flatMap(child => (at(child)?.turn === own.turn ? [{ sessionId: child, landing: at(child)?.b ?? null }] : []))
  ])
  const turns = [...new Set(family.below.flatMap(child => at(child)?.turn ?? []))].sort((a, b) => a - b)
  const asParent = turns.flatMap(turn => {
    const children = family.below.filter(child => at(child)?.turn === turn)
    const group = grouped(asked, [
      { sessionId: asked, landing: at(children[0] as SessionId)?.a ?? null },
      ...children.map(child => ({ sessionId: child, landing: at(child)?.b ?? null }))
    ])
    return group === null || group.versions[0]?.landing === asChild?.versions[asChild.current]?.landing ? [] : [group]
  })
  return [...(asChild === null ? [] : [asChild]), ...asParent]
}
