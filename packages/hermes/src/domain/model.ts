import type { ModelMenu } from './command'
import type { ModelOption, ModelRef, SessionContent, SessionModel } from './session'

/** What the model control shows for one chat. Derived, never stored. */
export type ModelView =
  /** This Hermes does not list its models, or has not answered yet. No control. */
  | { readonly show: 'hidden' }
  | { readonly show: 'none' }
  | {
      readonly show: 'list'
      readonly current: ModelRef | null
      /** The pick that waits for the running turn to end. */
      readonly next: ModelRef | null
      readonly options: readonly ModelOption[]
      /** A turn is running, so a pick now waits for it. */
      readonly deferring: boolean
      readonly ask: SessionModel['ask']
    }

export function modelViewOf(menu: ModelMenu | null, session: SessionContent | undefined): ModelView {
  if (menu === null || session === undefined) return { show: 'hidden' }
  if (menu.options.length === 0) return { show: 'none' }
  const { run, model } = session
  const deferring = run.state === 'running'
  // session.info names no provider; the model Hermes names for the chat in model.options does.
  const named = model.current
  const current = named === null ? menu.fallback
    : named.provider === null && menu.fallback?.id === named.id ? menu.fallback
    : named
  const held = deferring && model.next !== null && model.next.during === run.generation ? model.next.model : null
  const next = held !== null && current !== null && sameModel(held, current) ? null : held
  return { show: 'list', current, next, options: menu.options, deferring, ask: model.ask }
}

/** A side that names no provider matches any provider. */
export function sameModel(a: ModelRef, b: ModelRef): boolean {
  return a.id === b.id && (a.provider === null || b.provider === null || a.provider === b.provider)
}
