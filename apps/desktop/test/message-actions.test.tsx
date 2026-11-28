import type { TurnId } from '@highwing/hermes/domain'
import type { ThreadNode, TurnView } from '@highwing/thread'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Quote } from '../src/ipc-contract'
import { MessageActions, type MessageActs } from '../src/renderer/chat/MessageActions'
import { NONE_OPEN } from '../src/renderer/chat/open'
import { Turn } from '../src/renderer/chat/Thread'

type Props = Parameters<typeof Turn>[0]

const TURN = 'run:1' as TurnId
const prose = (key: string, markdown: string): ThreadNode => ({ kind: 'prose', key, markdown, streaming: false })
const turn = (nodes: readonly ThreadNode[]): TurnView => ({
  key: 't1', time: null, request: 'List the folder', handed: false, attachments: [], rowId: 5, tokens: null, reactions: { turn: TURN, given: [] }, pages: [], nodes, end: { kind: 'done', words: 'Done' }
})
const props = (more: Partial<Props>): Props => ({
  turn: turn([prose('p1', 'The folder holds two files.'), prose('p2', 'Both are notes.')]), open: NONE_OPEN, onToggle: () => {}, onAnswer: async () => undefined, onAskAgain: async () => false,
  canEdit: true, canBranch: true, showsRegenerate: true, canRegenerate: true, onEdit: () => {}, onRegenerate: () => {}, onReply: () => {}, onBranch: () => {}, onNewChat: () => {},
  versions: [], onVersion: () => {}, canReact: true, onReact: () => {}, helpers: null, showWork: 'all', ...more
})
const draw = (more: Partial<Props>) => renderToStaticMarkup(<Turn {...props(more)} />)

function actsIn(node: ReactNode): MessageActs[] {
  if (Array.isArray(node)) return node.flatMap(actsIn)
  if (!isValidElement(node)) return []
  const { type, props: held } = node as ReactElement<{ children?: ReactNode; acts?: MessageActs }>
  return type === MessageActions && held.acts !== undefined ? [held.acts] : actsIn(held.children)
}
const rows = (markup: string) => [...markup.matchAll(/<span class="acts">(.*?)<\/span>(?=<\/span>|<\/div>)/g)].map(([, row]) => [...row!.matchAll(/aria-label="([^"]+)"/g)].map(([, name]) => name))

describe('one action row per message', () => {
  it('gives the request and the reply each one row, in the same order of actions', () => {
    expect(rows(draw({}))).toEqual([['Copy request', 'Reply', 'Edit message', 'More actions'], ['Copy reply', 'Reply', 'Regenerate', 'React']])
  })

  it('keeps that order for any set of actions a message has', () => {
    const run = () => {}
    const names = (markup: string) => [...markup.matchAll(/aria-label="([^"]+)"/g)].map(([, name]) => name)
    expect(names(renderToStaticMarkup(<MessageActions acts={{ branch: { disabled: false, run }, regenerate: { disabled: false, run }, edit: { disabled: false, run }, reply: { disabled: false, run }, copy: { text: 'x', name: 'Copy reply' } }} />)))
      .toEqual(['Copy reply', 'Reply', 'Edit message', 'Regenerate', 'More actions'])
  })

  it('copies the whole reply once its turn has ended, and offers no copy while the turn runs, waits on you or is paused by a dropped link', () => {
    const rendered = (Turn as unknown as { type: (props: Props) => ReactNode }).type(props({}))
    expect(actsIn(rendered).map(acts => acts.copy?.text)).toEqual(['List the folder', 'The folder holds two files.\n\nBoth are notes.'])
    expect(draw({}).match(/aria-label="Copy reply"/g)).toHaveLength(1)
    const running = (end: TurnView['end']) => ({ ...turn([prose('p1', 'The folder holds two files.')]), end })
    expect(draw({ turn: running({ kind: 'tip', words: [], elapsed: null }) })).not.toContain('Copy reply')
    expect(draw({ turn: running({ kind: 'at', nodeKey: 'p1', tone: 'asking' }) })).not.toContain('Copy reply')
    expect(draw({ turn: running({ kind: 'paused', words: 'Paused' }) })).not.toContain('Copy reply')
  })

  it('quotes your message as yours and the reply as Hermes\'s, the same text Copy takes, and offers Reply only where Copy shows', () => {
    const quoted: Quote[] = []
    const rendered = (Turn as unknown as { type: (props: Props) => ReactNode }).type(props({ onReply: quote => quoted.push(quote) }))
    for (const acts of actsIn(rendered)) acts.reply?.run()
    expect(quoted).toEqual([{ from: 'you', text: 'List the folder' }, { from: 'hermes', text: 'The folder holds two files.\n\nBoth are notes.' }])
    const running = { ...turn([prose('p1', 'The folder holds two files.')]), end: { kind: 'tip', words: [], elapsed: null } } as const
    expect(rows(draw({ turn: running }))).toEqual([['Copy request', 'Reply', 'Edit message', 'More actions'], ['Regenerate', 'React']])
  })

  it('quotes only the words of a request that itself replies to something', () => {
    const quoted: Quote[] = []
    const reply = { ...turn([]), request: '[Replying to your previous message: "Both are notes."]\n\nWhich is newer?' }
    const rendered = (Turn as unknown as { type: (props: Props) => ReactNode }).type(props({ turn: reply, onReply: quote => quoted.push(quote) }))
    for (const acts of actsIn(rendered)) acts.reply?.run()
    expect(quoted).toEqual([{ from: 'you', text: 'Which is newer?' }])
  })

  it('draws no row for a message with no actions', () => {
    expect(renderToStaticMarkup(<MessageActions acts={{}} />)).toBe('')
  })
})

describe('a request that replies to a message', () => {
  const message = '[Replying to your previous message: "Both are notes."]\n\nWhich is newer?'

  it('shows the quote above its words, and find still counts the whole stored text', () => {
    const markup = draw({ turn: { ...turn([]), request: message } })
    expect(markup).toContain('<span class="quoted" data-find-text="[Replying to your previous message: &quot;Both are notes.&quot;]\n\n">Both are notes.</span>Which is newer?<span class="actions">')
  })

  it('copies the whole stored text', () => {
    const rendered = (Turn as unknown as { type: (props: Props) => ReactNode }).type(props({ turn: { ...turn([]), request: message } }))
    expect(actsIn(rendered)[0]?.copy?.text).toBe(message)
  })

  it('shows a request with no quote as it was typed', () => {
    expect(draw({})).toContain('data-find="t1 request">List the folder<span class="actions">')
  })
})
