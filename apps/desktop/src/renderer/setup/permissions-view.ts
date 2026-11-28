import { RULE_KINDS, ruleOf, type CommandOutcome, type CommandRules, type RuleEdit, type RuleKind } from '@highwing/hermes/domain'

export type RulesRead =
  | { readonly at: 'reading' }
  | { readonly at: 'read'; readonly rules: CommandRules }
  | { readonly at: 'refused'; readonly words: string; readonly unsupported: boolean }

export interface RulesState {
  readonly read: RulesRead
  /** A change is on its way to Hermes. */
  readonly saving: boolean
  /** The rule the user pressed Remove on, which waits for a yes. */
  readonly removing: { readonly kind: RuleKind; readonly rule: string } | null
  /** Why the last change did not happen, in Hermes's or Highwing's words. */
  readonly problem: string | null
  /** What the last change did, for a screen reader: the list changes without a word of its own. */
  readonly said: string | null
}

export type RulesEvent =
  | { readonly on: 'otherBot' }
  | { readonly on: 'read'; readonly outcome: CommandOutcome<CommandRules> }
  | { readonly on: 'ask'; readonly kind: RuleKind; readonly rule: string }
  | { readonly on: 'keep' }
  | { readonly on: 'saving' }
  /** The answer to `edit`: the rules as Hermes holds them now, or why it did not happen. */
  | { readonly on: 'saved'; readonly edit: RuleEdit; readonly outcome: CommandOutcome<CommandRules> }

export const FIRST_RULES: RulesState = { read: { at: 'reading' }, saving: false, removing: null, problem: null, said: null }

const saidOf = ({ change, kind, rule }: RuleEdit): string =>
  change === 'add' ? `Added “${rule}” to ${RULE_KINDS[kind].label}.` : `Removed “${rule}” from ${RULE_KINDS[kind].label}.`

export function nextRules(state: RulesState, event: RulesEvent): RulesState {
  switch (event.on) {
    case 'otherBot': return FIRST_RULES
    case 'read': {
      const { outcome } = event
      return { ...state, read: outcome.ok ? { at: 'read', rules: outcome.value } : { at: 'refused', words: outcome.refusal.message, unsupported: outcome.refusal.kind === 'unsupported' } }
    }
    case 'ask': return { ...state, removing: { kind: event.kind, rule: event.rule }, problem: null }
    case 'keep': return { ...state, removing: null }
    case 'saving': return { ...state, saving: true, removing: null, problem: null, said: null }
    case 'saved': {
      const { outcome } = event
      return outcome.ok ? { ...state, saving: false, read: { at: 'read', rules: outcome.value }, said: saidOf(event.edit) } : { ...state, saving: false, problem: outcome.refusal.message }
    }
  }
}

export const NOT_CONNECTED = 'Connect to Hermes to see its command rules.'

export type RulesSection =
  | { readonly show: 'note'; readonly words: string }
  | { readonly show: 'reading' }
  | { readonly show: 'failed'; readonly words: string }
  | { readonly show: 'rules'; readonly rules: CommandRules }

export function rulesSectionOf(read: RulesRead): RulesSection {
  if (read.at === 'reading') return { show: 'reading' }
  if (read.at === 'refused') return read.unsupported ? { show: 'note', words: read.words } : { show: 'failed', words: read.words }
  return { show: 'rules', rules: read.rules }
}

/** What an Add would do, or why it would not. A blank field has no note: nothing is wrong with it yet. */
export type AddPlan = { readonly edit: RuleEdit; readonly note: null } | { readonly edit: null; readonly note: string | null }

export function addPlan(text: string, kind: RuleKind, rules: CommandRules): AddPlan {
  const rule = ruleOf(text)
  if (rule === null) return { edit: null, note: text.trim() === '' ? null : 'A rule is one line of text.' }
  if (rules[kind].includes(rule)) return { edit: null, note: `That rule is already in the ${RULE_KINDS[kind].label.toLowerCase()} list.` }
  return { edit: { change: 'add', kind, rule }, note: null }
}

/** The dialog that asks before a rule goes: what Hermes does once it has. */
export function removalWords(kind: RuleKind, rule: string): { readonly title: string; readonly detail: string; readonly confirm: string } {
  return kind === 'allow'
    ? { title: `Stop always allowing “${rule}”?`, detail: 'Hermes will ask before it runs a command that matches it, unless another rule or your approval mode lets it through.', confirm: 'Remove rule' }
    : { title: `Stop denying “${rule}”?`, detail: 'Hermes will be able to run a command that matches it again. Your approval mode decides whether it asks first.', confirm: 'Remove rule' }
}

/** How long the page waits between two looks at whether the bot's config changed, and each look costs one small call. */
export const POLL_MS = 4000

/**
 * Reads the lists again only when the config's token moved. Hermes sends no event for a change made in config.yaml or by another
 * window, and a read is a ticket and a request, where the token is one call on the socket that is open already.
 */
export function rulesWatch({ stamp, read }: { readonly stamp: () => Promise<CommandOutcome<string>>; readonly read: () => Promise<void> }) {
  let seen: string | null = null
  return {
    /** Takes the token before the first read, so a change after the read shows as another token. */
    start: async () => {
      const first = await stamp()
      seen = first.ok ? first.value : null
      await read()
    },
    /** `manual`: the window came back to the front, so a Hermes that gives no token is read anyway. */
    look: async (manual: boolean) => {
      const next = await stamp()
      if (!next.ok) return manual ? read() : undefined
      if (next.value === seen) return
      seen = next.value
      await read()
    }
  }
}
