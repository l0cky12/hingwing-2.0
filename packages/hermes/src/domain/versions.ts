/**
 * The versions of a message: the chats that hold the same conversation up to it and a different try from it on.
 */
import type { SessionId } from './session'

/** Where a version's message sits in its chat: the stored row of its request, or 'end' when the chat stops before that message. */
export type Landing = number | 'end'
export interface Version { readonly sessionId: SessionId; readonly landing: Landing }
/** One message tried more than once. `versions` in order of creation, the chat they branched from first. `current` indexes the asked chat. */
export interface Versions { readonly versions: readonly Version[]; readonly current: number }
/** Every message of one chat that has versions. Empty: none, or none Highwing can place. */
export type ChatVersions = readonly Versions[]

export interface TreeRow { readonly id: SessionId; readonly parent: SessionId | null; readonly startedAt: number }

export interface Said { readonly user: boolean; readonly rowId: number | null; readonly key: string }

export interface Family {
  readonly above: { readonly parent: SessionId; readonly children: readonly SessionId[] } | null
  readonly below: readonly SessionId[]
}

type Anchor = Landing | null

export interface BranchPoint { readonly turn: number; readonly parent: Anchor; readonly child: Anchor }

export const label = ({ versions, current }: Versions): string => `${current + 1} / ${versions.length}`

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

export function branchPoint(parent: readonly Said[], child: readonly Said[]): BranchPoint | null {
  const [ours, theirs] = [turnsOf(parent), turnsOf(child)]
  for (let turn = 0; turn < Math.max(ours.length, theirs.length); turn++) {
    const [left, right] = [ours[turn], theirs[turn]]
    const same = left !== undefined && right !== undefined && left.keys.length === right.keys.length && left.keys.every((key, at) => key === right.keys[at])
    if (!same) return { turn, parent: anchorOf(left), child: anchorOf(right) }
  }
  return null
}

function grouped(asked: SessionId, members: readonly { readonly sessionId: SessionId; readonly landing: Anchor }[]): Versions | null {
  const placed = members.filter((member): member is Version => member.landing !== null)
  const current = placed.findIndex(member => member.sessionId === asked)
  return current < 0 || placed.length < 2 ? null : { versions: placed, current }
}

export function versionsOf(asked: SessionId, family: Family, points: ReadonlyMap<SessionId, BranchPoint | null>): ChatVersions {
  const at = (child: SessionId) => points.get(child) ?? null
  const own = at(asked)
  const asChild = family.above === null || own === null ? null : grouped(asked, [
    { sessionId: family.above.parent, landing: own.parent },
    ...family.above.children.flatMap(child => (at(child)?.turn === own.turn ? [{ sessionId: child, landing: at(child)?.child ?? null }] : []))
  ])
  const turns = [...new Set(family.below.flatMap(child => at(child)?.turn ?? []))].sort((a, b) => a - b)
  const asParent = turns.flatMap(turn => {
    const children = family.below.filter(child => at(child)?.turn === turn)
    const group = grouped(asked, [
      { sessionId: asked, landing: at(children[0] as SessionId)?.parent ?? null },
      ...children.map(child => ({ sessionId: child, landing: at(child)?.child ?? null }))
    ])
    return group === null || group.versions[0]?.landing === asChild?.versions[asChild.current]?.landing ? [] : [group]
  })
  return [...(asChild === null ? [] : [asChild]), ...asParent]
}
