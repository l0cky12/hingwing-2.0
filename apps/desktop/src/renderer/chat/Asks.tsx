import type { Answer, RequestId, RequestReply } from '@highwing/hermes/domain'
import { drawnQuestions, fieldId, type AskCard as Card, type ConnectCard as Connect, type QuestionsCard as Questions, type QuestionView, type SecretCard as Secret, type TargetView } from '@highwing/thread'
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Command } from './Copy'
import { answerOf, draftOf, lockAnswer, OTHER, picked, sendWords, type Draft } from './questions'

/** Resolves with whether Hermes took the answer. */
export type RequestAnswer = (requestId: RequestId, reply: RequestReply) => Promise<boolean>

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

interface QuestionProps {
  readonly card: Questions
  readonly question: QuestionView
  readonly draft: Draft
  readonly onDraft: (draft: Draft) => void
  readonly onLock: (answer: Answer) => void
}

function Question({ card, question, draft, onDraft, onLock }: QuestionProps) {
  const group = useId()
  const busy = card.busy !== null
  const answer = answerOf(draft)
  const type = question.multi ? 'checkbox' : 'radio'
  const send = (event: FormEvent) => {
    event.preventDefault()
    if (answer !== null && !busy) onLock(answer)
  }
  const choice = (label: string | typeof OTHER, checked: boolean, words: string) => (
    <label key={words} className="pick">
      <input type={type} name={group} checked={checked} onChange={event => onDraft(picked(question, draft, label, event.currentTarget.checked))} />
      {words}
    </label>
  )
  return (
    <form className="question" onSubmit={send}>
      <fieldset disabled={busy}>
        <legend data-find={fieldId(card.key, `question ${card.questions.indexOf(question)}`)}>{question.text}</legend>
        {question.multi && <p className="hint">Pick all that apply</p>}
        {question.choices.map(label => choice(label, draft.picks.includes(label), label))}
        {question.choices.length > 0 && choice(OTHER, draft.other !== null, 'Other')}
        {draft.other !== null && (
          <input
            className="other" aria-label="Your answer" value={draft.other} autoFocus={question.choices.length > 0}
            onChange={event => onDraft({ ...draft, other: event.currentTarget.value })}
          />
        )}
      </fieldset>
      <div className="choices">
        <button type="submit" className="primary" disabled={answer === null || busy}>{card.busy === 'sending' ? SENDING : sendWords(card, question)}</button>
        <button type="button" className="deny" disabled={busy} onClick={() => onLock(null)}>Skip question</button>
      </div>
    </form>
  )
}

interface Changes {
  /** The id of the locked question the window is changing. */
  readonly changing: string | null
  readonly onChange: (question: string | null) => void
}

function QuestionsCard({ card, changing, onChange, onAnswer }: CardProps<Questions> & Changes) {
  const [drafts, setDrafts] = useState<{ readonly [question: string]: Draft }>({})
  const { locked, open: shown } = drawnQuestions(card, changing)
  const open = shown?.question
  return (
    <Frame card={card}>
      {card.progress !== null && <p className="why" data-find={fieldId(card.key, 'progress')}>{card.progress}</p>}
      <Waits card={card} />
      {locked.length > 0 && (
        <ul className="locked">
          {locked.map(({ question, index, words }) => (
            <li key={question.id}>
              <span className="asked" data-find={fieldId(card.key, `question ${index}`)}>{question.text}</span>
              <span className="said" data-find={fieldId(card.key, `answer ${index}`)}>{words}</span>
              {open !== undefined && (
                <button type="button" disabled={card.busy !== null} aria-label={`Change: ${question.text}`} onClick={() => onChange(question.id)}>Change</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {open !== undefined && (
        <Question
          key={open.id} card={card} question={open} draft={drafts[open.id] ?? draftOf(open)}
          onDraft={draft => setDrafts(held => ({ ...held, [open.id]: draft }))}
          onLock={answer => void lockAnswer(reply => onAnswer(card.requestId, reply), open.id, answer, onChange)}
        />
      )}
    </Frame>
  )
}

interface TargetProps {
  readonly card: Connect
  readonly target: TargetView
  readonly index: number
  readonly sending: boolean
  readonly onRespond: (as: 'approved' | 'skipped', values?: { readonly [field: string]: string }) => void
}

function Target({ card, target, index, sending, onRespond }: TargetProps) {
  const busy = card.busy !== null
  const connect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const typed = new FormData(event.currentTarget)
    const values = Object.fromEntries(target.fields.map(field => [field.name, String(typed.get(field.name) ?? '')]))
    onRespond('approved', target.fields.length === 0 ? undefined : values)
    event.currentTarget.reset()
  }
  return (
    <li>
      <form className="target" role="group" aria-label={target.heading} data-private="" onSubmit={connect}>
        <p className="head">
          <span className="name" data-find={fieldId(card.key, `target ${index}`)}>{target.heading}</span>
          <span className={`state ${target.open ? 'waiting' : 'settled'}`}>{target.state}</span>
        </p>
        {target.detail !== null && <p className="why" data-find={fieldId(card.key, `detail ${index}`)}>{target.detail}</p>}
        {target.instructions !== null && <p className="why" data-find={fieldId(card.key, `instructions ${index}`)}>{target.instructions}</p>}
        {target.url !== null && <p className="why"><a href={target.url} target="_blank" rel="noreferrer">Open sign-in page</a></p>}
        {target.open && target.fields.map(field => (
          <label key={field.name} className="field">
            <span>{field.label}</span>
            <input name={field.name} type={field.masked ? 'password' : 'text'} autoComplete="off" required={field.required} defaultValue={field.initial} disabled={busy} />
          </label>
        ))}
        {target.open && (
          <div className="choices">
            <button type="submit" className="primary" disabled={busy}>{sending && card.busy === 'sending' ? SENDING : 'Connect'}</button>
            <button type="button" disabled={busy} onClick={() => onRespond('skipped')}>Skip</button>
          </div>
        )}
      </form>
    </li>
  )
}

const THE_REST = Symbol('the rest')

function ConnectCard({ card, onAnswer }: CardProps<Connect>) {
  const [sent, setSent] = useState<string | typeof THE_REST | null>(null)
  const answer = (reply: RequestReply, by: string | typeof THE_REST) => {
    setSent(by)
    onAnswer(card.requestId, reply)
  }
  return (
    <Frame card={card}>
      <Waits card={card} />
      <ul className="targets">
        {card.targets.map((target, index) => (
          <Target
            key={target.name} card={card} target={target} index={index} sending={sent === target.name}
            onRespond={(as, values) => answer({ kind: 'connect', target: target.name, as, ...(values === undefined ? {} : { values }) }, target.name)}
          />
        ))}
      </ul>
      <div className="choices">
        <button type="button" disabled={card.busy !== null} onClick={() => answer({ kind: 'skip' }, THE_REST)}>
          {sent === THE_REST && card.busy === 'sending' ? SENDING : 'Continue without the rest'}
        </button>
      </div>
    </Frame>
  )
}

export function AskCard({ card, changing, onChange, onAnswer }: CardProps<Card> & Changes) {
  switch (card.kind) {
    case 'secret':
      return <SecretCard card={card} onAnswer={onAnswer} />
    case 'questions':
      return <QuestionsCard card={card} changing={changing} onChange={onChange} onAnswer={onAnswer} />
    case 'connect':
      return <ConnectCard card={card} onAnswer={onAnswer} />
  }
}
