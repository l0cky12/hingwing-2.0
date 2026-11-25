import type { Answer } from '@highwing/hermes/domain'
import type { QuestionsCard, QuestionView } from '@highwing/thread'

export interface Draft {
  readonly picks: readonly string[]
  readonly other: string | null
}

export const OTHER = Symbol('other')

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

export function answerOf(draft: Draft): Exclude<Answer, null> | null {
  const typed = draft.other?.trim() ?? ''
  const answer = [...draft.picks, ...(typed === '' ? [] : [typed])]
  return answer.length === 0 ? null : answer
}

export function sendWords(card: QuestionsCard, open: QuestionView): string {
  const last = card.questions.every(question => question.id === open.id || question.locked !== null)
  if (!last) return 'Next'
  return card.questions.length === 1 ? 'Send answer' : 'Send answers'
}
