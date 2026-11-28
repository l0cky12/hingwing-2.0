import { quoteOf, type Attachment, type AttachmentId, type BotId, type Quote, type SessionId, type Shown, type ShownGroup, type Sidebar } from '@highwing/hermes/domain'
import { useSyncExternalStore } from 'react'
import { isEmptyDraft, type Draft, type DraftKey } from '../../ipc-contract'

export type DraftSlot = Pick<Draft, 'key' | 'bot'> | null
type Held = Pick<Draft, 'text' | 'attachments' | 'quote'>

const SAVE_MS = 500
const EMPTY: Held = { text: '', attachments: [], quote: null }

export function slotOf(shown: Shown | ShownGroup): NonNullable<DraftSlot> {
  if (shown.kind === 'group') return { key: `group:${shown.group}`, bot: null }
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
let newestByBot: ReadonlyMap<BotId, string> = new Map()
const listeners = new Set<() => void>()

const sameMembers = (a: ReadonlySet<SessionId>, b: ReadonlySet<SessionId>) => a.size === b.size && [...a].every(id => b.has(id))
const sameTexts = (a: ReadonlyMap<BotId, string>, b: ReadonlyMap<BotId, string>) => a.size === b.size && [...a].every(([bot, text]) => b.get(bot) === text)

function changed() {
  const next = new Set([...drafts.keys()].flatMap(key => (key.startsWith('chat:') ? [key.slice('chat:'.length) as SessionId] : [])))
  if (!sameMembers(next, chats)) chats = next
  const texts = new Map<BotId, string>()
  for (const draft of drafts.values()) if (draft.bot !== null) texts.set(draft.bot, draft.text)
  if (!sameTexts(texts, newestByBot)) newestByBot = texts
  for (const listener of listeners) listener()
}

function setNewest(draft: Draft) {
  drafts.delete(draft.key)
  drafts.set(draft.key, draft)
}

function keep(draft: Draft, when: 'soon' | 'now') {
  const { key } = draft
  typed.add(key)
  restored.delete(key)
  if (isEmptyDraft(draft)) drafts.delete(key)
  else setNewest(draft)
  clearTimeout(saving.get(key)?.timer)
  saving.delete(key)
  if (when === 'now') {
    flush()
    window.highwing.keepDraft(draft)
  } else saving.set(key, { draft, timer: setTimeout(() => (saving.delete(key), window.highwing.keepDraft(draft)), SAVE_MS) })
}

function flush() {
  for (const { draft, timer } of saving.values()) {
    clearTimeout(timer)
    window.highwing.keepDraft(draft)
  }
  saving.clear()
}

/** Files still being staged into each draft. Kept here, not in the composer, so a switch away and back still sees them. */
const staging = new Map<DraftKey | null, number>()

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
    const saved = (await window.highwing.drafts()).filter(draft => !typed.has(draft.key))
    const typedHere = [...drafts.values()]
    drafts.clear()
    for (const draft of saved) {
      drafts.set(draft.key, draft)
      restored.add(draft.key)
    }
    typedHere.forEach(setNewest)
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

export const quoteInto = (slot: DraftSlot, quote: Quote | null) => put(slot, { quote }, 'now')

/** Puts a branch's message in the chat it made. A draft the chat has, or one typed or cleared since the window loaded, wins. */
export function seedDraft(slot: NonNullable<DraftSlot>, message: string) {
  const { quote, body } = quoteOf(message)
  const draft = { ...slot, text: body, attachments: [], quote }
  if (seeds !== null) return void seeds.push(draft)
  plant(draft)
  changed()
}

export function carryToNewChat(bot: BotId | null, message: string) {
  const slot = { key: 'new', bot } as const
  const { quote, body } = quoteOf(message)
  const held = heldOf(slot)
  put(slot, { text: held.text === '' ? body : `${held.text}\n\n${body}`, quote: held.quote ?? quote }, 'now')
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
  const { text, attachments, quote } = heldOf(from)
  const held = { text, attachments, quote }
  if (from?.key === to?.key || isEmptyDraft(held) || !isEmptyDraft(heldOf(to))) return
  put(to, held, 'now')
  put(from, EMPTY, 'now')
}

const sameQuote = (a: Quote | null, b: Quote | null) => a?.from === b?.from && a?.text === b?.text

export function draftSent(slot: DraftSlot, text: string, sent: ReadonlySet<AttachmentId>, quote: Quote | null) {
  const held = heldOf(slot)
  put(slot, {
    text: held.text.trim() === text ? '' : held.text,
    attachments: held.attachments.filter(attachment => !sent.has(attachment.id)),
    quote: sameQuote(held.quote, quote) ? null : held.quote
  }, 'now')
}

export function sweepDrafts(sidebar: Sidebar | undefined, open: DraftKey | null) {
  if (sidebar?.status !== 'ready' || !sidebar.complete) return
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

export async function stagingFor<T>(slot: DraftSlot, pending: Promise<T>): Promise<T> {
  const key = slot?.key ?? null
  staging.set(key, (staging.get(key) ?? 0) + 1)
  changed()
  try {
    return await pending
  } finally {
    const left = (staging.get(key) ?? 1) - 1
    if (left === 0) staging.delete(key)
    else staging.set(key, left)
    changed()
  }
}

export const stagingIn = (slot: DraftSlot): number => staging.get(slot?.key ?? null) ?? 0

export const useStaging = (slot: DraftSlot): number => useSyncExternalStore(subscribe, () => stagingIn(slot))

export const useAttachments = (slot: DraftSlot): readonly Attachment[] => useSyncExternalStore(subscribe, () => heldOf(slot).attachments)

export const useQuote = (slot: DraftSlot): Quote | null => useSyncExternalStore(subscribe, () => heldOf(slot).quote)

export const useChatDrafts = (): ReadonlySet<SessionId> => useSyncExternalStore(subscribe, () => chats)

export const useBotDrafts = (): ReadonlyMap<BotId, string> => useSyncExternalStore(subscribe, () => newestByBot)
