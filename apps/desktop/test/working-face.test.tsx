import type { Bot, BotId } from '@highwing/hermes/domain'
import type { ThreadView, TurnView } from '@highwing/thread'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ShowWork } from '../src/ipc-contract'
import { useDecodedPicture } from '../src/renderer/bots/Avatar'
import { ChatBotContext, Thread } from '../src/renderer/chat/Thread'

vi.mock('../src/renderer/bots/Avatar', async original => ({
  ...(await original<typeof import('../src/renderer/bots/Avatar')>()),
  useDecodedPicture: vi.fn((bot: Pick<Bot, 'picture'> | null) => (bot?.picture ? 'blob:rae-picture' : null))
}))

const BOT: Bot = { id: 'rae' as BotId, name: 'Rae', preview: '', description: '', tone: 'plum', picture: false, pinned: false, hidden: false }
const tip = { kind: 'tip', words: [], elapsed: null } as unknown as TurnView['end']
const turn = (nodes: TurnView['nodes']): TurnView =>
  ({ key: 't1', time: null, request: 'Hello', handed: false, attachments: [], rowId: 1, tokens: null, reactions: null, pages: [], nodes, end: tip })
const drawn = (view: TurnView, bot: Bot | null, showWork: ShowWork = 'all') => renderToStaticMarkup(
  <ChatBotContext value={bot}>
    <Thread
      view={{ state: 'ready', turns: [view], pending: [], asks: [], earlier: 'none', newestPages: new Map(), changesAt: null } as ThreadView} relays={[]} sides={[]} onAnswer={async () => undefined} onAskAgain={async () => false} onAnswerRequest={async () => false}
      onLoadEarlier={() => {}} onFindClosed={() => {}} onFindScrolled={() => {}} canEdit canRegenerate={false} regenerateTurnKey={null} canBranch onEdit={() => {}} onRegenerate={() => {}} onReply={() => {}}
      onBranch={() => {}} onNewChat={() => {}} versions={[]} onVersion={() => {}} queue={{ canAct: true, pressed: new Map(), onAct: () => {} }} canReact onReact={() => {}} helpers={null} showWork={showWork}
    />
  </ChatBotContext>
)
const NODE = { kind: 'status', key: 'n1', text: 'Partial reply' } as unknown as TurnView['nodes'][number]

describe('the end of a turn that has not started its reply', () => {
  it("shows the bot's working face where the glyph was, and keeps the words", () => {
    const markup = drawn(turn([]), BOT)
    expect(markup).toContain('data-end="tip"')
    expect(markup).toContain('data-mood="working"')
    expect(markup.match(/class="face-dot"/g)).toHaveLength(3)
    expect(markup).not.toContain('class="glyph"')
  })

  it('keeps the glyph once the reply has started', () => {
    const markup = drawn(turn([NODE]), BOT)
    expect(markup).toContain('class="glyph"')
    expect(markup).not.toContain('data-mood')
  })

  it('keeps the glyph when the chat has no bot', () => {
    const markup = drawn(turn([]), null)
    expect(markup).toContain('class="glyph"')
    expect(markup).not.toContain('data-mood')
  })
})

describe('the end of a running turn under Replies only', () => {
  it("shows the bot's face hopping after the reply has started", () => {
    const markup = drawn(turn([NODE]), BOT, 'replies')
    expect(markup).toContain('class="tip working pet"')
    expect(markup).toContain('data-mood="working"')
    expect(markup).not.toContain('class="glyph"')
  })

  it('shows a stand-in face when the chat has no bot', () => {
    const markup = drawn(turn([]), null, 'replies')
    expect(markup).toContain('class="tip working pet"')
    expect(markup).toContain('data-mood="working"')
  })

  it('leaves a finished turn its glyph', () => {
    const markup = drawn({ ...turn([NODE]), end: { kind: 'done', words: 'Done' } }, BOT, 'replies')
    expect(markup).toContain('class="glyph"')
    expect(markup).not.toContain('pet')
  })
})

describe('the end of a running turn under Replies only, for a bot with a picture', () => {
  const PICTURED: Bot = { ...BOT, picture: true }
  const working = (bot: Bot) => drawn({ ...turn([]), end: { kind: 'tip', words: [{ t: 'text', v: 'Working' }], elapsed: '4s' } }, bot, 'replies')

  it("shows the bot's own picture, and keeps the words for screen readers only", () => {
    const markup = drawn(turn([]), PICTURED, 'replies')
    expect(markup).toContain('class="tip working pet"')
    expect(markup).toMatch(/<img class="face pet-picture" src="blob:rae-picture"/)
    expect(markup).not.toContain('data-mood')
    expect(markup).toContain('><span class="sr"></span></div>')
    expect(working(PICTURED), 'the words are kept for screen readers, the elapsed time stays in view').toMatch(/<span class="sr">Working<\/span><span class="elapsed"><span class="sr">, <\/span>4s<\/span>/)
  })

  it("draws today's face for a bot with no picture, and its words in the open", () => {
    const markup = drawn(turn([]), BOT, 'replies')
    expect(markup).toContain('data-mood="working"')
    expect(markup).not.toContain('pet-picture')
    expect(markup).toContain('</span><span></span></div>')
    expect(working(BOT)).toContain('<span>Working</span>')
  })

  it("draws today's face until the whole picture has decoded", () => {
    vi.mocked(useDecodedPicture).mockReturnValueOnce(null)
    const markup = drawn(turn([]), PICTURED, 'replies')
    expect(markup).toContain('data-mood="working"')
    expect(markup).not.toContain('pet-picture')
  })

  it('draws no picture under Everything', () => {
    const markup = drawn(turn([]), PICTURED, 'all')
    expect(markup).toContain('data-mood="working"')
    expect(markup).not.toContain('pet-picture')
  })
})
