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
  /** Hermes holds a picture for this bot. Highwing reads it apart, with `botPicture`. */
  readonly picture: boolean
}

export interface Bot {
  readonly id: BotId
  readonly name: string
  readonly preview: string | null
  readonly description: string | null
  readonly tone: AvatarTone
  readonly picture: boolean
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

export interface BotDetails {
  readonly bot: BotId
  /** The name shown, as the sidebar draws it. */
  readonly name: string
  readonly description: string
  readonly persona: string
  /**
   * Hermes's revision of the name, which a rename sends back so a rename made elsewhere since is refused.
   * null: a Hermes that keeps no revisions, so a rename overwrites.
   */
  readonly revision: number | null
}

/** The picture Hermes stores for a bot: a PNG, JPEG or WebP of at most this many bytes (tui_gateway/methods_profiles.py:434-442). */
export const PICTURE_MAX_BYTES = 2_000_000
export const PICTURE_RULE = 'Pick a PNG, JPEG or WebP picture of 2 MB or less.'

export type PictureType = 'image/png' | 'image/jpeg' | 'image/webp'

const MAGIC: readonly (readonly [PictureType, readonly (readonly [number, string])[]])[] = [
  ['image/png', [[0, '89504e470d0a1a0a']]],
  ['image/jpeg', [[0, 'ffd8ff']]],
  ['image/webp', [[0, '52494646'], [8, '57454250']]]
]
const hexAt = (bytes: Uint8Array, start: number, length: number) =>
  Array.from(bytes.subarray(start, start + length), byte => byte.toString(16).padStart(2, '0')).join('')

/** The picture type the bytes start with, sniffed as Hermes does (tui_gateway/methods_profiles.py:17-20). A name or a declared type is never trusted. */
export const pictureTypeOf = (bytes: Uint8Array): PictureType | null =>
  MAGIC.find(([, marks]) => marks.every(([start, hex]) => hexAt(bytes, start, hex.length / 2) === hex))?.[0] ?? null

/** The most bytes of a picture Hermes's image model draws that Highwing asks for. The window shrinks it before it is stored. */
export const GENERATED_MAX_BYTES = 8_000_000

const DATA_URL = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/]*={0,2})$/

/**
 * A data URL of a PNG, JPEG or WebP of 1 to `limit` bytes, typed by its first bytes rather than the type it declares, or null
 * for anything else. Only the first bytes are decoded, so a large picture is cheap to check.
 */
export function pictureDataUrlOf(raw: unknown, limit: number): string | null {
  const base64 = typeof raw === 'string' ? DATA_URL.exec(raw)?.[1] : undefined
  if (base64 === undefined || base64.length % 4 !== 0) return null
  const size = (base64.length / 4) * 3 - (base64.length - base64.replace(/=+$/, '').length)
  if (size === 0 || size > limit) return null
  const type = pictureTypeOf(Uint8Array.from(atob(base64.slice(0, 16)), char => char.charCodeAt(0)))
  return type && `data:${type};base64,${base64}`
}

/**
 * A slug Hermes's `_safe_slug` keeps as it is (agent/pet/store.py:93-96): one path segment with no separator, `.` or `..`.
 * `pet.thumb` names its cache file `pets/.thumbs/<slug>.png` from the slug unchecked (agent/pet/store.py:68-70, :233), so any
 * other slug could read or write a file outside that folder. On a Windows Hermes a colon starts a drive (`D:x`) or names a
 * file's stream, so it is refused too.
 */
export const isPetSlug = (slug: string): boolean => slug !== '' && slug === slug.trim() && slug !== '.' && slug !== '..' && !/[/\\:]/.test(slug)

/** A pet Hermes lists, whose idle frame a new bot can take as its picture. `url`: where Hermes fetches its sprites, or null for one Hermes holds. */
export interface PetChoice {
  readonly slug: string
  readonly name: string
  readonly url: string | null
}

/** Only the fields the user changed. */
export interface BotEdit {
  readonly name?: string
  readonly description?: string
  readonly persona?: string
}

/** The id Hermes gives a typed name: trimmed and lowercased, `default` in any case (hermes_cli/profiles.py:370-396). */
export const canonicalBotId = (name: string): BotId => name.trim().toLowerCase() as BotId

const shown = ({ id, name, preview, description, picture }: BotFacts, tone: AvatarTone): Bot => ({ id, name, preview, description, tone, picture })

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
