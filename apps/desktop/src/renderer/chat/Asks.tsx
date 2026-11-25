import type { RequestId, RequestReply } from '@highwing/hermes/domain'
import { fieldId, type AskCard as Card, type SecretCard as Secret } from '@highwing/thread'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Command } from './Copy'

export type RequestAnswer = (requestId: RequestId, reply: RequestReply) => void

interface CardProps<C extends Card> {
  readonly card: C
  readonly onAnswer: RequestAnswer
}

const SENDING = 'Sending…'

function Frame({ card, children }: { readonly card: Card; readonly children: ReactNode }) {
  return (
    <article className="turn">
      <div className="thread">
        <div className={`approval live ${card.kind}`} role="group" aria-label={card.heading} data-end="asking">
          <h3 data-find={fieldId(card.key, 'heading')}>{card.heading}</h3>
          {children}
          {card.error !== null && <p className="err" data-find={fieldId(card.key, 'error')}>{card.error}</p>}
        </div>
      </div>
    </article>
  )
}

const Waits = ({ card }: { readonly card: Card }) => card.waits !== null && <p className="why" data-find={fieldId(card.key, 'waits')}>{card.waits}</p>

/** The fields are uncontrolled, so what was typed is held by the input alone, read once on send and cleared. */
function SecretCard({ card, onAnswer }: CardProps<Secret>) {
  const form = useRef<HTMLFormElement>(null)
  const [filled, setFilled] = useState(false)
  const inputs = () => [...(form.current?.elements ?? [])].filter(element => element instanceof HTMLInputElement)
  const clear = () => {
    for (const input of inputs()) input.value = ''
    setFilled(false)
  }
  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!filled || card.busy !== null) return
    const typed = new FormData(event.currentTarget)
    const identifier = typed.get('identifier')
    onAnswer(card.requestId, { kind: 'secret', value: String(typed.get('value')), ...(typeof identifier === 'string' ? { identifier: identifier.trim() } : {}) })
    clear()
  }
  const skip = () => {
    clear()
    onAnswer(card.requestId, { kind: 'skip' })
  }
  return (
    <Frame card={card}>
      {card.command !== null && <Command nodeKey={card.key} command={card.command} />}
      {card.why !== null && <p className="why" data-find={fieldId(card.key, 'why')}>{card.why}</p>}
      {card.name !== null && <p className="why"><code data-find={fieldId(card.key, 'name')}>{card.name}</code></p>}
      <Waits card={card} />
      <form ref={form} className="answer" data-private="" onSubmit={send}>
        {card.fields.map(field => (
          <input
            key={field.part} name={field.part} type={field.masked ? 'password' : 'text'} autoComplete="off" aria-label={field.label} placeholder={field.label}
            onInput={() => setFilled(inputs().every(input => input.value !== ''))}
          />
        ))}
        <button type="button" disabled={card.busy !== null} onClick={skip}>{card.skip}</button>
        <button type="submit" className="primary" disabled={!filled || card.busy !== null}>{card.busy === 'sending' ? SENDING : card.send}</button>
      </form>
    </Frame>
  )
}

export function AskCard({ card, onAnswer }: CardProps<Card>) {
  switch (card.kind) {
    case 'secret':
      return <SecretCard card={card} onAnswer={onAnswer} />
    case 'questions':
    case 'connect':
      return null
  }
}
