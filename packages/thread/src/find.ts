import { leafText, parseMarkdown, proseLeaves } from './prose'
import type { Phrase, StepView, ThreadView } from './thread-view'

export type FieldPart =
  | 'request' | 'title' | 'heading' | 'command' | 'why' | 'error' | 'words' | 'text' | 'detail' | 'end'
  | `block ${number}` | `path ${number}` | `line ${number} ${number}` | `body ${number}`

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
          break
      }
    }
    const { end } = turn
    if (end.kind === 'paused' || end.kind === 'failed' || end.kind === 'stopped' || end.kind === 'lost') add(turn.key, 'end', end.words)
  }
  for (const message of view.pending) {
    add(message.key, 'text', message.text)
    if (message.detail !== null) add(message.key, 'detail', message.detail)
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
