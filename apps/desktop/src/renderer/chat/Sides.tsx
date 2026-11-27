import type { SideId } from '@highwing/hermes/domain'
import { memo, useId, useLayoutEffect, useRef } from 'react'
import { MessageActions } from './MessageActions'
import type { SideAnswer, SideCard, SideRow } from './sides'
import { Markdown } from './text'

function Answer({ id, answer }: { readonly id: SideId; readonly answer: SideAnswer }) {
  switch (answer.s) {
    case 'waiting': return <p className="side-waiting" role="status">Waiting for the answer</p>
    case 'answered': return <div className="prose"><Markdown source={answer.markdown} caret={false} nodeKey={`side ${id}`} /></div>
    case 'failed': return <p className="err">{answer.message}</p>
    case 'lost': return <p className="side-lost">The answer was missed while the chat reconnected.</p>
  }
}

interface CardProps {
  readonly card: SideCard
  readonly onClose: (id: SideId) => void
  readonly returnFocus: () => void
}

function Card({ card, onClose, returnFocus }: CardProps) {
  const heading = useId()
  const box = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const element = box.current
    return () => {
      if (element?.contains(document.activeElement) === true) returnFocus()
    }
  }, [returnFocus])
  return (
    <section ref={box} className="side" aria-labelledby={heading} aria-busy={card.answer.s === 'waiting'}>
      <header>
        <h2 id={heading}>{card.label}</h2>
        <button type="button" aria-label={`Close ${card.label.toLowerCase()}`} onClick={() => onClose(card.id)}>
          <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </header>
      {card.asked !== null && <p className="side-asked">{card.asked}</p>}
      <Answer id={card.id} answer={card.answer} />
      <p className="side-note">{card.note}</p>
    </section>
  )
}

export function Sides({ cards, onClose, returnFocus }: { readonly cards: readonly SideCard[] } & Omit<CardProps, 'card'>) {
  const stack = useRef<HTMLDivElement>(null)
  const newest = cards.at(-1)?.id
  useLayoutEffect(() => {
    const element = stack.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [newest])
  return (
    <div className="sides" ref={stack}>
      {cards.map(card => <Card key={card.id} card={card} onClose={onClose} returnFocus={returnFocus} />)}
    </div>
  )
}

export const SideTurn = memo(function SideTurn({ row }: { readonly row: SideRow }) {
  const heading = useId()
  const { answer } = row
  return (
    <article className="turn side side-row" aria-labelledby={heading}>
      <h2 id={heading}>Side question</h2>
      <p className="side-asked">{row.asked ?? 'Asked in another window'}</p>
      {answer.s === 'answered'
        ? <><div className="prose"><Markdown source={answer.markdown} caret={false} nodeKey={`side:${row.id}`} /></div><div className="turn-actions"><MessageActions acts={{ copy: { text: answer.markdown, name: 'Copy reply' } }} /></div></>
        : <p className="err">{answer.message}</p>}
      <p className="side-note">Not saved with the chat. Later replies won't see it.</p>
    </article>
  )
})
