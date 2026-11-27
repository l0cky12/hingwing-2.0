import type { Reaction, TurnId } from '@highwing/hermes/domain'
import type { TurnView } from '@highwing/thread'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NONE_OPEN } from '../src/renderer/chat/open'
import { Given } from '../src/renderer/chat/Reactions'
import { Turn } from '../src/renderer/chat/Thread'

type Props = Parameters<typeof Turn>[0]

const TURN = 'run:1' as TurnId
const turn = (reactions: TurnView['reactions']): TurnView => ({ key: TURN, time: null, request: 'Check the servers', handed: false, attachments: [], rowId: 1, tokens: null, reactions, pages: [], nodes: [], end: { kind: 'done', words: 'Done' } })
const draw = (more: Partial<Props>) => renderToStaticMarkup((
  <Turn
    turn={turn({ turn: TURN, given: [] })} open={NONE_OPEN} onToggle={() => {}} onAnswer={async () => undefined} onAskAgain={async () => false} canEdit canBranch showsRegenerate={false} canRegenerate={false}
    onEdit={() => {}} onRegenerate={() => {}} onBranch={() => {}} onNewChat={() => {}} versions={[]} onVersion={() => {}} canReact onReact={() => {}} helpers={null} {...more}
  />
))
const BOTH: readonly Reaction[] = [{ emoji: '👍', by: 'user' }, { emoji: '❓', by: 'agent' }]

function press(node: ReactNode, name: string): void {
  if (Array.isArray(node)) return node.forEach(child => press(child, name))
  if (!isValidElement(node)) return
  const { type, props } = node as ReactElement<{ children?: ReactNode; 'aria-label'?: string; onClick?: () => void }>
  if (type === 'button' && props['aria-label'] === name) props.onClick?.()
  press(props.children, name)
}

describe('reactions on a reply', () => {
  it('offers a React button that opens a picker on a turn whose answer is stored, and none on one whose answer is not', () => {
    expect(draw({})).toMatch(/<div class="turn-actions"><span class="acts"><div class="react"><button[^>]*aria-label="React"[^>]*aria-haspopup="dialog" aria-expanded="false">/)
    expect(draw({ turn: turn(null) })).not.toContain('React')
  })

  it('cannot be pressed while the chat is not live', () => {
    expect(draw({ canReact: false })).toMatch(/<button[^>]*aria-label="React"[^>]*aria-haspopup="dialog"[^>]*disabled=""/)
  })

  it('shows each reaction given as a chip under the reply, yours a button and Hermes\'s not', () => {
    const markup = draw({ turn: turn({ turn: TURN, given: BOTH }) })
    expect(markup).toMatch(/<button type="button" class="reaction" aria-label="Remove your 👍">👍<\/button>/)
    expect(markup).toMatch(/<span class="reaction" role="img" aria-label="Hermes reacted ❓">❓<\/span>/)
    expect(markup.indexOf('Remove your 👍')).toBeLessThan(markup.indexOf('aria-label="React"'))
  })

  it('takes your reaction off when you press your chip, and Hermes\'s chip does nothing', () => {
    const asked: (string | null)[] = []
    const chips = Given({ given: BOTH, disabled: false, onReact: emoji => asked.push(emoji) })
    press(chips, 'Hermes reacted ❓')
    expect(asked).toEqual([])
    press(chips, 'Remove your 👍')
    expect(asked).toEqual([null])
  })
})
