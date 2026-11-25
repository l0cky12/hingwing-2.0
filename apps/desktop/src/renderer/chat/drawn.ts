import type { ThreadNode, ThreadView, TurnView } from '@highwing/thread'

const undrawn = (node: ThreadNode) => node.kind === 'steer' || (node.kind === 'closed' && node.words === null)

const drawnTurns = new WeakMap<TurnView, TurnView | null>()

function drawnTurn(turn: TurnView): TurnView | null {
  if (!turn.nodes.some(undrawn)) return turn
  const held = drawnTurns.get(turn)
  if (held !== undefined) return held
  const nodes = turn.nodes.filter(node => !undrawn(node))
  const drawn = nodes.length === 0 && turn.request === null && turn.end.kind === 'none' ? null : { ...turn, nodes }
  drawnTurns.set(turn, drawn)
  return drawn
}

export function drawnView(view: ThreadView): ThreadView {
  const turns = view.turns.flatMap(turn => drawnTurn(turn) ?? [])
  return turns.length === view.turns.length && turns.every((turn, index) => turn === view.turns[index]) ? view : { ...view, turns }
}
