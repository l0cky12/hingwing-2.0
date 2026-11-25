import type { CommandOutcome, ExportFormat, OpenChat, SessionId, Sidebar } from '@highwing/hermes/domain'
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { chatLink } from '../../chat-link'
import { baseName } from '../chat/FilePath'
import { menuStep, useMenu } from '../chat/menu'
import { slotOf, sweepDrafts, useChatDrafts } from '../composer/drafts'
import { RemoveDialog } from '../composer/RemoveDialog'
import { run, useTopic } from '../store'
import { ACTION_LABELS, chatsOf, DRAFT, type ChatRow, type RowAction } from './chat-list'

const TICK_MS = 30_000
const SAVED_MS = 5_000

const REMOVE_DETAIL = 'Hermes deletes this chat and its messages, and can’t bring them back.'

function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])
  return now
}

export function DraftSweep() {
  const sidebar = useTopic('sidebar')
  const shown = useTopic('open')?.shown ?? null
  const drafts = useChatDrafts()
  const openKey = shown === null ? null : slotOf(shown).key
  useEffect(() => sweepDrafts(sidebar, openKey), [sidebar, openKey, drafts])
  return null
}

export function ChatsSidebar({ head }: { readonly head: ReactNode }) {
  return (
    <ChatsPanel
      head={head} sidebar={useTopic('sidebar')} open={useTopic('open')} now={useNow()} drafts={useChatDrafts()} live={useTopic('link')?.state === 'online'}
      onOpen={sessionId => void run({ do: 'open', ref: { kind: 'chat', sessionId } })}
      onRename={(sessionId, title) => run({ do: 'rename', sessionId, title })}
      onExport={(sessionId, format) => run({ do: 'export', sessionId, format })}
      onPin={(sessionId, pinned) => run({ do: 'pin', sessionId, pinned })}
      onArchive={sessionId => run({ do: 'archive', sessionId, archived: true })}
      onRemove={sessionId => run({ do: 'remove', sessionId })}
    />
  )
}

interface RowActions {
  readonly onOpen: (sessionId: SessionId) => void
  readonly onRename: (sessionId: SessionId, title: string) => Promise<CommandOutcome<unknown>>
  readonly onExport: (sessionId: SessionId, format: ExportFormat) => Promise<CommandOutcome<string | null>>
  readonly onPin: (sessionId: SessionId, pinned: boolean) => Promise<CommandOutcome<unknown>>
  readonly onArchive: (sessionId: SessionId) => Promise<CommandOutcome<unknown>>
  readonly onRemove: (sessionId: SessionId) => Promise<CommandOutcome<unknown>>
}

interface ChatsPanelProps extends RowActions {
  readonly head: ReactNode
  readonly sidebar: Sidebar | undefined
  readonly open: OpenChat | undefined
  readonly now: number
  readonly drafts: ReadonlySet<SessionId>
  readonly live: boolean
}

export function ChatsPanel({ head, sidebar, open, now, drafts, live, ...actions }: ChatsPanelProps) {
  const ids = useId()
  const view = chatsOf(sidebar, open, now, drafts)
  const [said, setSaid] = useState<{ readonly words: string } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const [moved, setMoved] = useState<{ readonly id: SessionId; readonly at: number; readonly to: Moved } | null>(null)
  const pinned = view.show === 'rows' ? view.pinned : []
  const rows = view.show === 'rows' ? [...pinned, ...view.sessions] : []
  useEffect(() => {
    if (moved === null) return
    const at = rows.findIndex(row => row.id === moved.id)
    const arrived = moved.to === 'gone' ? at < 0 : at >= 0 && pinned.some(row => row.id === moved.id) === (moved.to === 'pinned')
    if (!arrived) return
    setMoved(null)
    // Focus on a button that left, or moved, falls to the page. Focus anywhere else is where the user went since.
    const { activeElement } = document
    if (activeElement !== null && activeElement !== document.body) return
    const drawn = list.current?.querySelectorAll<HTMLElement>('.chat-item') ?? []
    const target = moved.to === 'gone' ? drawn[Math.min(moved.at, drawn.length - 1)]?.querySelector<HTMLElement>('button.chat-row') : drawn[at]?.querySelector<HTMLElement>('.chat-more')
    ;(target ?? list.current)?.focus()
  })
  const items = (held: readonly ChatRow[], from: number) => held.map((row, index) => {
    const at = from + index
    // A session id is any word Hermes mints, so the ids come from the row's place.
    return (
      <ChatItem
        key={`chat:${row.id}`} row={row} ids={`${ids}-${at}`} live={live} {...actions} onSay={words => setSaid({ words })} onMoved={to => setMoved({ id: row.id, at, to })}
      />
    )
  })
  useEffect(() => {
    if (said === null) return
    const id = setTimeout(() => setSaid(null), SAVED_MS)
    return () => clearTimeout(id)
  }, [said])
  return (
    <nav className="chats" aria-label="Chats">
      <div className="chats-head">{head}</div>
      <div ref={list} className="chats-list" tabIndex={-1} aria-busy={view.show === 'loading' || undefined}>
        {view.show === 'note' && <p className="chats-note" role="status">{view.words}</p>}
        {/* One list of children, so a row that moves between the groups keeps its state. */}
        {pinned.length === 0
          ? items(rows, 0)
          : [<h3 key="group:pinned" className="chats-group">Pinned</h3>, ...items(pinned, 0), <h3 key="group:sessions" className="chats-group">Sessions</h3>, ...items(rows.slice(pinned.length), pinned.length)]}
      </div>
      <p className="chats-note chats-saved" role="status">{said?.words ?? ''}</p>
    </nav>
  )
}

interface ChatItemProps extends RowActions {
  readonly row: ChatRow
  readonly ids: string
  readonly live: boolean
  readonly onSay: (words: string) => void
  /** Where this item's word sent the row: out of the list, or into a group. */
  readonly onMoved: (to: Moved) => void
}

type Moved = 'gone' | 'pinned' | 'unpinned'

function ChatItem({ row, ids, live, onOpen, onRename, onExport, onPin, onArchive, onRemove, onSay, onMoved }: ChatItemProps) {
  const { open: menu, setOpen: setMenu, holder, toggle, onKeyDown } = useMenu<HTMLDivElement, HTMLButtonElement>()
  const items = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const [naming, setNaming] = useState<'off' | 'typing' | 'saving'>('off')
  const [refused, setRefused] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [doing, when, preview] = [`${ids}-doing`, `${ids}-when`, `${ids}-preview`]
  const words = row.doing ?? (row.showsDraft ? DRAFT : null)

  useEffect(() => {
    if (menu) items.current?.querySelector('button')?.focus()
  }, [menu])

  useEffect(() => {
    if (live) return
    setMenu(false)
    setConfirming(false)
    setNaming(held => (held === 'typing' ? 'off' : held))
  }, [live])

  const field = useRef<HTMLInputElement>(null)
  const stopNaming = () => {
    // While saving, the disabled field drops focus to the page; focus anywhere else is where the user went since.
    const { activeElement } = document
    const stayed = activeElement === null || activeElement === document.body || activeElement === field.current
    flushSync(() => setNaming('off'))
    if (stayed) opener.current?.focus()
  }
  const rename = async (title: string) => {
    if (!live || title.trim() === '' || title === row.name) {
      stopNaming()
      return
    }
    setNaming('saving')
    const outcome = await onRename(row.id, title)
    setRefused(outcome.ok ? null : outcome.refusal.message)
    stopNaming()
  }
  const exportAs = async (format: ExportFormat) => {
    if (!live) return
    setMenu(false)
    toggle.current?.focus()
    const outcome = await onExport(row.id, format)
    setRefused(outcome.ok ? null : outcome.refusal.message)
    if (outcome.ok && outcome.value !== null) onSay(`Saved ${baseName(outcome.value)}`)
  }
  const copyLink = () => {
    setMenu(false)
    toggle.current?.focus()
    navigator.clipboard.writeText(chatLink(row.id)).then(() => onSay('Link copied'), () => onSay('Couldn’t copy the link'))
  }
  const leave = async (asked: (sessionId: SessionId) => Promise<CommandOutcome<unknown>>, words: string) => {
    toggle.current?.focus()
    const outcome = await asked(row.id)
    setRefused(outcome.ok ? null : outcome.refusal.message)
    if (!outcome.ok) return
    onSay(words)
    onMoved('gone')
  }
  const pin = async (pinned: boolean) => {
    setMenu(false)
    toggle.current?.focus()
    const outcome = await onPin(row.id, pinned)
    setRefused(outcome.ok ? null : outcome.refusal.message)
    onMoved(outcome.ok === pinned ? 'pinned' : 'unpinned')
  }
  /** A modal dialog makes the rest of the page inert, so it closes before focus goes back. */
  const stopConfirming = () => {
    flushSync(() => setConfirming(false))
    toggle.current?.focus()
  }
  const acts: { readonly [A in RowAction]: () => void } = {
    rename: () => { setMenu(false); setRefused(null); setNaming('typing') },
    pin: () => void pin(true),
    unpin: () => void pin(false),
    'export-md': () => void exportAs('md'),
    'export-json': () => void exportAs('json'),
    'export-html': () => void exportAs('html'),
    link: copyLink,
    archive: () => { setMenu(false); void leave(onArchive, `Archived ${row.name}`) },
    remove: () => { setMenu(false); setConfirming(true) }
  }
  const onMenuKey = (event: KeyboardEvent) => {
    const buttons = [...(items.current?.querySelectorAll('button') ?? [])]
    const next = menuStep(event.key, buttons.indexOf(document.activeElement as HTMLButtonElement), buttons.length)
    if (next === null) return
    event.preventDefault()
    buttons[next]?.focus()
  }
  const onNameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.stopPropagation()
      stopNaming()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void rename(event.currentTarget.value)
    }
  }
  const onMenuBlur = (event: FocusEvent) => {
    if (!holder.current?.contains(event.relatedTarget)) setMenu(false)
  }

  const lines = (title: ReactNode) => (
    <>
      <span className="chat-top">
        {title}
        <span className="chat-when" id={when}>{row.when}</span>
      </span>
      <span className="chat-doing" id={doing} data-badge={row.badge}>{words ?? ''}</span>
      {/* Hidden, the preview is still read as part of the row's description. */}
      <span className="chat-preview" id={preview} hidden={words !== null}>{row.preview ?? ''}</span>
    </>
  )

  if (naming !== 'off') {
    return (
      <div className="chat-item">
        <div className="chat-row" aria-current={row.current || undefined}>
          {lines(
            <input
              ref={field} className="chat-name" aria-label="Chat name" defaultValue={row.name} autoFocus disabled={naming === 'saving'}
              onFocus={event => event.currentTarget.select()} onKeyDown={onNameKey} onBlur={event => event.currentTarget.disabled || setNaming('off')}
            />
          )}
        </div>
      </div>
    )
  }
  return (
    <div
      className="chat-item" ref={holder} onKeyDown={onKeyDown}
      onContextMenu={event => { event.preventDefault(); if (live && !confirming) setMenu(true) }}
    >
      <button
        ref={opener} type="button" className="chat-row" aria-label={row.name} aria-describedby={`${doing} ${when} ${preview}`}
        aria-current={row.current || undefined} onClick={() => onOpen(row.id)}
      >
        {lines(<span className="chat-title">{row.name}</span>)}
      </button>
      <button
        ref={toggle} type="button" className="file-more chat-more" aria-label={`More for ${row.name}`} aria-haspopup="menu" aria-expanded={menu}
        disabled={!live} onClick={() => setMenu(shown => !shown)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {menu && (
        <div ref={items} className="file-menu" role="menu" aria-label={`More for ${row.name}`} onKeyDown={onMenuKey} onBlur={onMenuBlur}>
          {row.offers.map(action => <button key={action} type="button" role="menuitem" onClick={acts[action]}>{ACTION_LABELS[action]}</button>)}
        </div>
      )}
      {refused !== null && <p className="err">{refused}</p>}
      {confirming && (
        <RemoveDialog
          title={`Remove “${row.name}”?`} detail={REMOVE_DETAIL} confirm="Remove" onCancel={stopConfirming}
          onConfirm={() => { flushSync(() => setConfirming(false)); void leave(onRemove, `Removed ${row.name}`) }}
        />
      )}
    </div>
  )
}
