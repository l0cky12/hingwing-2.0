import type { SettledTurn } from './session'

/** A turn as a title reads it: its message and what was said in it. */
export type TitleTurn = Pick<SettledTurn, 'items'> & { readonly request: { readonly text: string } | null }

/** What `llm.oneshot` is asked to do with the lines `titleInput` makes. */
export const TITLE_INSTRUCTIONS =
  'Write a short title for this chat, 2 to 6 words, in sentence case. Reply with the title only: no quotes, no label and no period at the end.'

const TEXT_MOST = 600
const INPUT_MOST = 4000
const LATEST = 3
const TITLE_MOST = 80

const clipped = (text: string, most: number) => (text.length <= most ? text : `${text.slice(0, most - 1).trimEnd()}…`)
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The chat's first turn and its last three, as `User:` and `Assistant:` lines. Empty for a chat with no words in it. */
export function titleInput(history: readonly TitleTurn[]): string {
  const turns = history.length <= LATEST + 1 ? history : [history[0] as TitleTurn, ...history.slice(-LATEST)]
  const lines = turns.flatMap(turn => {
    const asked = oneLine(turn.request?.text ?? '')
    const answered = oneLine(turn.items.flatMap(item => (item.kind === 'text' ? [item.markdown] : [])).join(' '))
    return [
      ...(asked === '' ? [] : [`User: ${clipped(asked, TEXT_MOST)}`]),
      ...(answered === '' ? [] : [`Assistant: ${clipped(answered, TEXT_MOST)}`])
    ]
  })
  return clipped(lines.join('\n'), INPUT_MOST)
}

const PAIRS: readonly (readonly [string, string])[] = [['"', '"'], ["'", "'"], ['`', '`'], ['“', '”'], ['‘', '’'], ['«', '»'], ['**', '**'], ['*', '*']]

const STEPS: readonly ((title: string) => string)[] = [
  title => title.replace(/^(?:#+\s*|title\s*:\s*)/i, ''),
  title => {
    const pair = PAIRS.find(([open, close]) => title.length >= open.length + close.length && title.startsWith(open) && title.endsWith(close))
    return pair === undefined ? title : title.slice(pair[0].length, -pair[1].length)
  },
  title => title.replace(/(?<!\.)\.$/, ''),
  title => title.trim()
]

/** A model's reply as a chat title: its first line, unwrapped from quotes and a `Title:` label, with no closing period. null: nothing is left. */
export function cleanTitle(reply: string): string | null {
  let title = reply.split('\n').map(line => line.trim()).find(line => line !== '') ?? ''
  for (let before = ''; before !== title;) {
    before = title
    for (const step of STEPS) title = step(title)
  }
  title = title.slice(0, TITLE_MOST).trimEnd()
  return title === '' ? null : title
}
