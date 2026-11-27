import type { TurnView } from '@highwing/thread'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MessageActions, type MessageActs } from '../src/renderer/chat/MessageActions'
import { NONE_OPEN } from '../src/renderer/chat/open'
import { Turn } from '../src/renderer/chat/Thread'

type Props = Parameters<typeof Turn>[0]

const turn = (rowId: number | null): TurnView => ({ key: 't1', time: null, request: 'Check the servers', handed: false, attachments: [], rowId, tokens: null, reactions: null, pages: [], nodes: [], end: { kind: 'done', words: 'Done' } })
const props = (more: Partial<Props>): Props => ({
  turn: turn(3), open: NONE_OPEN, onToggle: () => {}, onAnswer: async () => undefined, onAskAgain: async () => false, canEdit: true, showsRegenerate: false, canRegenerate: false,
  canBranch: true, onEdit: () => {}, onRegenerate: () => {}, onBranch: () => {}, onNewChat: () => {}, versions: [], onVersion: () => {}, canReact: true, onReact: () => {}, helpers: null, ...more
})
const draw = (more: Partial<Props>) => renderToStaticMarkup(<Turn {...props(more)} />)

function requestActs(node: ReactNode): MessageActs | null {
  if (Array.isArray(node)) return node.map(requestActs).find(found => found !== null) ?? null
  if (!isValidElement(node)) return null
  const { type, props: held } = node as ReactElement<{ children?: ReactNode; acts?: MessageActs }>
  if (type === MessageActions && held.acts !== undefined) return held.acts
  return requestActs(held.children)
}

describe('Branch from here', () => {
  it('sits in the More menu of a message that has a stored row, after Edit message', () => {
    const markup = draw({})
    expect(markup).toMatch(/<button[^>]*aria-label="More actions"[^>]*aria-haspopup="menu"(?![^>]*disabled)[^>]*>/)
    expect(markup.indexOf('aria-label="Edit message"')).toBeLessThan(markup.indexOf('aria-label="More actions"'))
  })

  it('is not there for a message Hermes has not named a row for', () => {
    expect(draw({ turn: turn(null) })).not.toContain('More actions')
  })

  it('leaves More disabled while a branch cannot start, though Edit message is not its business', () => {
    const markup = draw({ canBranch: false })
    expect(markup).toMatch(/<button[^>]*aria-label="More actions"[^>]*disabled/)
    expect(markup).toMatch(/<button[^>]*aria-label="Edit message"(?![^>]*disabled)[^>]*>/)
  })

  it('asks to branch from the message by its stored row', () => {
    const asked: number[] = []
    const rendered = (Turn as unknown as { type: (props: Props) => ReactNode }).type(props({ onBranch: rowId => asked.push(rowId) }))
    requestActs(rendered)?.branch?.run()
    expect(asked).toEqual([3])
  })
})
