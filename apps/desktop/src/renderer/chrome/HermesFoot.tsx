import { machineOf, type Target } from '@highwing/hermes/domain'
import type { Ref } from 'react'
import { run, useTopic } from '../store'

export function HermesFoot({ target, ref }: { readonly target: Target | null; readonly ref: Ref<HTMLButtonElement> }) {
  const online = useTopic('link')?.state === 'online'
  const machine = target === null ? null : machineOf(target)
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
