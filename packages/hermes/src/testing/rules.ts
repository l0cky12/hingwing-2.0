/**
 * The command rules of a fake Hermes: each profile's config as `GET /api/config` answers it, and the token that
 * `config.get` of `mtime` answers for it. One book serves the scripted gateway, a fixture run's HTTP calls and the
 * loopback's `/api/config`, so a PUT changes what the next GET and the next token say.
 */
import { RULES_PATH } from '../domain/rules'
import type { HttpAnswer } from '../wire/link'

type Obj = { [key: string]: unknown }
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The header's `rules`: both lists every profile starts with. `locked`: a managed install, which drops a save without a word (hermes_cli/config.py `save_config`). */
export interface RulesHeader {
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
  readonly locked?: boolean
}

/** Hermes's merge (hermes_cli/config.py:1353-1368): a dict merges, and anything else, a list included, replaces. */
function merged(base: Obj, patch: Obj): Obj {
  const out: Obj = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const held = out[key]
    out[key] = isObject(held) && isObject(value) ? merged(held, value) : structuredClone(value)
  }
  return out
}

const STAMP_START = 1_767_225_600.25

export class RuleBook {
  private readonly configs = new Map<string, Obj>()
  private readonly stamps = new Map<string, number>()

  /** `home`: the profile a request that names none is for. */
  constructor(private readonly header: RulesHeader, readonly home: string) {}

  private at(profile: string | null): string {
    return profile ?? this.home
  }

  /** The effective config of the profile: the two lists, `approvals.mode` beside `deny`, and a key that is not Hermes's rules to keep through a save. */
  config(profile: string | null): Obj {
    return structuredClone(this.configs.get(this.at(profile)) ?? {
      command_allowlist: [...(this.header.allow ?? [])],
      approvals: { mode: 'manual', deny: [...(this.header.deny ?? [])] },
      display: { language: 'en' }
    })
  }

  /** `config.get` of `mtime`: it changes with each save that reached the file. */
  stamp(profile: string | null): number {
    return this.stamps.get(this.at(profile)) ?? STAMP_START
  }

  put(profile: string | null, patch: Obj): void {
    if (this.header.locked === true) return
    const key = this.at(profile)
    this.configs.set(key, merged(this.config(profile), patch))
    this.stamps.set(key, this.stamp(profile) + 1)
  }
}

/** `/api/config` as Hermes serves it (hermes_cli/web_routers/config_env.py:82-181). null: another path. A PUT names its profile in its body or its query. */
export function configCall(book: RuleBook | null, ask: { readonly method: string; readonly path: string; readonly profile: string | null; readonly json?: unknown }): HttpAnswer | null {
  if (new URL(ask.path, 'http://fake').pathname !== RULES_PATH) return null
  if (book === null) return { status: 404, body: { detail: 'Not Found' } }
  if (ask.method === 'GET') return { status: 200, body: book.config(ask.profile) }
  if (ask.method !== 'PUT') return { status: 405, body: { detail: 'Method Not Allowed' } }
  const { json } = ask
  if (!isObject(json) || !isObject(json.config)) return { status: 422, body: { detail: 'config is required' } }
  book.put(ask.profile, json.config)
  return { status: 200, body: { ok: true } }
}
