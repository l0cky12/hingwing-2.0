import { STORED_ROWS, type SessionId, type Shown, type Sidebar } from '@highwing/hermes/domain'
import { useSyncExternalStore } from 'react'
import type { Draft, DraftKey } from '../../ipc-contract'

/** Where a composer's text belongs. null: nowhere to keep it, as in the composer shown with no chat. */
export type DraftSlot = Pick<Draft, 'key' | 'bot'> | null

const SAVE_MS = 500

export function slotOf(shown: Shown): NonNullable<DraftSlot> {
  if (shown.sessionId !== null) return { key: `chat:${shown.sessionId}`, bot: shown.bot }
  return { key: shown.kind === 'bot' ? `bot:${shown.bot}` : 'new', bot: shown.bot }
}

/**
 * Every draft this window holds, for the life of the window rather than of a connection, so a
 * remounted composer reads its chat's text in the same render.
 */
const drafts = new Map<DraftKey, Draft>()
const typed = new Set<DraftKey>()
/** Loaded from disk and not typed in since. Only these are swept. */
const restored = new Set<DraftKey>()
const saving = new Map<DraftKey, { readonly draft: Draft; readonly timer: ReturnType<typeof setTimeout> }>()
let loose = ''
let chats: ReadonlySet<SessionId> = new Set()
const listeners = new Set<() => void>()

function changed() {
  const next = new Set([...drafts.keys()].flatMap(key => (key.startsWith('chat:') ? [key.slice('chat:'.length) as SessionId] : [])))
  // A keystroke in a chat that already has a draft keeps the same set, so the chat list does not redraw.
  if (next.size !== chats.size || [...next].some(id => !chats.has(id))) chats = next
  for (const listener of listeners) listener()
}

function keep(draft: Draft, when: 'soon' | 'now') {
  const { key } = draft
  typed.add(key)
  restored.delete(key)
  if (draft.text === '') drafts.delete(key)
  else drafts.set(key, draft)
  clearTimeout(saving.get(key)?.timer)
  saving.delete(key)
  if (when === 'now') window.highwing.keepDraft(draft)
  else saving.set(key, { draft, timer: setTimeout(() => (saving.delete(key), window.highwing.keepDraft(draft)), SAVE_MS) })
}

function flush() {
  for (const { draft, timer } of saving.values()) {
    clearTimeout(timer)
    window.highwing.keepDraft(draft)
  }
  saving.clear()
}

const textOf = (slot: DraftSlot) => (slot === null ? loose : drafts.get(slot.key)?.text ?? '')

/** Once, at startup. A draft typed before the stored ones arrive wins over its stored text. */
export async function loadDrafts(): Promise<void> {
  window.addEventListener('pagehide', flush)
  for (const draft of await window.highwing.drafts()) {
    if (typed.has(draft.key)) continue
    drafts.set(draft.key, draft)
    restored.add(draft.key)
  }
  changed()
}

export function writeDraft(slot: DraftSlot, text: string) {
  if (slot === null) loose = text
  else keep({ ...slot, text }, 'soon')
  changed()
}

/**
 * After `text` was sent from `slot`: empties the slot, unless it now holds something else. Pass the
 * slot the text was sent from. A first message moves its chat to a new slot.
 */
export function draftSent(slot: DraftSlot, text: string) {
  if (textOf(slot).trim() !== text) return
  if (slot === null) loose = ''
  else keep({ ...slot, text: '' }, 'now')
  changed()
}

/**
 * Deletes each restored draft whose chat is missing from a whole list of its bot's chats. A list as
 * long as Hermes lists may have left the chat out, so it proves nothing.
 */
export function sweepDrafts(sidebar: Sidebar | undefined, open: DraftKey | null) {
  if (sidebar?.status !== 'ready' || sidebar.rows.length >= STORED_ROWS) return
  const listed = new Set<string>(sidebar.rows.map(row => `chat:${row.id}`))
  const gone = [...restored].flatMap(key => {
    const draft = drafts.get(key)
    return draft !== undefined && key.startsWith('chat:') && key !== open && draft.bot === sidebar.bot && !listed.has(key) ? [draft] : []
  })
  for (const draft of gone) keep({ ...draft, text: '' }, 'now')
  if (gone.length > 0) changed()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const useDraft = (slot: DraftSlot): string => useSyncExternalStore(subscribe, () => textOf(slot))

/** The sessions of the chats that hold a draft. */
export const useChatDrafts = (): ReadonlySet<SessionId> => useSyncExternalStore(subscribe, () => chats)
