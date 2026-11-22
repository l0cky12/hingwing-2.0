/** `@highwing/hermes/domain`: what the renderer and `@highwing/thread` may import. Types and one selector. */
export type * from './session'
export type { Command, Outcome as CommandOutcome, Refusal, ResultOf } from './command'
export { activityOf, type Activity } from './reduce'
