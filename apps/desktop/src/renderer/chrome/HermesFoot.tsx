import { hermesName, type Target } from '@highwing/hermes/domain'
import type { Ref } from 'react'
import { run, useTopic } from '../store'

/** The name of the Hermes `target` leads to, as the top bar and the Hermes button show it. null with no connection. */
export function useHermesName(target: Target | null): string | null {
  const book = useTopic('servers')
  return target === null ? null : hermesName(book?.list.find(({ id }) => id === book.current), target)
}

export function HermesFoot({ target, ref }: { readonly target: Target | null; readonly ref: Ref<HTMLButtonElement> }) {
  const online = useTopic('link')?.state === 'online'
  const machine = useHermesName(target)
  const state = online ? 'Connected' : 'Not connected'
  return (
    <button
      ref={ref} type="button" className="account-button" disabled={target === null}
      aria-label={`Hermes${machine === null ? '' : ` on ${machine}`}, ${state}`} onClick={() => void run({ do: 'editTarget' })}
    >
      <span className="account-mark" aria-hidden="true">H</span>
      <span className="account-name" aria-hidden="true">
        <span>Hermes</span>
        <span className="account-detail">{machine === null ? state : `on ${machine}`}</span>
        {machine !== null && <span className="account-detail" data-online={online || undefined}>{state}</span>}
      </span>
    </button>
  )
}
