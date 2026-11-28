import { TicketRefused, type CallHermes, type HermesAsk, type HttpAnswer } from '@highwing/hermes'
import { holdsEdit, parseCommandRules, RULE_KINDS, RULES_PATH, ruleOf, withEdit, type BotId, type CommandOutcome, type CommandRules, type Refusal, type RuleEdit } from '@highwing/hermes/domain'

const refused = (kind: Refusal['kind'], message: string): CommandOutcome<never> => ({ ok: false, refusal: { kind, message } })
const UNSUPPORTED = refused('unsupported', "This Hermes can't show its command rules to Highwing. Update Hermes, then try again.")
const UNREADABLE = refused('unsupported', "Hermes answered with command rules Highwing can't read.")
const UNREACHABLE = refused('offline', "Highwing couldn't reach Hermes to read its command rules.")
const UNREACHED_EDIT = refused('offline', "Highwing couldn't reach Hermes, so it didn't change the rule.")
const NOT_SAVED = refused('rejected', "Hermes didn't save that change. An administrator may manage this setting.")
const NO_RULE = refused('rejected', 'A rule is one line of text.')

/** A ticket Hermes will not mint for a profile is a Hermes that predates profile-bound tickets. Any other refusal means the bot is not there to reach. */
const CANT_MINT: ReadonlySet<string | null> = new Set(['unsupported_purpose', 'invalid_request'])
/** No such route or method. A GET is also refused 403 when the ticket Hermes minted is bound to another profile than the one asked for. */
const NO_ROUTE: ReadonlySet<number> = new Set([404, 405])

const asked = (call: CallHermes, ask: HermesAsk): Promise<HttpAnswer | 'unsupported' | null> =>
  call(ask).catch((error: unknown) => (error instanceof TicketRefused && CANT_MINT.has(error.code) ? 'unsupported' : null))

async function fetched(call: CallHermes, bot: BotId | null, unreached: CommandOutcome<never>): Promise<CommandOutcome<CommandRules>> {
  const answer = await asked(call, { method: 'GET', path: RULES_PATH, profile: bot })
  if (answer === 'unsupported') return UNSUPPORTED
  if (answer === null) return unreached
  if (NO_ROUTE.has(answer.status) || answer.status === 403) return UNSUPPORTED
  if (answer.status !== 200) return unreached
  const rules = parseCommandRules(answer.body)
  return rules === null ? UNREADABLE : { ok: true, value: rules }
}

/** The bot's always-allow and deny rules as Hermes holds them. `bot` null: the profile the connection's own ticket belongs to. */
export const readCommandRules = (call: CallHermes, bot: BotId | null): Promise<CommandOutcome<CommandRules>> => fetched(call, bot, UNREACHABLE)

/**
 * Reads the bot's rules, changes the one list the edit names, writes only that list, and reads them again, so the
 * answer is what Hermes holds and not what was sent: a managed install drops a save without an error. An add of a
 * rule that is there and a remove of one that is not write nothing.
 */
export async function editCommandRule(call: CallHermes, bot: BotId | null, edit: RuleEdit): Promise<CommandOutcome<CommandRules>> {
  const rule = ruleOf(edit.rule)
  if (rule === null) return NO_RULE
  const wanted: RuleEdit = { ...edit, rule }
  const before = await fetched(call, bot, UNREACHED_EDIT)
  if (!before.ok || holdsEdit(before.value, wanted)) return before
  const list = withEdit(before.value[wanted.kind], wanted)
  const saved = await asked(call, { method: 'PUT', path: RULES_PATH, profile: bot, json: { config: RULE_KINDS[wanted.kind].body(list) } })
  if (saved === 'unsupported') return UNSUPPORTED
  if (saved === null) return UNREACHED_EDIT
  if (NO_ROUTE.has(saved.status)) return UNSUPPORTED
  if (saved.status !== 200) return NOT_SAVED
  const after = await fetched(call, bot, UNREACHED_EDIT)
  return after.ok && !holdsEdit(after.value, wanted) ? NOT_SAVED : after
}
