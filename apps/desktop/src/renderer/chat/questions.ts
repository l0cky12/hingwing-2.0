import type { Answer } from '@highwing/hermes/domain'
import type { QuestionsCard, QuestionView } from '@highwing/thread'

/** What is picked on the open question before it is sent. `other` is the typed line, null while "Other" is not chosen. */
export interface Draft {
  readonly picks: readonly string[]
  readonly other: string | null
}

export const OTHER = Symbol('other')

/** The question shown: the one being changed, else the first not yet answered. */
export const openQuestion = (card: QuestionsCard, changing: string | null): QuestionView | undefined =>
  card.questions.find(question => question.id === changing && question.locked !== null) ?? card.questions.find(question => question.locked === null)

/** A fresh question starts empty. A question being changed starts from its locked answer. */
export function draftOf(question: QuestionView): Draft {
  const answer = question.locked?.answer ?? null
  if (answer === null) return { picks: [], other: question.choices.length === 0 ? '' : null }
  const typed = answer.find(pick => !question.choices.includes(pick))
  return { picks: answer.filter(pick => question.choices.includes(pick)), other: typed ?? (question.choices.length === 0 ? '' : null) }
}

export function picked(question: QuestionView, draft: Draft, choice: string | typeof OTHER, on: boolean): Draft {
  if (!question.multi) return choice === OTHER ? { picks: [], other: draft.other ?? '' } : { picks: [choice], other: null }
  if (choice === OTHER) return { ...draft, other: on ? (draft.other ?? '') : null }
  return { ...draft, picks: on ? question.choices.filter(label => label === choice || draft.picks.includes(label)) : draft.picks.filter(label => label !== choice) }
}

/** The answer the open question's button sends. null: nothing is picked or typed yet. */
export function answerOf(draft: Draft): Exclude<Answer, null> | null {
  const typed = draft.other?.trim() ?? ''
  const answer = [...draft.picks, ...(typed === '' ? [] : [typed])]
  return answer.length === 0 ? null : answer
}

/** The last open question's answer submits the batch, so its button says so, and the window holds that answer until it is pressed. */
export function sendWords(card: QuestionsCard, open: QuestionView): string {
  const last = card.questions.every(question => question.id === open.id || question.locked !== null)
  if (!last) return 'Next'
  return card.questions.length === 1 ? 'Send answer' : 'Send answers'
}
