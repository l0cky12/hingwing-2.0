import type { ThreadEnd, ThreadNode, ThreadView, TurnView } from '@highwing/thread'
import type { ShowWork } from '../../ipc-contract'

const RANK = { replies: 0, actions: 1, all: 2 } as const satisfies Record<ShowWork, number>

const SHOWN_FROM = {
  prose: 'replies', prompt: 'replies', notice: 'replies', closed: 'replies', status: 'replies', steer: 'replies',
  step: 'actions', group: 'actions', helper: 'actions', plan: 'actions', moa: 'actions',
  reasoning: 'all'
} as const satisfies Record<ThreadNode['kind'], ShowWork>

type Hiding = Exclude<ShowWork, 'all'>

const shows = ({ kind }: ThreadNode, pick: Hiding) => RANK[SHOWN_FROM[kind]] <= RANK[pick]

function endOffHidden(end: ThreadEnd, nodes: readonly ThreadNode[], pick: Hiding): ThreadEnd {
  if (end.kind !== 'at' || end.tone !== 'live') return end
  const node = nodes.find(({ key }) => key === end.nodeKey)
  if (node === undefined || shows(node, pick)) return end
  return { kind: 'tip', words: [{ t: 'text', v: node.kind === 'reasoning' ? 'Thinking' : 'Working' }], elapsed: end.elapsed }
}

const RUNNING: ReadonlySet<ThreadEnd['kind']> = new Set(['at', 'tip', 'paused'])

function finalReplyStart({ nodes, end }: TurnView): number {
  return RUNNING.has(end.kind) ? nodes.length : nodes.findLastIndex(node => !shows(node, 'replies')) + 1
}

function shownTurn(turn: TurnView, pick: Hiding): TurnView {
  const from = pick === 'replies' ? finalReplyStart(turn) : 0
  const nodes = turn.nodes.filter((node, at) => shows(node, pick) && (node.kind !== 'prose' || at >= from))
  return nodes.length === turn.nodes.length ? turn : { ...turn, nodes, end: endOffHidden(turn.end, turn.nodes, pick) }
}

const SHOWN_BY_TURN: { readonly [P in Hiding]: WeakMap<TurnView, TurnView> } = { replies: new WeakMap(), actions: new WeakMap() }

export function shownWork(view: ThreadView, pick: ShowWork): ThreadView {
  if (pick === 'all') return view
  const held = SHOWN_BY_TURN[pick]
  const turns = view.turns.map(turn => {
    const known = held.get(turn)
    if (known !== undefined) return known
    const shown = shownTurn(turn, pick)
    held.set(turn, shown)
    return shown
  })
  return turns.every((turn, at) => turn === view.turns[at]) ? view : { ...view, turns }
}
