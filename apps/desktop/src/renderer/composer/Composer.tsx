import type { CommandOutcome } from '@highwing/hermes/domain'
import { useState, type FormEvent, type KeyboardEvent } from 'react'

interface ComposerProps {
  readonly canSend: boolean
  readonly showStop: boolean
  readonly onSend: (text: string) => Promise<CommandOutcome>
  readonly onStop: () => void
  readonly onInput: () => void
}

export function Composer({ canSend, showStop, onSend, onStop, onInput }: ComposerProps) {
  const [draft, setDraft] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = draft.trim()
    if (!canSend || text === '') return
    const outcome = await onSend(text)
    setRefusal(outcome.ok ? null : outcome.refusal.message)
    if (outcome.ok) setDraft(held => (held.trim() === text ? '' : held))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void submit()
  }

  return (
    <footer className="composer">
      <form onSubmit={submit}>
        <textarea rows={1} placeholder="Ask Hermes to do something" aria-label="Message Hermes" value={draft} onChange={event => { setDraft(event.target.value); onInput() }} onKeyDown={onKeyDown} />
        {showStop && <button type="button" className="stop" disabled={!canSend} onClick={onStop}>Stop</button>}
        <button type="submit" disabled={!canSend}>Send</button>
      </form>
      {refusal !== null && <p className="err refusal">{refusal}</p>}
    </footer>
  )
}
