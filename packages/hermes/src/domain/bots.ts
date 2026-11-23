/**
 * The bots of one Hermes, as Highwing's sidebar lists them. A bot is a Hermes profile.
 * Plain JSON data only, like `session.ts`, because these values cross Electron IPC.
 */

declare const brand: unique symbol

/** The profile's own name in Hermes, not the name shown. It changes when the user renames the profile. */
export type BotId = string & { readonly [brand]: 'BotId' }

/** The tones Highwing paints an avatar with, in the order it hands them out. `styles/app.css` has one `.tone-<name>` rule for each. */
export const BOT_TONES = ['slate', 'umber', 'plum', 'olive', 'mauve'] as const
export type BotTone = typeof BOT_TONES[number]
/** `ink` belongs to the default bot alone. */
export type AvatarTone = BotTone | 'ink'

/** What Hermes says about one bot, before Highwing decides where and how to draw it. */
export interface BotFacts {
  readonly id: BotId
  /** The name shown. Never blank. */
  readonly name: string
  readonly isDefault: boolean
  readonly role: string | null
  /** null: Hermes puts this bot in no section. */
  readonly section: string | null
  /** The tone the user chose for this bot. null: Highwing picks one. */
  readonly chosenTone: BotTone | null
  /** One line from the bot's newest chat. null: it has no messages yet. */
  readonly preview: string | null
}

export interface Bot {
  readonly id: BotId
  readonly name: string
  readonly role: string | null
  readonly preview: string | null
  /** Always set, so the renderer never chooses a colour. */
  readonly tone: AvatarTone
}

export interface BotSection {
  /** null: the bots in no section. That section is always the last. */
  readonly name: string | null
  /** Never empty. */
  readonly bots: readonly Bot[]
}

/**
 * Every bot once, in the order the sidebar draws them: the default bot, then each section from the
 * top. No two neighbours in that order share a tone unless the user chose both tones.
 */
export interface Roster {
  /** Hermes's default profile. null when Hermes marks none. */
  readonly featured: Bot | null
  readonly sections: readonly BotSection[]
}

/** What Highwing knows about this Hermes's bots. Exactly one of these at a time, so the sidebar has one thing to draw. */
export type Bots =
  /** Asked, or about to ask. No answer yet. */
  | { readonly state: 'loading' }
  /** No answer yet and no connection to ask over. The connection banner says why. */
  | { readonly state: 'offline' }
  /** This Hermes has no `profiles.list`. It is not asked again on this connection. */
  | { readonly state: 'unsupported' }
  /** Hermes has the call and would not answer it. Asked again when sessions change. */
  | { readonly state: 'refused' }
  /** The newest roster Hermes gave. It stays while the connection is down or a later ask is refused. */
  | { readonly state: 'listed'; readonly roster: Roster }

const shown = ({ id, name, role, preview }: BotFacts, tone: AvatarTone): Bot => ({ id, name, role, preview, tone })

/**
 * Tones go down the list in turn. A bot skips a tone that the bot above has or that the bot below
 * chose, so neighbours match only when the user chose both. Two tones to avoid out of five always leaves one.
 */
function painted(rows: readonly BotFacts[]): Bot[] {
  const out: Bot[] = []
  let next = 0
  for (const [at, row] of rows.entries()) {
    let tone = row.chosenTone
    if (tone === null) {
      const avoid = [out[at - 1]?.tone, rows[at + 1]?.chosenTone]
      while (avoid.includes(BOT_TONES[next % BOT_TONES.length])) next++
      tone = BOT_TONES[next++ % BOT_TONES.length] as BotTone
    }
    out.push(shown(row, tone))
  }
  return out
}

/**
 * The one place that decides where each bot goes and how it is painted. Pure.
 *
 * The first default bot is featured, in ink. Every other bot, a later default bot included, goes
 * under its section. Sections keep the order their first bot has in `facts`, bots keep the order
 * of `facts`, and the bots in no section come last.
 */
export function rosterOf(facts: readonly BotFacts[]): Roster {
  const featured = facts.find(bot => bot.isDefault) ?? null
  const rest = facts.filter(bot => bot !== featured)
  const names = [...new Set(rest.map(bot => bot.section))].sort((a, b) => Number(a === null) - Number(b === null))
  const ordered = names.flatMap(name => rest.filter(bot => bot.section === name))
  const bots = painted(ordered)
  return {
    featured: featured === null ? null : shown(featured, 'ink'),
    sections: names.map(name => ({ name, bots: bots.filter((_, at) => ordered[at]?.section === name) }))
  }
}
