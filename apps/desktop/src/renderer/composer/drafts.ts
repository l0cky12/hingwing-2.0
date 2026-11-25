import { STORED_ROWS, type SessionId, type Shown, type Sidebar } from '@highwing/hermes/domain'
import { useSyncExternalStore } from 'react'
import type { Draft, DraftKey } from '../../ipc-contract'

export type DraftSlot = Pick<Draft, 'key' | 'bot'> | null

const SAVE_MS = 500

export function slotOf(shown: Shown): NonNullable<DraftSlot> {
  if (shown.sessionId !== null) return { key: `chat:${shown.sessionId}`, bot: shown.bot }
  return { key: shown.kind === 'bot' ? `bot:${shown.bot}` : 'new', bot: shown.bot }
}

const drafts = new Map<DraftKey, Draft>()
const typed = new Set<DraftKey>()
const restored = new Set<DraftKey>()
const saving = new Map<DraftKey, { readonly draft: Draft; readonly timer: ReturnType<typeof setTimeout> }>()
let loose = ''
let chats: ReadonlySet<SessionId> = new Set()
const listeners = new Set<() => void>()

const sameMembers = (a: ReadonlySet<SessionId>, b: ReadonlySet<SessionId>) => a.size === b.size && [...a].every(id => b.has(id))

function changed() {
  const next = new Set([...drafts.keys()].flatMap(key => (key.startsWith('chat:') ? [key.slice('chat:'.length) as SessionId] : [])))
  if (!sameMembers(next, chats)) chats = next
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

export async function startDrafts(): Promise<void> {
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

export function draftSent(slot: DraftSlot, text: string) {
  if (textOf(slot).trim() !== text) return
  if (slot === null) loose = ''
  else keep({ ...slot, text: '' }, 'now')
  changed()
}

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

export const useChatDrafts = (): ReadonlySet<SessionId> => useSyncExternalStore(subscribe, () => chats)
