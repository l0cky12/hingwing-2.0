import type { Answer, Asked, ConnectTarget, HermesRequest, RequestEnd, RequestId, SecretFor } from '@highwing/hermes/domain'
import { timeOfDay, type ViewClock } from './when'

export type AskCard = SecretCard | QuestionsCard | ConnectCard

interface CardBase {
  readonly key: string
  readonly requestId: RequestId
  readonly heading: string
  /** When Hermes stops waiting: "Hermes waits until 14:07." null when Hermes named no limit. */
  readonly waits: string | null
  /** `sending`: an answer is on its way. `offline`: the link is down, so no answer can be sent. */
  readonly busy: 'sending' | 'offline' | null
  /** The last answer did not reach Hermes. */
  readonly error: string | null
}

export interface SecretCard extends CardBase {
  readonly kind: 'secret'
  /** The sudo command, redacted by Hermes. */
  readonly command: string | null
  readonly why: string | null
  readonly name: string | null
  readonly fields: readonly SecretField[]
  readonly send: string
  readonly skip: string
}

export interface SecretField {
  readonly part: 'value' | 'identifier'
  readonly label: string
  readonly masked: boolean
}

export interface QuestionsCard extends CardBase {
  readonly kind: 'questions'
  /** "1 of 2 answered". null for one question. */
  readonly progress: string | null
  readonly questions: readonly QuestionView[]
}

export interface QuestionView {
  readonly id: string
  readonly text: string
  /** As Hermes sent them. Empty: a typed answer only. */
  readonly choices: readonly string[]
  readonly multi: boolean
  /** What Hermes has locked for it. null: not answered yet. */
  readonly locked: { readonly answer: Answer; readonly words: string } | null
}

export interface ConnectCard extends CardBase {
  readonly kind: 'connect'
  readonly targets: readonly TargetView[]
}

export interface TargetView {
  readonly name: string
  readonly heading: string
  readonly state: string
  /** Still needs the user: it can be connected or skipped. */
  readonly open: boolean
  readonly detail: string | null
  readonly instructions: string | null
  readonly url: string | null
  readonly fields: readonly { readonly name: string; readonly label: string; readonly required: boolean; readonly masked: boolean; readonly initial: string }[]
}

const value = (label: string, masked = true): SecretField => ({ part: 'value', label, masked })

const SECRET_FORMS = {
  sudo: { fields: [value('Password')], send: 'Send', skip: 'Skip' },
  env: { fields: [value('Secret value')], send: 'Send', skip: 'Skip' },
  vault: { fields: [value('Master password')], send: 'Unlock', skip: 'Keep locked' },
  login: { fields: [{ part: 'identifier', label: 'Email or username', masked: false }, value('Password')], send: 'Save and sign in', skip: "Don't save" },
  code: { fields: [value('Code', false)], send: 'Enter code', skip: 'Skip' }
} as const satisfies Record<SecretFor['is'], Pick<SecretCard, 'fields' | 'send' | 'skip'>>

function secretWords(secret: SecretFor): Pick<SecretCard, 'heading' | 'why'> {
  switch (secret.is) {
    case 'sudo':
      return { heading: 'Hermes needs your sudo password', why: null }
    case 'env':
      return { heading: 'Hermes needs a secret', why: secret.prompt }
    case 'vault':
      return { heading: `Unlock ${secret.name}`, why: null }
    case 'login':
      return { heading: `Save your ${secret.site} login?`, why: `Hermes is on the sign-in page at ${secret.origin}.` }
    case 'code':
      return { heading: secret.site === null ? 'Verification code' : `Verification code for ${secret.site}`, why: secret.hint }
  }
}

const CLOSED_WORDS = {
  sudo: { answered: 'You sent a password.', skipped: 'You skipped this.' },
  env: { answered: 'You sent the secret.', skipped: 'You skipped this.' },
  vault: { answered: 'You unlocked the vault.', skipped: 'You kept the vault locked.' },
  login: { answered: 'You saved the login.', skipped: "You didn't save the login." },
  code: { answered: 'You entered the code.', skipped: 'You skipped the code.' },
  questions: { answered: 'You answered.', skipped: 'You stopped answering.' },
  connect: { answered: 'Hermes went on with what is connected.', skipped: 'Hermes went on with what is connected.' }
} as const satisfies Record<Asked, Record<'answered' | 'skipped', string>>

const END_WORDS = {
  answered: null,
  skipped: null,
  elsewhere: 'Answered from another window.',
  done: null,
  timeout: 'Nobody answered in time, so Hermes stopped waiting.',
  interrupted: 'Hermes withdrew this request.',
  withdrawn: 'Hermes withdrew this request.'
} as const satisfies Record<RequestEnd, string | null>

export function closedWords(asked: Asked, end: RequestEnd): string {
  const own = CLOSED_WORDS[asked]
  return END_WORDS[end] ?? (end === 'skipped' ? own.skipped : own.answered)
}

const TARGET_STATES = {
  pending: 'Waiting',
  started: 'Waiting',
  connected: 'Connected',
  skipped: 'Skipped',
  failed: 'Failed',
  expired: 'Expired',
  'not-connected': 'Not connected'
} as const satisfies Record<ConnectTarget['state'], string>

const answerWords = (answer: Answer) => (answer === null ? 'Skipped' : answer.join(', '))

export function askCard(request: HermesRequest, live: boolean, clock: ViewClock): AskCard {
  const { ask, state, deadline } = request
  const base = {
    key: `ask:${request.id}`,
    requestId: request.id,
    waits: deadline === null ? null : `Hermes waits until ${timeOfDay(deadline, clock.timeZone)}.`,
    busy: state.s === 'sending' ? 'sending' : live ? null : 'offline',
    error: state.s === 'waiting' ? state.error : null
  } as const
  switch (ask.kind) {
    case 'secret': {
      const { for: secret } = ask
      return {
        ...base,
        kind: 'secret',
        ...secretWords(secret),
        ...SECRET_FORMS[secret.is],
        command: secret.is === 'sudo' ? secret.command : null,
        name: secret.is === 'env' ? secret.name : null
      }
    }
    case 'questions': {
      const { questions, answers } = ask
      const locked = questions.filter(question => Object.hasOwn(answers, question.id)).length
      return {
        ...base,
        kind: 'questions',
        heading: questions.length === 1 ? 'Hermes has a question' : `Hermes has ${questions.length} questions`,
        progress: questions.length === 1 ? null : `${locked} of ${questions.length} answered`,
        questions: questions.map(question => {
          const answer = answers[question.id]
          return { ...question, locked: answer === undefined ? null : { answer, words: answerWords(answer) } }
        })
      }
    }
    case 'connect':
      return {
        ...base,
        kind: 'connect',
        heading: 'Hermes needs a connection to continue',
        targets: ask.targets.map(target => ({
          name: target.name,
          heading: `Sign in to ${target.name}`,
          state: TARGET_STATES[target.state],
          open: !target.resolved,
          detail: target.detail,
          instructions: target.instructions,
          url: target.url,
          fields: target.fields.map(field => ({ name: field.name, label: field.prompt ?? field.name, required: field.required, masked: field.secret, initial: field.initial }))
        }))
      }
  }
}

const BUSY_WORDS = { sending: '  (sending)', offline: '  (offline)' } as const

const indented = (lines: readonly (string | null)[], by = '    ') => lines.flatMap(line => (line === null ? [] : [`${by}${line}`]))

export function askLines(card: AskCard): string[] {
  const head = `◈ ${card.heading}${card.busy === null ? '' : BUSY_WORDS[card.busy]}`
  const error = indented([card.error === null ? null : `! ${card.error}`])
  switch (card.kind) {
    case 'secret':
      return [
        head,
        ...indented([card.command, card.why, card.name, card.waits]),
        `    ${card.fields.map(field => `(${field.label})`).join(' ')} [${card.skip}] [${card.send}]`,
        ...error
      ]
    case 'questions':
      return [
        head,
        ...indented([card.progress, card.waits]),
        ...card.questions.map(question => (question.locked === null
          ? `    ? ${question.text}  ${question.choices.map(choice => `[${choice}]`).join(' ')}${question.multi ? ' (any)' : ''}`.trimEnd()
          : `    ✓ ${question.text}  ${question.locked.words}`)),
        ...error
      ]
    case 'connect':
      return [
        head,
        ...indented([card.waits]),
        ...card.targets.flatMap(target => [
          `    ${target.heading}  ${target.state}`,
          ...indented([target.detail, target.instructions, target.url === null ? null : `↗ ${target.url}`], '      '),
          ...(target.open ? [`      ${target.fields.map(field => `(${field.label}) `).join('')}[Connect] [Skip]`] : [])
        ]),
        '    [Continue without the rest]',
        ...error
      ]
  }
}
