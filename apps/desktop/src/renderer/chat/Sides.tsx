import type { SideId } from '@highwing/hermes/domain'
import { useId } from 'react'
import type { SideAnswer, SideCard } from './sides'
import { Markdown } from './text'

function Answer({ id, answer }: { readonly id: SideId; readonly answer: SideAnswer }) {
  switch (answer.s) {
    case 'waiting': return <p className="side-waiting" role="status">Waiting for the answer</p>
    case 'answered': return <div className="prose"><Markdown source={answer.markdown} caret={false} nodeKey={`side ${id}`} /></div>
    case 'failed': return <p className="err">{answer.message}</p>
    case 'lost': return <p className="side-lost">The answer was missed while the chat reconnected.</p>
  }
}

function Card({ card, onClose }: { readonly card: SideCard; readonly onClose: (id: SideId) => void }) {
  const heading = useId()
  return (
    <section className="side" aria-labelledby={heading} aria-busy={card.answer.s === 'waiting'}>
      <header>
        <h2 id={heading}>{card.label}</h2>
        <button type="button" aria-label={`Close ${card.label.toLowerCase()}`} onClick={() => onClose(card.id)}>
          <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </header>
      {card.asked !== null && <p className="side-asked">{card.asked}</p>}
      <Answer id={card.id} answer={card.answer} />
      <p className="side-note">Not part of the chat.</p>
    </section>
  )
}

export function Sides({ cards, onClose }: { readonly cards: readonly SideCard[]; readonly onClose: (id: SideId) => void }) {
  return (
    <div className="sides">
      {cards.map(card => <Card key={card.id} card={card} onClose={onClose} />)}
    </div>
  )
}
