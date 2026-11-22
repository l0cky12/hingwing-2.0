/** `@highwing/hermes/domain`: what the renderer and `@highwing/thread` may import. Types and one selector. */
export type * from './session'
/** `CommandOutcome` here, `Outcome` from `@highwing/hermes`: in the domain, `Outcome` is how a turn ended. */
export type { Command, Outcome as CommandOutcome, Refusal, ResultOf } from './command'
export { activityOf, type Activity } from './reduce'
