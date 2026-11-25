import { leafText, parseMarkdown, proseLeaves } from './prose'
import type { Phrase, StepView, ThreadView } from './thread-view'

export type FieldPart =
  | 'request' | 'title' | 'heading' | 'command' | 'why' | 'name' | 'waits' | 'progress' | 'error' | 'words' | 'text' | 'detail' | 'end'
  | `block ${number}` | `path ${number}` | `line ${number} ${number}` | `body ${number}` | `label ${number}`
  | `question ${number}` | `answer ${number}` | `target ${number}` | `detail ${number}` | `instructions ${number}`

export const fieldId = (key: string, part: FieldPart) => `${key} ${part}`

export interface FindMatch {
  readonly field: string
  /** UTF-16 offsets into that field's text. */
  readonly start: number
  readonly end: number
  readonly opens: readonly string[]
}

interface Field { readonly id: string; readonly text: string; readonly opens: readonly string[] }

const joined = (words: Phrase) => words.map(piece => piece.v).join('')

function fields(view: ThreadView): Field[] {
  const out: Field[] = []
  const add = (key: string, part: FieldPart, text: string, opens: readonly string[] = []) => out.push({ id: fieldId(key, part), text, opens })

  const stepFields = (step: StepView, group: string | null) => {
    add(step.key, 'title', joined(step.title), group === null ? [] : [group])
    const opens = group === null ? [step.key] : [step.key, group]
    step.record?.sections.forEach((section, index) => {
      if (section.kind === 'changes') {
        add(step.key, `path ${index}`, section.path, opens)
        section.lines.forEach((line, at) => add(step.key, `line ${index} ${at}`, line.text, opens))
      } else if ('text' in section.body) {
        add(step.key, `body ${index}`, section.body.text, opens)
      }
    })
  }

  for (const turn of view.turns) {
    if (turn.request !== null) add(turn.key, 'request', turn.request)
    for (const node of turn.nodes) {
      switch (node.kind) {
        case 'prose':
          proseLeaves(parseMarkdown(node.markdown)).forEach((leaf, index) => add(node.key, `block ${index}`, leafText(leaf)))
          break
        case 'step':
          stepFields(node.step, null)
          break
        case 'group':
          add(node.key, 'title', joined(node.title))
          for (const step of node.steps) stepFields(step, node.key)
          break
        case 'prompt': {
          const { card } = node
          if (card.state === 'answered') {
            add(node.key, 'words', card.words)
            if (card.command !== null) add(node.key, 'command', card.command)
          } else {
            add(node.key, 'heading', card.heading)
            if (card.command !== null) add(node.key, 'command', card.command)
            if (card.why !== null) add(node.key, 'why', card.why)
            if (card.error !== null) add(node.key, 'error', card.error)
          }
          break
        }
        case 'notice':
          add(node.key, 'text', node.text)
          if (node.detail !== null) add(node.key, 'detail', node.detail, [node.key])
          break
        case 'status':
        case 'steer':
          add(node.key, 'text', node.text)
          break
        case 'moa':
          add(node.key, 'title', node.title)
          if (node.meta !== null) add(node.key, 'words', node.meta)
          node.references.forEach(({ label, text }, index) => {
            add(node.key, `label ${index}`, label, [node.key])
            add(node.key, `body ${index}`, text, [node.key])
          })
          break
        case 'closed':
          add(node.key, 'words', node.words)
          break
        case 'reasoning':
          add(node.key, 'text', node.text, [node.key])
          break
        case 'helper': {
          const { helper } = node
          add(node.key, 'title', helper.goal)
          for (const step of helper.steps) add(step.key, 'title', step.kind === 'step' ? joined(step.title) : step.goal, [node.key])
          if (helper.summary !== null) add(node.key, 'detail', helper.summary, [node.key])
          break
        }
        case 'plan':
          for (const entry of node.plan.entries) add(entry.key, 'text', entry.text, [node.key])
          break
      }
    }
    const { end } = turn
    if (end.kind === 'paused' || end.kind === 'failed' || end.kind === 'stopped' || end.kind === 'lost') add(turn.key, 'end', end.words)
  }
  for (const card of view.asks) {
    add(card.key, 'heading', card.heading)
    switch (card.kind) {
      case 'secret':
        if (card.command !== null) add(card.key, 'command', card.command)
        if (card.why !== null) add(card.key, 'why', card.why)
        if (card.name !== null) add(card.key, 'name', card.name)
        break
      case 'questions': {
        if (card.progress !== null) add(card.key, 'progress', card.progress)
        // Only the answered questions and the first open one are drawn.
        const shown = card.questions.findIndex(question => question.locked === null)
        card.questions.forEach((question, index) => {
          if (question.locked === null && index !== shown) return
          add(card.key, `question ${index}`, question.text)
          if (question.locked !== null) add(card.key, `answer ${index}`, question.locked.words)
        })
        break
      }
      case 'connect':
        card.targets.forEach((target, index) => {
          add(card.key, `target ${index}`, target.heading)
          if (target.detail !== null) add(card.key, `detail ${index}`, target.detail)
          if (target.instructions !== null) add(card.key, `instructions ${index}`, target.instructions)
        })
        break
    }
    if (card.waits !== null) add(card.key, 'waits', card.waits)
    if (card.error !== null) add(card.key, 'error', card.error)
  }
  for (const message of view.pending) {
    add(message.key, 'text', message.text)
    if (message.status === 'failed') add(message.key, 'detail', message.detail)
  }
  return out
}

const escaped = (query: string) => query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function findInThread(view: ThreadView, query: string): readonly FindMatch[] {
  if (query === '') return []
  const pattern = new RegExp(escaped(query), 'giu')
  return fields(view).flatMap(field =>
    Array.from(field.text.matchAll(pattern), match => ({ field: field.id, start: match.index, end: match.index + match[0].length, opens: field.opens })))
}
