import type { Target } from '@highwing/hermes/domain'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { introSteps } from '../../intro'
import { Bar } from '../chrome/Chrome'
import { run } from '../store'

export function Intro({ target }: { readonly target: Target }) {
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const primary = useRef<HTMLButtonElement>(null)
  const current = introSteps(target)[step]
  const leave = () => void run({ do: 'examples' })
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    leave()
  }
  useLayoutEffect(() => {
    primary.current?.focus()
  }, [step])
  return (
    <div className="screen" onKeyDown={onKeyDown}>
      <Bar where="Connection" />
      <main>
        <div className={step === 0 ? 'setup saved' : 'setup'} role="region" aria-label="Intro">
          <h2>{step === 0 && <span className="glyph" />}{current.title}</h2>
          <p className="lead">{current.lead}</p>
          <div className="actions">
            <button type="button" onClick={leave}>Skip</button>
            <button ref={primary} type="button" className="primary" autoFocus onClick={() => (step === 2 ? leave() : setStep(step === 0 ? 1 : 2))}>{current.primary}</button>
          </div>
        </div>
      </main>
    </div>
  )
}

export function ExampleRequests({ requests, onSend }: { readonly requests: readonly string[]; readonly onSend: (text: string) => Promise<unknown> }) {
  const held = useRef(false)
  const [busy, setBusy] = useState(false)
  if (requests.length === 0) return null
  const send = (text: string) => {
    if (held.current) return
    held.current = true
    setBusy(true)
    void onSend(text).finally(() => {
      held.current = false
      setBusy(false)
    })
  }
  return (
    <div className="examples">
      {requests.map(text => <button key={text} type="button" disabled={busy} onClick={() => send(text)}>{text}</button>)}
    </div>
  )
}
