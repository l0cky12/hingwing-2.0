/** What Settings shows for Usage. One outcome, whichever Hermes method answered. */
export type AccountReport =
  | { readonly state: 'reported'; readonly lines: readonly string[] }
  | { readonly state: 'unreported' }

const filled = (line: string | null | undefined): string[] => {
  const text = line?.trim() ?? ''
  return text === '' ? [] : [text]
}

/** `lines`, then `nous_lines`. Blank lines are dropped. An empty list is still a report. */
export function parseAccountReport(reply: { readonly lines: readonly string[]; readonly nous_lines?: readonly string[] | null }): AccountReport {
  return { state: 'reported', lines: [...reply.lines, ...(reply.nous_lines ?? [])].flatMap(filled) }
}

interface UsageBarText { readonly remaining_display: string; readonly total_display: string }

/** null when `available` is false, so the caller tries the next read. An empty list is still a report. */
export function linesFromBars(model: {
  readonly available: boolean
  readonly plan_name?: string | null
  readonly status?: string | null
  readonly subscription_remaining_display?: string | null
  readonly topup_remaining_display?: string | null
  readonly total_spendable_display?: string | null
  readonly plan_bar?: UsageBarText | null
  readonly topup_bar?: UsageBarText | null
}): readonly string[] | null {
  if (!model.available) return null
  const bar = (held: UsageBarText | null | undefined) => held == null ? null : `${held.remaining_display} of ${held.total_display}`
  return [
    model.plan_name, model.status, model.subscription_remaining_display, model.topup_remaining_display, model.total_spendable_display,
    bar(model.plan_bar), bar(model.topup_bar)
  ].flatMap(filled)
}

export function linesFromInsights(result: { readonly days: number; readonly sessions: number; readonly messages: number }): readonly string[] {
  return [`${result.sessions} sessions`, `${result.messages} messages`, `Last ${result.days} days`]
}
