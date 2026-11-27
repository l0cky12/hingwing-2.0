import type { BotId } from './bots'

export interface Skill {
  readonly name: string
  /** One line. Empty when Hermes and the skill's own file give none. */
  readonly description: string
  readonly enabled: boolean
}

/** The skills of the bot the window shows. `bot` null: the socket's own profile. */
export type SkillLibrary =
  | { readonly state: 'reading'; readonly bot: BotId | null }
  | { readonly state: 'listed'; readonly bot: BotId | null; readonly skills: readonly Skill[] }
  | { readonly state: 'failed'; readonly bot: BotId | null; readonly message: string }
