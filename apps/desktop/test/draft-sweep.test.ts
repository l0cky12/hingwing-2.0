import type { SessionId, Sidebar } from '@highwing/hermes/domain'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Draft } from '../src/ipc-contract'
import type {} from '../src/renderer/store'

const OLD = { key: 'chat:local-0007', bot: null, text: 'Ask about the lease', attachments: [] } as unknown as Draft
const listing = (complete: boolean): Sidebar =>
  ({ bot: null, status: 'ready', complete, rows: [{ id: 'local-0100' as SessionId, title: 'Rent', preview: null, lastActiveAt: null, pinned: false, botChat: false, badge: 'none' }] })

async function restore(saved: readonly Draft[]) {
  vi.resetModules()
  const kept: Draft[] = []
  vi.stubGlobal('window', { addEventListener: () => {}, highwing: { drafts: async () => saved, keepDraft: (draft: Draft) => kept.push(draft) } })
  const store = await import('../src/renderer/composer/drafts')
  await store.startDrafts()
  return { store, kept }
}

describe('a restored draft of a chat the list does not show', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is kept while the list may leave out older chats', async () => {
    const { store, kept } = await restore([OLD])
    store.sweepDrafts(listing(false), null)
    expect(kept).toEqual([])
  })

  it('is deleted once the list holds every chat', async () => {
    const { store, kept } = await restore([OLD])
    store.sweepDrafts(listing(true), null)
    expect(kept).toEqual([{ ...OLD, text: '', attachments: [] }])
  })
})
