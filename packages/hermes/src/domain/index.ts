/** `@highwing/hermes/domain`: what the renderer and `@highwing/thread` may import. Types, one selector, and the tables that name a target and its failures. */
export type * from './session'
export type { Command, ModelConfirm, ModelMenu, Outcome as CommandOutcome, Refusal, ResultOf } from './command'
export { activityOf, type Activity } from './reduce'
export type { SlashCatalog, SlashEntry } from './slash'
export { modelViewOf, sameModel, type ModelView } from './model'
export { CHECK_FAILURES, STEP_WORDS, machineOf, parseSshHost, targetOf, type CheckFailure, type CheckStep, type SshHost, type Target } from './reach'
