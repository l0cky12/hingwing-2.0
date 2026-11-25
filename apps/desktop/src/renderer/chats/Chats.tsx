import type { Bots, CommandOutcome, ExportFormat, OpenChat, SessionId, Sidebar } from '@highwing/hermes/domain'
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { baseName } from '../chat/FilePath'
import { menuStep, useMenu } from '../chat/menu'
import { slotOf, sweepDrafts, useChatDrafts } from '../composer/drafts'
import { run, useTopic } from '../store'
import { botNameOf, CHATS, chatsOf, DRAFT, type ChatRow } from './chat-list'

const TICK_MS = 30_000
const SAVED_MS = 5_000

const EXPORTS: readonly (readonly [ExportFormat, string])[] = [['md', 'Export as Markdown'], ['json', 'Export as JSON'], ['html', 'Export as HTML']]

function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])
  return now
}

export function ChatsSidebar() {
  const sidebar = useTopic('sidebar')
  const open = useTopic('open')
  const drafts = useChatDrafts()
  const shown = open?.shown ?? null
  const openKey = shown === null ? null : slotOf(shown).key
  useEffect(() => sweepDrafts(sidebar, openKey), [sidebar, openKey, drafts])
  return (
    <ChatsPanel
      sidebar={sidebar} open={open} bots={useTopic('bots')} now={useNow()} drafts={drafts} live={useTopic('link')?.state === 'online'}
      onOpen={sessionId => void run({ do: 'open', ref: { kind: 'chat', sessionId } })}
      onRename={(sessionId, title) => run({ do: 'rename', sessionId, title })}
      onExport={(sessionId, format) => run({ do: 'export', sessionId, format })}
    />
  )
}

interface RowActions {
  readonly onOpen: (sessionId: SessionId) => void
  readonly onRename: (sessionId: SessionId, title: string) => Promise<CommandOutcome<unknown>>
  /** Answers the path the chat was saved at, or null when the user cancelled the save. */
  readonly onExport: (sessionId: SessionId, format: ExportFormat) => Promise<CommandOutcome<string | null>>
}

interface ChatsPanelProps extends RowActions {
  readonly sidebar: Sidebar | undefined
  readonly open: OpenChat | undefined
  readonly bots: Bots | undefined
  readonly now: number
  readonly drafts: ReadonlySet<SessionId>
  /** Whether the connection the list came over is online, so a row's More menu can act. */
  readonly live: boolean
}

export function ChatsPanel({ sidebar, open, bots, now, drafts, live, ...actions }: ChatsPanelProps) {
  const ids = useId()
  const view = chatsOf(sidebar, open, now, drafts)
  // An object, so saving the same file twice shows the line again for the whole time.
  const [saved, setSaved] = useState<{ readonly name: string } | null>(null)
  useEffect(() => {
    if (saved === null) return
    const id = setTimeout(() => setSaved(null), SAVED_MS)
    return () => clearTimeout(id)
  }, [saved])
  return (
    <nav className="chats" aria-label="Chats">
      <div className="chats-head"><h2>{botNameOf(bots, open?.shown?.bot ?? null) ?? CHATS}</h2></div>
      <div className="chats-list" aria-busy={view.show === 'loading' || undefined}>
        {view.show === 'note' && <p className="chats-note" role="status">{view.words}</p>}
        {view.show === 'rows' && view.rows.map((row, at) => (
          // A session id is any word Hermes mints, so the ids come from the row's place.
          <ChatItem key={row.id} row={row} ids={`${ids}-${at}`} live={live} {...actions} onSaved={path => setSaved({ name: baseName(path) })} />
        ))}
      </div>
      <p className="chats-note chats-saved" role="status">{saved === null ? '' : `Saved ${saved.name}`}</p>
    </nav>
  )
}

interface ChatItemProps extends RowActions {
  readonly row: ChatRow
  readonly ids: string
  readonly live: boolean
  readonly onSaved: (path: string) => void
}

function ChatItem({ row, ids, live, onOpen, onRename, onExport, onSaved }: ChatItemProps) {
  const { open: menu, setOpen: setMenu, holder, toggle, onKeyDown } = useMenu<HTMLDivElement, HTMLButtonElement>()
  const items = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const [naming, setNaming] = useState<'off' | 'typing' | 'saving'>('off')
  const [refused, setRefused] = useState<string | null>(null)
  const [doing, when, preview] = [`${ids}-doing`, `${ids}-when`, `${ids}-preview`]
  const words = row.doing ?? (row.showsDraft ? DRAFT : null)

  useEffect(() => {
    if (menu) items.current?.querySelector('button')?.focus()
  }, [menu])

  const stopNaming = () => {
    flushSync(() => setNaming('off'))
    opener.current?.focus()
  }
  const rename = async (title: string) => {
    if (title.trim() === '' || title === row.name) {
      stopNaming()
      return
    }
    setNaming('saving')
    const outcome = await onRename(row.id, title)
    setRefused(outcome.ok ? null : outcome.refusal.message)
    stopNaming()
  }
  const exportAs = async (format: ExportFormat) => {
    setMenu(false)
    toggle.current?.focus()
    const outcome = await onExport(row.id, format)
    setRefused(outcome.ok ? null : outcome.refusal.message)
    if (outcome.ok && outcome.value !== null) onSaved(outcome.value)
  }
  const onMenuKey = (event: KeyboardEvent) => {
    const buttons = [...(items.current?.querySelectorAll('button') ?? [])]
    const next = menuStep(event.key, buttons.indexOf(document.activeElement as HTMLButtonElement), buttons.length)
    if (next === null) return
    event.preventDefault()
    buttons[next]?.focus()
  }
  const onNameKey = (event: KeyboardEvent<HTMLInputElement>) => {
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
              className="chat-name" aria-label="Chat name" defaultValue={row.name} autoFocus disabled={naming === 'saving'}
              onFocus={event => event.currentTarget.select()} onKeyDown={onNameKey} onBlur={event => event.currentTarget.disabled || setNaming('off')}
            />
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="chat-item" ref={holder} onKeyDown={onKeyDown}>
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
          <button type="button" role="menuitem" onClick={() => { setMenu(false); setRefused(null); setNaming('typing') }}>Rename…</button>
          {EXPORTS.map(([format, label]) => <button key={format} type="button" role="menuitem" onClick={() => void exportAs(format)}>{label}</button>)}
        </div>
      )}
      {refused !== null && <p className="err">{refused}</p>}
    </div>
  )
}
