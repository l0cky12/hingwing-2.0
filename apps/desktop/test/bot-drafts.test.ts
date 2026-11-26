import type { BotId, GroupId, SessionId } from '@highwing/hermes/domain'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {} from '../src/renderer/store'

vi.mock('react', async actual => ({ ...(await actual<typeof import('react')>()), useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }))

const BOT = 'research' as BotId
const chat = (id: string) => ({ key: `chat:${id as SessionId}`, bot: BOT }) as const

async function openWindow() {
  vi.useFakeTimers()
  vi.resetModules()
  vi.stubGlobal('window', { addEventListener: () => {}, highwing: { drafts: async () => [], keepDraft: () => {} } })
  const store = await import('../src/renderer/composer/drafts')
  await store.startDrafts()
  return store
}

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

  it('is gone once the draft is sent', async () => {
    const { draftSent, useBotDrafts, writeDraft } = await openWindow()
    writeDraft(chat('s1'), 'Compare the two papers')
    draftSent(chat('s1'), 'Compare the two papers', new Set())
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
