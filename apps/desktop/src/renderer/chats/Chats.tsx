import type { CommandOutcome, ExportFormat, OpenChat, SessionId, Sidebar } from '@highwing/hermes/domain'
import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { chatLink } from '../../chat-link'
import type { Snoozes } from '../../ipc-contract'
import { baseName } from '../chat/FilePath'
import { useWakeAt } from '../chat/wake'
import { MENU_ICONS } from '../chrome/menu-icons'
import { anchorAt, isMenuKey, type Opener } from '../chrome/popup-menu'
import { ICON, PopupMenu, type PopupItem } from '../chrome/PopupMenu'
import { slotOf, sweepDrafts, useChatDrafts } from '../composer/drafts'
import { RemoveDialog } from '../composer/RemoveDialog'
import { run, useTopic } from '../store'
import {
  ACTION_LABELS, chatsOf, DRAFT, groupOf, nextWakeOf, sectionsOf, snoozeChoices, untilWords, type ChatGroup, type ChatRow, type RowAction, type SnoozeChoice, type SnoozeId
} from './chat-list'

const TICK_MS = 30_000
const SAVED_MS = 5_000
const NAMING = 'Naming…'
const NO_SNOOZES: Snoozes = {}

const DELETE_DETAIL = 'Hermes deletes this chat and its messages, and can’t bring them back.'

const FILE = 'M14 3H6v18h12V7zM14 3v4h4'
const ICONS: { readonly [A in RowAction]: ReactNode } = {
  pin: MENU_ICONS.pin,
  unpin: MENU_ICONS.unpin,
  snooze: <svg {...ICON}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3" /></svg>,
  wake: <svg {...ICON}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  rename: MENU_ICONS.edit,
  retitle: <svg {...ICON}><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16v4M17 18h4" /></svg>,
  'export-md': <svg {...ICON}><path d={FILE} /><path d="M9 13h6M9 17h6" /></svg>,
  'export-json': <svg {...ICON}><path d="M8 4H7a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-1" /></svg>,
  'export-html': <svg {...ICON}><path d="m8 7-5 5 5 5M16 7l5 5-5 5" /></svg>,
  link: <svg {...ICON}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>,
  archive: <svg {...ICON}><path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4" /></svg>,
  delete: MENU_ICONS.delete
}

/** The time now, read again every half minute and the moment the next snooze runs out. */
function useNow(snoozes: Snoozes): number {
  const [now, tick] = useReducer(() => Date.now(), 0, Date.now)
  useEffect(() => {
    const id = setInterval(tick, TICK_MS)
    return () => clearInterval(id)
  }, [])
  useWakeAt(nextWakeOf(snoozes, now), now, tick)
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
  const snoozes = useTopic('snoozes') ?? NO_SNOOZES
  return (
    <ChatsPanel
      head={head} sidebar={useTopic('sidebar')} open={useTopic('open')} now={useNow(snoozes)} drafts={useChatDrafts()} snoozes={snoozes} live={useTopic('link')?.state === 'online'}
      onOpen={sessionId => void run({ do: 'open', ref: { kind: 'chat', sessionId } })}
      onRename={(sessionId, title) => run({ do: 'rename', sessionId, title })}
      onRetitle={sessionId => run({ do: 'retitle', sessionId })}
      onExport={(sessionId, format) => run({ do: 'export', sessionId, format })}
      onPin={(sessionId, pinned) => run({ do: 'pin', sessionId, pinned })}
      onSnooze={(sessionId, until) => run({ do: 'snooze', sessionId, until })}
      onArchive={sessionId => run({ do: 'archive', sessionId, archived: true })}
      onDelete={sessionId => run({ do: 'remove', sessionId })}
    />
  )
}

interface RowActions {
  readonly onOpen: (sessionId: SessionId) => void
  readonly onRename: (sessionId: SessionId, title: string) => Promise<CommandOutcome<unknown>>
  readonly onRetitle: (sessionId: SessionId) => Promise<CommandOutcome<string>>
  readonly onExport: (sessionId: SessionId, format: ExportFormat) => Promise<CommandOutcome<string | null>>
  readonly onPin: (sessionId: SessionId, pinned: boolean) => Promise<CommandOutcome<unknown>>
  /** `until` null wakes the chat. */
  readonly onSnooze: (sessionId: SessionId, until: number | null) => Promise<CommandOutcome<unknown>>
  readonly onArchive: (sessionId: SessionId) => Promise<CommandOutcome<unknown>>
  readonly onDelete: (sessionId: SessionId) => Promise<CommandOutcome<unknown>>
}

interface ChatsPanelProps extends RowActions {
  readonly head: ReactNode
  readonly sidebar: Sidebar | undefined
  readonly open: OpenChat | undefined
  readonly now: number
  readonly drafts: ReadonlySet<SessionId>
  readonly snoozes: Snoozes
  readonly live: boolean
}

/** Where a row's word sent it: out of the list, or into a group. */
type Moved = 'gone' | ChatGroup

/** The row whose menu is open, where it was in the list, and how far the list was scrolled. */
interface OpenMenu { readonly id: SessionId; readonly opener: Opener; readonly at: number; readonly scrolled: number }

export function ChatsPanel({ head, sidebar, open, now, drafts, snoozes, live, ...actions }: ChatsPanelProps) {
  const ids = useId()
  const view = chatsOf(sidebar, open, now, drafts, snoozes)
  const [said, setSaid] = useState<{ readonly words: string } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const [moved, setMoved] = useState<{ readonly id: SessionId; readonly at: number; readonly to: Moved } | null>(null)
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const sections = view.show === 'rows' ? sectionsOf(view) : []
  const rows = sections.flatMap(section => section.rows)
  const moreOf = (id: SessionId) => list.current?.querySelectorAll('.chat-item')[rows.findIndex(row => row.id === id)]?.querySelector<HTMLElement>('.chat-more')

  useEffect(() => {
    if (moved === null) return
    const at = rows.findIndex(row => row.id === moved.id)
    const arrived = moved.to === 'gone' ? at < 0 : rows[at]?.group === moved.to
    if (!arrived) return
    setMoved(null)
    // Focus on a button that left, or moved, falls to the page. Focus anywhere else is where the user went since.
    const { activeElement } = document
    if (activeElement !== null && activeElement !== document.body) return
    const drawn = list.current?.querySelectorAll<HTMLElement>('.chat-item') ?? []
    const target = moved.to === 'gone' ? drawn[Math.min(moved.at, drawn.length - 1)]?.querySelector<HTMLElement>('button.chat-row') : drawn[at]?.querySelector<HTMLElement>('.chat-more')
    ;(target ?? list.current)?.focus()
  })

  /** `focusMore`: give focus to the row's ⋯ first, as Escape does, so it never falls to the page. */
  const closeMenu = (focusMore: boolean) => {
    if (menu === null) return
    if (focusMore) moreOf(menu.id)?.focus({ preventScroll: true })
    setMenu(null)
  }
  const holdsFocus = () => list.current?.querySelector('.popup')?.contains(document.activeElement) === true
  const openMenu = (id: SessionId, at: number, opener: Opener) => {
    if (menu?.id === id && menu.opener.by === 'more' && opener.by === 'more') return closeMenu(true)
    setMenu({ id, opener, at, scrolled: list.current?.scrollTop ?? 0 })
  }
  useLayoutEffect(() => {
    if (menu !== null && (!live || rows.findIndex(row => row.id === menu.id) !== menu.at)) closeMenu(holdsFocus())
  })

  useEffect(() => {
    if (said === null) return
    const id = setTimeout(() => setSaid(null), SAVED_MS)
    return () => clearTimeout(id)
  }, [said])

  const item = (row: ChatRow) => {
    const at = rows.indexOf(row)
    // A session id is any word Hermes mints, so the ids come from the row's place.
    return (
      <ChatItem
        key={`chat:${row.id}`} row={row} ids={`${ids}-${at}`} live={live} {...actions} menuBy={menu?.id === row.id ? menu.opener : null}
        onMenu={opener => openMenu(row.id, at, opener)} onMenuClose={closeMenu} onSay={words => setSaid({ words })} onMoved={to => setMoved({ id: row.id, at, to })}
      />
    )
  }
  const drawn = sections.flatMap(({ group, heading, rows: held }) =>
    heading === null ? held.map(item) : [<h3 key={`group:${group}`} className="chats-group">{heading}</h3>, ...held.map(item)])
  return (
    <nav className="chats" aria-label="Chats">
      <div className="chats-head">{head}</div>
      <div
        ref={list} className="chats-list" tabIndex={-1} aria-busy={view.show === 'loading' || undefined}
        onScroll={event => { if (menu !== null && event.currentTarget.scrollTop !== menu.scrolled) closeMenu(holdsFocus()) }}
      >
        {view.show === 'note' && <p className="chats-note" role="status">{view.words}</p>}
        {/* One list of children, so a row that moves between the groups keeps its state. */}
        {drawn}
      </div>
      <p className="chats-note chats-saved" role="status">{said?.words ?? ''}</p>
    </nav>
  )
}

interface ChatItemProps extends RowActions {
  readonly row: ChatRow
  readonly ids: string
  readonly live: boolean
  /** What opened this row's menu. null: it is closed. */
  readonly menuBy: Opener | null
  readonly onMenu: (opener: Opener) => void
  readonly onMenuClose: (focusMore: boolean) => void
  readonly onSay: (words: string) => void
  readonly onMoved: (to: Moved) => void
}

function ChatItem({ row, ids, live, menuBy, onMenu, onMenuClose, onOpen, onRename, onRetitle, onExport, onPin, onSnooze, onArchive, onDelete, onSay, onMoved }: ChatItemProps) {
  const opener = useRef<HTMLButtonElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  // A menu key the row answers may still make the browser send a `contextmenu`, which must not open a second menu.
  const byKeys = useRef(false)
  const [naming, setNaming] = useState<'off' | 'typing' | 'saving'>('off')
  const [retitling, setRetitling] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [doing, when, preview] = [`${ids}-doing`, `${ids}-when`, `${ids}-preview`]
  const words = retitling ? NAMING : row.doing ?? (row.showsDraft ? DRAFT : null)

  useEffect(() => {
    if (live) return
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
  /** The menu closes onto ⋯, which stays in the page however the row moves after. */
  const leaveMenu = () => onMenuClose(true)
  const retitle = async () => {
    leaveMenu()
    if (retitling) return
    setRetitling(true)
    setRefused(null)
    const outcome = await onRetitle(row.id)
    setRetitling(false)
    setRefused(outcome.ok ? null : outcome.refusal.message)
    if (outcome.ok) onSay(`Renamed to ${outcome.value}`)
  }
  const exportAs = async (format: ExportFormat) => {
    leaveMenu()
    if (!live) return
    const outcome = await onExport(row.id, format)
    setRefused(outcome.ok ? null : outcome.refusal.message)
    if (outcome.ok && outcome.value !== null) onSay(`Saved ${baseName(outcome.value)}`)
  }
  const copyLink = () => {
    leaveMenu()
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
    leaveMenu()
    const outcome = await onPin(row.id, pinned)
    setRefused(outcome.ok ? null : outcome.refusal.message)
    onMoved(groupOf(outcome.ok ? pinned : row.pinned, row.group === 'snoozed'))
  }
  const snooze = async (until: number | null) => {
    leaveMenu()
    const outcome = await onSnooze(row.id, until)
    setRefused(outcome.ok ? null : outcome.refusal.message)
    if (!outcome.ok) return
    onSay(until === null ? `Woke ${row.name}` : `Snoozed until ${untilWords(until, Date.now())}`)
    onMoved(groupOf(row.pinned, until !== null))
  }
  /** A modal dialog makes the rest of the page inert, so it closes before focus goes back. */
  const stopConfirming = () => {
    flushSync(() => setConfirming(false))
    toggle.current?.focus()
  }
  const acts: Acts = {
    pin: () => void pin(true),
    unpin: () => void pin(false),
    wake: () => void snooze(null),
    rename: () => { onMenuClose(false); setRefused(null); setNaming('typing') },
    retitle: () => void retitle(),
    'export-md': () => void exportAs('md'),
    'export-json': () => void exportAs('json'),
    'export-html': () => void exportAs('html'),
    link: copyLink,
    archive: () => { leaveMenu(); void leave(onArchive, `Archived ${row.name}`) },
    delete: () => { onMenuClose(false); setConfirming(true) }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isMenuKey(event) || (event.target as Element).closest('.popup') !== null) return
    event.preventDefault()
    if (!live || confirming) return
    byKeys.current = true
    onMenu((event.target as Element).closest('.chat-more') === null ? { by: 'keys' } : { by: 'more' })
  }
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    if (byKeys.current) byKeys.current = false
    else if (live && !confirming) onMenu({ by: 'pointer', x: event.clientX, y: event.clientY })
  }

  const lines = (title: ReactNode) => (
    <>
      <span className="chat-top">
        {title}
        <span className="chat-when" id={when}>{row.when}</span>
      </span>
      <span className="chat-doing" id={doing} data-badge={retitling ? 'naming' : row.badge}>{words ?? ''}</span>
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
              onFocus={event => event.currentTarget.select()} onKeyDown={event => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  stopNaming()
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  void rename(event.currentTarget.value)
                }
              }}
              onBlur={event => event.currentTarget.disabled || setNaming('off')}
            />
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="chat-item" data-menu={menuBy !== null || undefined} onKeyDown={onKeyDown} onContextMenu={onContextMenu} onPointerDown={() => { byKeys.current = false }}>
      <button
        ref={opener} type="button" className="chat-row" aria-label={row.name} aria-describedby={`${doing} ${when} ${preview}`}
        aria-current={row.current || undefined} aria-busy={retitling || undefined} onClick={() => onOpen(row.id)}
      >
        {lines(<span className="chat-title">{row.name}</span>)}
      </button>
      <button
        ref={toggle} type="button" className="file-more chat-more" aria-label={`More for ${row.name}`} aria-haspopup="menu" aria-expanded={menuBy !== null}
        disabled={!live} onClick={() => onMenu({ by: 'more' })}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {menuBy !== null && <ChatMenu row={row} opener={menuBy} more={toggle} acts={acts} onSnooze={choice => void snooze(choice.until)} onClose={onMenuClose} />}
      {refused !== null && <p className="err">{refused}</p>}
      {confirming && (
        <RemoveDialog
          title={`Delete “${row.name}”?`} detail={DELETE_DETAIL} confirm="Delete" onCancel={stopConfirming}
          onConfirm={() => { flushSync(() => setConfirming(false)); void leave(onDelete, `Deleted ${row.name}`) }}
        />
      )}
    </div>
  )
}

/** Snooze opens its choices rather than acting. */
type Acts = { readonly [A in Exclude<RowAction, 'snooze'>]: () => void }

interface ChatMenuProps {
  readonly row: ChatRow
  readonly opener: Opener
  readonly more: RefObject<HTMLButtonElement | null>
  readonly acts: Acts
  readonly onSnooze: (choice: SnoozeChoice) => void
  readonly onClose: (focusMore: boolean) => void
}

/** At the pointer for a right-click, else under the row's ⋯. Escape and Tab close it onto ⋯. */
function ChatMenu({ row, opener, more, acts, onSnooze, onClose }: ChatMenuProps) {
  const [choices] = useState(() => snoozeChoices(new Date()))
  const groups = row.menu.map(group => group.map((action): PopupItem<RowAction | SnoozeId> => ({
    id: action, label: ACTION_LABELS[action], icon: ICONS[action],
    ...(action === 'snooze' ? { submenu: choices.map(choice => ({ id: choice.id, label: choice.label, hint: choice.when })) } : {})
  })))
  const choose = (id: RowAction | SnoozeId) => {
    const choice = choices.find(held => held.id === id)
    if (choice !== undefined) onSnooze(choice)
    else if (id !== 'snooze') acts[id as Exclude<RowAction, 'snooze'>]()
  }
  return (
    <PopupMenu
      key={JSON.stringify(opener)} label={`More for ${row.name}`} className="chat-menu" groups={groups}
      anchor={() => {
        const box = more.current?.getBoundingClientRect() ?? { left: 0, top: 0, right: 0, bottom: 0 }
        return anchorAt(opener, box, box.right)
      }}
      owns={target => more.current?.contains(target) === true} onChoose={choose} onClose={how => onClose(how !== 'away')}
    />
  )
}
