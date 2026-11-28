import type { PromptId, TurnId } from '@highwing/hermes/domain'
import type { ThreadNode, TurnView } from '@highwing/thread'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NONE_OPEN } from '../src/renderer/chat/open'
import { Node, ReadOnlyContext, Turn } from '../src/renderer/chat/Thread'

type Props = Parameters<typeof Turn>[0]

const turn = (more: Partial<TurnView> = {}): TurnView => ({
  key: 't1', time: null, request: 'Summarize the mail', handed: false, attachments: [], rowId: 3, tokens: null, reactions: { turn: 'r1' as TurnId, given: [] }, pages: [],
  nodes: [{ kind: 'prose', key: 'p1', markdown: 'Three new messages.', streaming: false }], end: { kind: 'done', words: 'Done' }, ...more
})
const props = (more: Partial<Props> = {}): Props => ({
  turn: turn(), open: NONE_OPEN, onToggle: () => {}, onAnswer: async () => undefined, onAskAgain: async () => false, canEdit: true, showsRegenerate: true, canRegenerate: true,
  canBranch: true, onEdit: () => {}, onRegenerate: () => {}, onReply: () => {}, onBranch: () => {}, onNewChat: () => {}, versions: [], onVersion: () => {}, canReact: true, onReact: () => {}, helpers: null, showWork: 'all', readOnly: false, ...more
})
const draw = (readOnly: boolean, more: Partial<Props> = {}) => renderToStaticMarkup(<Turn {...props({ ...more, readOnly })} />)

const WRITES = ['Reply', 'Edit message', 'Regenerate', 'More actions', 'React']

describe("a routine's past run in the thread", () => {
  it('offers the actions that write in a chat that takes messages, as the control', () => {
    const markup = draw(false)
    for (const name of WRITES) expect(markup, name).toContain(`aria-label="${name}`)
  })

  it('offers Copy on what was asked and what was answered, and no action that would write', () => {
    const markup = draw(true)
    expect(markup).toContain('aria-label="Copy request"')
    expect(markup).toContain('aria-label="Copy reply"')
    for (const name of WRITES) expect(markup, name).not.toContain(`aria-label="${name}`)
  })

  it('shows no way to start a new chat from a message the job refused', () => {
    const refused = turn({ end: { kind: 'failed', words: 'This chat runs a scheduled job, so your message was not run.', remedy: 'newChat' } })
    expect(draw(false, { turn: refused })).toContain('Start a new chat')
    expect(draw(true, { turn: refused })).not.toContain('Start a new chat')
  })
})

describe("a question in a routine's past run", () => {
  const asking: ThreadNode = {
    kind: 'prompt', key: 't1/3',
    card: { state: 'asking', promptId: 'p1' as PromptId, heading: 'Hermes has a question', command: null, why: 'Where should it go?', pick: { kind: 'many', choices: ['staging'] }, tell: false, busy: false, error: null, left: null }
  }
  const draw = (readOnly: boolean) => renderToStaticMarkup(
    <ReadOnlyContext value={readOnly}><Node node={asking} endTone="asking" elapsed={null} open={NONE_OPEN} onToggle={() => {}} onAnswer={async () => undefined} onAskAgain={null} helpers={null} /></ReadOnlyContext>
  )

  it('shows what was asked with no control to answer it', () => {
    expect(draw(false)).toContain('type="checkbox"')
    const markup = draw(true)
    expect(markup).toContain('Hermes has a question')
    expect(markup).toContain('Where should it go?')
    expect(markup).not.toMatch(/<(input|button)/)
  })
})
