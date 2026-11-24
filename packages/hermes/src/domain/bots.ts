/**
 * The bots of one Hermes, as Highwing's sidebar lists them. A bot is a Hermes profile.
 * Plain JSON data only, like `session.ts`, because these values cross Electron IPC.
 */
import type { ModelOption, SessionId } from './session'

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
  /** null: Hermes puts this bot in no section. */
  readonly section: string | null
  /** One line from the bot's newest chat. null: it has no messages yet. */
  readonly preview: string | null
  /** What the bot is for, as its owner wrote it. null: nothing written. */
  readonly description: string | null
  /**
   * The bot's Bot Chat, the one a click on its row opens. null: it has none, or this socket may not
   * read it. It stays out of `Bot`, so a window learns a session only from the open chat.
   */
  readonly chat: SessionId | null
}

export interface Bot {
  readonly id: BotId
  readonly name: string
  readonly preview: string | null
  readonly description: string | null
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
 * top. No two neighbours in that order share a tone.
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

export interface BotDraft {
  readonly name: string
  readonly description: string
  /** null: Hermes's default model. */
  readonly model: ModelOption | null
  /** The bot's SOUL.md, its persona. */
  readonly persona: string
}

/** What Hermes made. `warnings`: Hermes's own words, e.g. a credential it could not mirror. The bot exists either way. */
export interface BotCreated {
  readonly bot: BotId
  readonly warnings: readonly string[]
}

/** The id Hermes gives a typed name: trimmed and lowercased, `default` in any case (hermes_cli/profiles.py:370-396). */
export const canonicalBotId = (name: string): BotId => name.trim().toLowerCase() as BotId

const shown = ({ id, name, preview, description }: BotFacts, tone: AvatarTone): Bot => ({ id, name, preview, description, tone })

/** Every bot of a roster, in the order the sidebar draws them. */
export const botsIn = ({ featured, sections }: Roster): readonly Bot[] => [...(featured === null ? [] : [featured]), ...sections.flatMap(section => section.bots)]

/** Only the first default bot is featured. */
export function rosterOf(facts: readonly BotFacts[]): Roster {
  const featured = facts.find(bot => bot.isDefault) ?? null
  const rest = facts.filter(bot => bot !== featured)
  const names = [...new Set(rest.map(bot => bot.section))].sort((a, b) => Number(a === null) - Number(b === null))
  const ordered = names.flatMap(name => rest.filter(bot => bot.section === name))
  const bots = ordered.map((bot, at) => shown(bot, BOT_TONES[at % BOT_TONES.length] as BotTone))
  return {
    featured: featured === null ? null : shown(featured, 'ink'),
    sections: names.map(name => ({ name, bots: bots.filter((_, at) => ordered[at]?.section === name) }))
  }
}
