import type { AttachmentId, BotId, GroupId, SessionId } from '@highwing/hermes/domain'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Draft } from '../src/ipc-contract'
import type {} from '../src/renderer/store'

vi.mock('react', async actual => ({ ...(await actual<typeof import('react')>()), useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }))

const BOT = 'research' as BotId
const chat = (id: string) => ({ key: `chat:${id as SessionId}`, bot: BOT }) as const

async function openWindow(saved: readonly Draft[] = [], typeFirst: (store: typeof import('../src/renderer/composer/drafts')) => void = () => {}) {
  vi.useFakeTimers()
  vi.resetModules()
  const kept: string[] = []
  vi.stubGlobal('window', { addEventListener: () => {}, highwing: { drafts: async () => saved, keepDraft: (draft: Draft) => kept.push(draft.key) } })
  const store = await import('../src/renderer/composer/drafts')
  const started = store.startDrafts()
  typeFirst(store)
  await started
  return { ...store, kept }
}
const savedIn = (id: string, text: string): Draft => ({ ...chat(id), text, attachments: [], quote: null })

describe("a bot's unsent draft, as its row reads it", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('is the text of the chat typed in last, and falls back to the other chat as that one is cleared', async () => {
    const { useBotDrafts, writeDraft } = await openWindow()
    writeDraft(chat('s1'), 'Compare the two papers')
    writeDraft(chat('s2'), 'Summarise the second')
    expect(useBotDrafts().get(BOT)).toBe('Summarise the second')
    writeDraft(chat('s1'), 'Compare the two papers again')
    expect(useBotDrafts().get(BOT)).toBe('Compare the two papers again')
    writeDraft(chat('s1'), '')
    expect(useBotDrafts().get(BOT)).toBe('Summarise the second')
    writeDraft(chat('s2'), '')
    expect(useBotDrafts().has(BOT)).toBe(false)
  })

  it('is the newest saved draft after a restart, and a draft typed before they loaded stays newer', async () => {
    const saved = [savedIn('s1', 'Compare the two papers'), savedIn('s2', 'Summarise the second')]
    expect((await openWindow(saved)).useBotDrafts().get(BOT)).toBe('Summarise the second')
    const typedFirst = await openWindow(saved, store => store.writeDraft(chat('s3'), 'Find a third'))
    expect(typedFirst.useBotDrafts().get(BOT)).toBe('Find a third')
  })

  it('is saved in the order it was typed, so a restart finds the same draft newest', async () => {
    const { attachTo, kept, useBotDrafts, writeDraft } = await openWindow()
    writeDraft(chat('s1'), 'Compare the two papers')
    attachTo(chat('s2'), [{ id: 'a-1' as AttachmentId, name: 'paper.pdf', kind: 'file', size: 2048 }])
    vi.advanceTimersByTime(1_000)
    expect(useBotDrafts().get(BOT)).toBe('')
    expect(kept).toEqual(['chat:s1', 'chat:s2'])
  })

  it('is gone once the draft is sent', async () => {
    const { draftSent, useBotDrafts, writeDraft } = await openWindow()
    writeDraft(chat('s1'), 'Compare the two papers')
    draftSent(chat('s1'), 'Compare the two papers', new Set(), null)
    expect(useBotDrafts().has(BOT)).toBe(false)
  })

  it('ignores group drafts, and stays the same map while nothing in it changes', async () => {
    const { useBotDrafts, writeDraft } = await openWindow()
    writeDraft(chat('s1'), 'Compare the two papers')
    const before = useBotDrafts()
    writeDraft({ key: `group:${'launch' as GroupId}`, bot: null }, '@research look at this')
    expect(useBotDrafts()).toBe(before)
    expect([...before]).toEqual([[BOT, 'Compare the two papers']])
  })
})
