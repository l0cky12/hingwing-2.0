import type { BotId, BotMark, Bots } from '@highwing/hermes/domain'
import { fallbackOf, type FocusTarget } from './focus'
import { rowsIn, type SidebarView } from './sidebar-view'

export interface MarkRun {
  readonly id: number
  readonly bot: BotId
  readonly name: string
  readonly mark: BotMark
  readonly rows: readonly BotId[]
  readonly since: number
  readonly edition: number | null
}

export const SAID: { readonly [M in BotMark]: (name: string) => string } = {
  pin: name => `Pinned ${name}.`,
  unpin: name => `Unpinned ${name}.`,
  hide: name => `Hid ${name}. It's under Hidden.`,
  show: name => `${name} is back in the list.`
}

export const busyIn = (runs: readonly MarkRun[]): ReadonlySet<BotId> => new Set(runs.map(run => run.bot))

export function runsAt(runs: readonly MarkRun[], bots: Bots | undefined): { readonly landed: readonly MarkRun[]; readonly waiting: readonly MarkRun[] } {
  if (bots?.state !== 'listed') return { landed: [], waiting: [] }
  const live = runs.filter(run => bots.edition >= run.since)
  return {
    landed: live.filter(run => run.edition !== null && bots.edition >= run.edition),
    waiting: live.filter(run => run.edition === null || bots.edition < run.edition)
  }
}

export function focusAfter(run: MarkRun, view: SidebarView): readonly FocusTarget[] {
  if (run.mark !== 'hide') return fallbackOf({ to: 'row', bot: run.bot }, view)
  const shown = new Set(rowsIn(view).filter(row => row.place !== 'hidden').map(row => row.bot.id))
  const at = run.rows.indexOf(run.bot)
  const next = run.rows.slice(at + 1).find(bot => shown.has(bot)) ?? run.rows.slice(0, Math.max(at, 0)).reverse().find(bot => shown.has(bot))
  return next === undefined ? [{ to: 'hidden' }, { to: 'search' }] : [{ to: 'row', bot: next }]
}
