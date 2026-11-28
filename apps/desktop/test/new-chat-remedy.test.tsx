import type { BotId } from '@highwing/hermes/domain'
import type { ThreadEnd, TurnView } from '@highwing/thread'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Draft } from '../src/ipc-contract'
import { NONE_OPEN } from '../src/renderer/chat/open'
import { Turn } from '../src/renderer/chat/Thread'
import type {} from '../src/renderer/store'

type Props = Parameters<typeof Turn>[0]

const MESSAGE = 'Check the backups ran'
const WORDS = 'This chat runs a scheduled job, so your message was not run. Start a new chat to send it.'
const REFUSED: ThreadEnd = { kind: 'failed', words: WORDS, remedy: 'newChat' }
const turn = (end: ThreadEnd, request: string | null = MESSAGE): TurnView =>
  ({ key: 't1', time: null, request, handed: false, attachments: [], rowId: null, tokens: null, reactions: null, pages: [], nodes: [], end })
const props = (more: Partial<Props>): Props => ({
  turn: turn(REFUSED), open: NONE_OPEN, onToggle: () => {}, onAnswer: async () => undefined, onAskAgain: async () => false, canEdit: true, showsRegenerate: false, canRegenerate: false,
  canBranch: true, onEdit: () => {}, onRegenerate: () => {}, onBranch: () => {}, onNewChat: () => {}, versions: [], onVersion: () => {}, canReact: false, onReact: () => {}, helpers: null, showWork: 'all', ...more
})
const draw = (more: Partial<Props>) => renderToStaticMarkup(<Turn {...props(more)} />)

function buttonSaying(node: ReactNode, words: string): ReactElement<{ onClick?: () => void }> | null {
  if (Array.isArray(node)) return node.map(child => buttonSaying(child, words)).find(found => found !== null) ?? null
  if (!isValidElement(node)) return null
  const { type, props: held } = node as ReactElement<{ children?: ReactNode }>
  if (type === 'button' && held.children === words) return node as ReactElement<{ onClick?: () => void }>
  return buttonSaying(held.children, words)
}

describe('the Start a new chat button', () => {
  it('follows a message a scheduled job refused', () => {
    expect(draw({})).toMatch(/<div class="turn-actions"><button type="button"[^>]*>Start a new chat<\/button><\/div>/)
  })

  it.each([
    ['a failure with no way forward', turn({ kind: 'failed', words: 'The model provider had an error. Try again.', remedy: null })],
    ['a turn that finished', turn({ kind: 'done', words: 'Done' })],
    ['a refusal with no message to carry', turn(REFUSED, null)]
  ])('is not offered after %s', (_what, shown) => {
    expect(draw({ turn: shown })).not.toContain('>Start a new chat</button>')
  })

  it("hands over the refused message's text", () => {
    const asked: string[] = []
    const rendered = (Turn as unknown as { type: (props: Props) => ReactNode }).type(props({ onNewChat: text => asked.push(text) }))
    buttonSaying(rendered, 'Start a new chat')?.props.onClick?.()
    expect(asked).toEqual([MESSAGE])
  })
})

describe("a refused message carried to a new chat's draft", () => {
  const BOT = 'research' as BotId

  async function loaded(saved: readonly Draft[]) {
    vi.resetModules()
    const kept: Draft[] = []
    vi.stubGlobal('window', { addEventListener: () => {}, highwing: { drafts: async () => saved, keepDraft: (draft: Draft) => kept.push(draft) } })
    const store = await import('../src/renderer/composer/drafts')
    await store.startDrafts()
    return { store, kept }
  }

  afterEach(() => vi.unstubAllGlobals())

  it('is the whole draft when the new chat had none', async () => {
    const { store, kept } = await loaded([])
    store.carryToNewChat(BOT, MESSAGE)
    expect(kept).toEqual([{ key: 'new', bot: BOT, text: MESSAGE, attachments: [], quote: null }])
  })

  it('follows a blank line after the text the user left there', async () => {
    const { store, kept } = await loaded([{ key: 'new', bot: BOT, text: 'Draft the weekly note', attachments: [], quote: null } as unknown as Draft])
    store.carryToNewChat(BOT, MESSAGE)
    expect(kept).toEqual([{ key: 'new', bot: BOT, text: `Draft the weekly note\n\n${MESSAGE}`, attachments: [], quote: null }])
  })
})
