import type { TurnView } from '@highwing/thread'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NONE_OPEN } from '../src/renderer/chat/open'
import { Turn } from '../src/renderer/chat/Thread'

type Props = Parameters<typeof Turn>[0]

const turn = (rowId: number | null): TurnView => ({ key: 't1', time: null, request: 'Check the servers', attachments: [], rowId, tokens: null, reactions: null, nodes: [], end: { kind: 'done', words: 'Done' } })
const props = (more: Partial<Props>): Props => ({
  turn: turn(3), open: NONE_OPEN, onToggle: () => {}, onAnswer: async () => undefined, canEdit: true, showsRegenerate: false, canRegenerate: false,
  canBranch: true, onEdit: () => {}, onRegenerate: () => {}, onBranch: () => {}, versions: [], onVersion: () => {}, canReact: true, onReact: () => {}, ...more
})
const draw = (more: Partial<Props>) => renderToStaticMarkup(<Turn {...props(more)} />)

function buttonNamed(node: ReactNode, name: string): ReactElement<{ onClick?: () => void; disabled?: boolean }> | null {
  if (Array.isArray(node)) return node.map(child => buttonNamed(child, name)).find(found => found !== null) ?? null
  if (!isValidElement(node)) return null
  const { type, props: held } = node as ReactElement<{ children?: ReactNode; 'aria-label'?: string }>
  if (type === 'button' && held['aria-label'] === name) return node as ReactElement<{ onClick?: () => void; disabled?: boolean }>
  return buttonNamed(held.children, name)
}

describe('the Branch from here button', () => {
  it('sits on a message that has a stored row, beside Edit message', () => {
    const markup = draw({})
    expect(markup).toMatch(/<button[^>]*aria-label="Branch from here"(?![^>]*disabled)[^>]*>/)
    expect(markup.indexOf('aria-label="Edit message"')).toBeLessThan(markup.indexOf('aria-label="Branch from here"'))
  })

  it('is not there for a message Hermes has not named a row for', () => {
    expect(draw({ turn: turn(null) })).not.toContain('Branch from here')
  })

  it('is disabled while a branch cannot start, though Edit message is not its business', () => {
    const markup = draw({ canBranch: false })
    expect(markup).toMatch(/<button[^>]*aria-label="Branch from here"[^>]*disabled/)
    expect(markup).toMatch(/<button[^>]*aria-label="Edit message"(?![^>]*disabled)[^>]*>/)
  })

  it('asks to branch from the message by its stored row', () => {
    const asked: number[] = []
    const rendered = (Turn as unknown as { type: (props: Props) => ReactNode }).type(props({ onBranch: rowId => asked.push(rowId) }))
    buttonNamed(rendered, 'Branch from here')?.props.onClick?.()
    expect(asked).toEqual([3])
  })
})
