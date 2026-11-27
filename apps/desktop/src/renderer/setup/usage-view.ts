import type { AccountReport, CommandOutcome } from '@highwing/hermes/domain'

/** What the Usage panel draws. `reading` covers the ask that has not settled for this chat. */
export type UsageView =
  | { readonly state: 'needs-chat' }
  | { readonly state: 'reading' }
  | { readonly state: 'failed'; readonly message: string }
  | AccountReport

export type UsageAsk =
  | { readonly at: 'idle' }
  | { readonly at: 'reading'; readonly sessionId: string }
  | { readonly at: 'settled'; readonly sessionId: string; readonly outcome: CommandOutcome<AccountReport> }

export function usageView(sessionId: string | null, ask: UsageAsk): UsageView {
  if (sessionId === null) return { state: 'needs-chat' }
  if (ask.at !== 'settled' || ask.sessionId !== sessionId) return { state: 'reading' }
  if (!ask.outcome.ok) return { state: 'failed', message: ask.outcome.refusal.message }
  return ask.outcome.value
}

/** An offline refusal is stale once the chat is live. Any other settled read stands. */
export function usageNeedsRead(sessionId: string | null, live: boolean, ask: UsageAsk): boolean {
  if (sessionId === null) return false
  if (ask.at !== 'settled' || ask.sessionId !== sessionId) return true
  return !ask.outcome.ok && ask.outcome.refusal.kind === 'offline' && live
}
