/** `@highwing/hermes/domain`: what the renderer and `@highwing/thread` may import. Types, one selector, and the tables that name a target and its failures. */
export type * from './session'
export type { Command, ModelConfirm, ModelMenu, Outcome as CommandOutcome, Refusal, ResultOf } from './command'
export { activityOf, type Activity } from './reduce'
export type { SlashCatalog, SlashEntry } from './slash'
export { BOT_TONES, rosterOf, type AvatarTone, type Bot, type BotFacts, type BotId, type Bots, type BotSection, type BotTone, type Roster } from './bots'
export type { ChatRef, OpenChat, Shown, Unstarted } from './open'
export { modelViewOf, sameModel, type ModelView } from './model'
export { CHECK_FAILURES, STEP_WORDS, machineOf, parseSshHost, targetOf, type CheckFailure, type CheckStep, type SshHost, type Target } from './reach'
