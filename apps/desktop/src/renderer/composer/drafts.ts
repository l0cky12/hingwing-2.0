import { STORED_ROWS, type Attachment, type AttachmentId, type SessionId, type Shown, type Sidebar } from '@highwing/hermes/domain'
import { useSyncExternalStore } from 'react'
import { isEmptyDraft, type Draft, type DraftKey } from '../../ipc-contract'

export type DraftSlot = Pick<Draft, 'key' | 'bot'> | null
type Held = Pick<Draft, 'text' | 'attachments'>

const SAVE_MS = 500
const EMPTY: Held = { text: '', attachments: [] }

export function slotOf(shown: Shown): NonNullable<DraftSlot> {
  if (shown.sessionId !== null) return { key: `chat:${shown.sessionId}`, bot: shown.bot }
  return { key: shown.kind === 'bot' ? `bot:${shown.bot}` : 'new', bot: shown.bot }
}

const drafts = new Map<DraftKey, Draft>()
const typed = new Set<DraftKey>()
const restored = new Set<DraftKey>()
const saving = new Map<DraftKey, { readonly draft: Draft; readonly timer: ReturnType<typeof setTimeout> }>()
let loose: Held = EMPTY
/** Seeds asked for before main's drafts are read. A saved draft for the same chat wins over them. */
let seeds: Draft[] | null = []
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
  if (isEmptyDraft(draft)) drafts.delete(key)
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

const heldOf = (slot: DraftSlot): Held => (slot === null ? loose : drafts.get(slot.key) ?? EMPTY)

function put(slot: DraftSlot, change: Partial<Held>, when: 'soon' | 'now') {
  const next = { ...heldOf(slot), ...change }
  if (slot === null) loose = next
  else keep({ ...slot, ...next }, when)
  changed()
}

export async function startDrafts(): Promise<void> {
  window.addEventListener('pagehide', flush)
  try {
    for (const draft of await window.highwing.drafts()) {
      if (typed.has(draft.key)) continue
      drafts.set(draft.key, draft)
      restored.add(draft.key)
    }
  } finally {
    const asked = seeds ?? []
    seeds = null
    asked.forEach(plant)
    changed()
  }
}

function plant(draft: Draft) {
  if (!drafts.has(draft.key) && !typed.has(draft.key)) keep(draft, 'soon')
}

export const writeDraft = (slot: DraftSlot, text: string) => put(slot, { text }, 'soon')

export const attachTo = (slot: DraftSlot, attachments: readonly Attachment[]) => {
  if (attachments.length > 0) put(slot, { attachments: [...heldOf(slot).attachments, ...attachments] }, 'now')
}

/** Puts a branch's text in the chat it made. A draft the chat has, or one typed or cleared since the window loaded, wins. */
export function seedDraft(slot: NonNullable<DraftSlot>, text: string) {
  if (seeds !== null) return void seeds.push({ ...slot, text, attachments: [] })
  plant({ ...slot, text, attachments: [] })
  changed()
}

export const detach = (slot: DraftSlot, id: AttachmentId) => put(slot, { attachments: heldOf(slot).attachments.filter(held => held.id !== id) }, 'now')

/** Moves an attachment one place earlier (-1) or later (1). Nothing moves past either end. */
export function moveAttachment(slot: DraftSlot, id: AttachmentId, by: -1 | 1) {
  const attachments = [...heldOf(slot).attachments]
  const at = attachments.findIndex(held => held.id === id)
  const to = at + by
  if (at < 0 || to < 0 || to >= attachments.length) return
  ;[attachments[at], attachments[to]] = [attachments[to]!, attachments[at]!]
  put(slot, { attachments }, 'now')
}

/** Moves a draft to another slot that holds none. */
export function moveDraft(from: DraftSlot, to: DraftSlot) {
  const { text, attachments } = heldOf(from)
  if (from?.key === to?.key || (text === '' && attachments.length === 0)) return
  const there = heldOf(to)
  if (there.text !== '' || there.attachments.length > 0) return
  put(to, { text, attachments }, 'now')
  put(from, EMPTY, 'now')
}

/** Clears what was sent: the text, unless it changed while the message was on its way, and exactly the attachments sent with it. */
export function draftSent(slot: DraftSlot, text: string, sent: ReadonlySet<AttachmentId>) {
  const held = heldOf(slot)
  put(slot, { text: held.text.trim() === text ? '' : held.text, attachments: held.attachments.filter(attachment => !sent.has(attachment.id)) }, 'now')
}

export function sweepDrafts(sidebar: Sidebar | undefined, open: DraftKey | null) {
  if (sidebar?.status !== 'ready' || sidebar.rows.length >= STORED_ROWS) return
  const listed = new Set<string>(sidebar.rows.map(row => `chat:${row.id}`))
  const gone = [...restored].flatMap(key => {
    const draft = drafts.get(key)
    return draft !== undefined && key.startsWith('chat:') && key !== open && draft.bot === sidebar.bot && !listed.has(key) ? [draft] : []
  })
  for (const draft of gone) keep({ ...draft, ...EMPTY }, 'now')
  if (gone.length > 0) changed()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const useDraft = (slot: DraftSlot): string => useSyncExternalStore(subscribe, () => heldOf(slot).text)

export const useAttachments = (slot: DraftSlot): readonly Attachment[] => useSyncExternalStore(subscribe, () => heldOf(slot).attachments)

export const useChatDrafts = (): ReadonlySet<SessionId> => useSyncExternalStore(subscribe, () => chats)
