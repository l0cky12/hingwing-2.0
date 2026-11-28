/**
 * What a bot's Hermes always allows and always denies, as `GET /api/config` holds it: the top-level
 * `command_allowlist` and `approvals.deny` (hermes_cli/web_routers/config_env.py). Hermes has no list of commands
 * to ask about first, so there are two kinds.
 */
type Obj = Readonly<Record<string, unknown>>
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)

export type RuleKind = 'allow' | 'deny'
export const RULE_ORDER: readonly RuleKind[] = ['allow', 'deny']

export interface CommandRules {
  readonly allow: readonly string[]
  readonly deny: readonly string[]
}

export type RuleEdit = { readonly change: 'add' | 'remove'; readonly kind: RuleKind; readonly rule: string }

export const RULES_PATH = '/api/config'
/**
 * The config as the file holds it, with each `${VAR}` template as written and a key the file lacks left out. An edit reads
 * this one: the effective config expands the templates, and Hermes's save would write an expanded value back.
 */
export const RAW_RULES_PATH = `${RULES_PATH}?include_defaults=false`

/**
 * Each entry trimmed, blanks and anything but text left out, and a repeat once: how Hermes reads both lists
 * (tools/approval_floors.py `_matching_permanent_allowlist_entry` and `_match_user_deny_rule`).
 */
const listOf = (raw: unknown): readonly string[] =>
  Array.isArray(raw) ? [...new Set(raw.flatMap((entry): string[] => (typeof entry === 'string' && entry.trim() !== '' ? [entry.trim()] : [])))] : []

interface RuleFacts {
  /** Where the list sits in the config `GET /api/config` answers. */
  readonly read: (config: Obj) => unknown
  /**
   * The partial config a PUT sends to replace this list: Hermes merges dicts and replaces lists, so `approvals.mode`
   * and every other key stays as it is.
   */
  readonly body: (rules: readonly string[]) => Obj
  /** The list's heading, and the line under it that says what a rule in it does. */
  readonly label: string
  readonly desc: string
  /** The choice that adds a rule to it, and the empty list's words. */
  readonly adds: string
  readonly empty: string
}

export const RULE_KINDS: { readonly [K in RuleKind]: RuleFacts } = {
  allow: {
    read: config => config.command_allowlist,
    body: rules => ({ command_allowlist: rules }),
    label: 'Always allowed',
    desc: 'Hermes runs a command that matches one of these without asking. Each is a command, or a pattern such as podman *, or a kind of command Hermes flagged when you chose Always allow.',
    adds: 'Allow',
    empty: 'Nothing is always allowed.'
  },
  deny: {
    read: config => (isObject(config.approvals) ? config.approvals.deny : config.approvals),
    body: rules => ({ approvals: { deny: rules } }),
    label: 'Denied',
    desc: 'Hermes never runs a command that matches one of these, even with YOLO on. Each is a pattern, where * stands for any text, and capital letters don’t matter.',
    adds: 'Deny',
    empty: 'No commands are denied.'
  }
}

const isUnset = (raw: unknown): boolean => raw === undefined || raw === null

/**
 * null: the reply is not a config, or holds a list as something but a list, such as the text Hermes still honors in an older file,
 * which an edit would overwrite. The effective config holds both lists, so one that holds neither is not a config. The raw one
 * leaves out a list the file lacks, and a config that holds neither reads as two empty ones.
 */
export function parseCommandRules(body: unknown, source: 'effective' | 'raw'): CommandRules | null {
  if (!isObject(body)) return null
  const [allow, deny] = RULE_ORDER.map(kind => RULE_KINDS[kind].read(body))
  if (![allow, deny].every(raw => isUnset(raw) || Array.isArray(raw))) return null
  if (source === 'effective' && isUnset(allow) && isUnset(deny)) return null
  return { allow: listOf(allow), deny: listOf(deny) }
}

/** The rule as it is stored: trimmed. null for no text, and for more than one line, which a glob in a list cannot be. */
export const ruleOf = (text: string): string | null => {
  const rule = text.trim()
  return rule === '' || /[\r\n]/.test(rule) ? null : rule
}

/** One kind's list after the edit. An add of a rule the list holds, and a remove of one it lacks, leave it as it was. */
export function withEdit(rules: readonly string[], { change, rule }: RuleEdit): readonly string[] {
  if (change === 'add') return rules.includes(rule) ? rules : [...rules, rule]
  return rules.includes(rule) ? rules.filter(held => held !== rule) : rules
}

/** Whether `rules` is what the edit asks for. */
export const holdsEdit = (rules: CommandRules, { change, kind, rule }: RuleEdit): boolean => rules[kind].includes(rule) === (change === 'add')
