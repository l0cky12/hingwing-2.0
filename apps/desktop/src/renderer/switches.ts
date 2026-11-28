import { useEffect, useState } from 'react'
import type { CommandOutcome, Refusal } from '@highwing/hermes/domain'

type Asked<S> = { readonly scope: S | null; readonly wanted: ReadonlyMap<string, boolean> }
const NONE: ReadonlyMap<string, boolean> = new Map()

export function useSwitches<T extends { readonly enabled: boolean }, S>(
  scope: S, items: readonly T[] | null, keyOf: (item: T) => string, flip: (item: T, enabled: boolean) => Promise<CommandOutcome<unknown>>
) {
  const [asked, setAsked] = useState<Asked<S>>({ scope: null, wanted: NONE })
  const [refused, setRefused] = useState<{ readonly scope: S; readonly refusal: Refusal } | null>(null)
  useEffect(() => {
    if (items === null) return
    setAsked(held => {
      if (held.scope !== scope) return held
      const wanted = new Map([...held.wanted].filter(([key, on]) => items.find(item => keyOf(item) === key)?.enabled !== on))
      return wanted.size === held.wanted.size ? held : { scope, wanted }
    })
  }, [scope, items])
  const ask = (at: S, key: string, wanted: boolean | null) => setAsked(before => {
    if (wanted === null && before.scope !== at) return before
    const next = new Map(before.scope === at ? before.wanted : NONE)
    if (wanted === null) next.delete(key)
    else next.set(key, wanted)
    return { scope: at, wanted: next }
  })
  const toggle = async (item: T) => {
    const at = scope
    const key = keyOf(item)
    setRefused(null)
    ask(at, key, !item.enabled)
    const done = await flip(item, !item.enabled)
    if (done.ok) return
    ask(at, key, null)
    setRefused({ scope: at, refusal: done.refusal })
  }
  const wanted = asked.scope === scope ? asked.wanted : NONE
  const refusal = refused !== null && refused.scope === scope ? refused.refusal : null
  const locked = refusal?.kind === 'unsupported'
  return {
    problem: refusal?.message ?? null,
    of: (item: T) => {
      const key = keyOf(item)
      return { checked: wanted.get(key) ?? item.enabled, disabled: locked || wanted.size > 0, onChange: () => void toggle(item) }
    }
  }
}
