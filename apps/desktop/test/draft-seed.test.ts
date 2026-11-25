import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Draft } from '../src/ipc-contract'
import type {} from '../src/renderer/store'

const CHILD = { key: 'chat:branch-1', bot: null } as unknown as Pick<Draft, 'key' | 'bot'>
const SEED = 'Add a line about the deadline under it'

async function openWindow(saved: readonly Draft[]) {
  vi.resetModules()
  let release = () => {}
  const read = new Promise<void>(resolve => { release = resolve })
  const kept: Draft[] = []
  vi.stubGlobal('window', { addEventListener: () => {}, highwing: { drafts: async () => (await read, saved), keepDraft: (draft: Draft) => kept.push(draft) } })
  const store = await import('../src/renderer/composer/drafts')
  const started = store.startDrafts()
  return { store, kept, loaded: async () => { release(); await started; vi.advanceTimersByTime(1_000) } }
}

describe("a branch's text in the new chat's draft", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('becomes the draft of a chat that has none', async () => {
    vi.useFakeTimers()
    const { store, kept, loaded } = await openWindow([])
    await loaded()
    store.seedDraft(CHILD, SEED)
    vi.advanceTimersByTime(1_000)
    expect(kept).toEqual([{ ...CHILD, text: SEED, attachments: [] }])
  })

  it('waits for the saved drafts, and leaves a saved draft of that chat as it is', async () => {
    vi.useFakeTimers()
    const { store, kept, loaded } = await openWindow([{ ...CHILD, text: 'Add a line about Friday', attachments: [] } as Draft])
    store.seedDraft(CHILD, SEED)
    await loaded()
    expect(kept).toEqual([])
  })

  it('waits for the saved drafts, then fills a chat that has none', async () => {
    vi.useFakeTimers()
    const { store, kept, loaded } = await openWindow([])
    store.seedDraft(CHILD, SEED)
    expect(kept).toEqual([])
    await loaded()
    expect(kept).toEqual([{ ...CHILD, text: SEED, attachments: [] }])
  })

  it('never fills a box the user cleared', async () => {
    vi.useFakeTimers()
    const { store, kept, loaded } = await openWindow([])
    await loaded()
    store.writeDraft(CHILD, '')
    store.seedDraft(CHILD, SEED)
    vi.advanceTimersByTime(1_000)
    expect(kept).toEqual([{ ...CHILD, text: '', attachments: [] }])
  })
})
