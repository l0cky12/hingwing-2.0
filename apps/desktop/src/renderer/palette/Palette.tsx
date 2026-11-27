import { shownChat, type Target } from '@highwing/hermes/domain'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { WindowCommand } from '../../ipc-contract'
import { Avatar } from '../bots/Avatar'
import { agoOf } from '../chats/chat-list'
import { landAt } from '../chat/landing'
import { isCommandKey } from '../keys'
import { run, useTopic } from '../store'
import { begin, NOT_SEARCHED, settle, type MessageSearch } from './messages'
import { activeIn, comebackOf, paletteOf, step, termsOf, type PaletteItem, type PaletteView, type Row } from './palette-view'

const canHoldFocus = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement && element !== document.body && element.isConnected && element.closest('[hidden]') === null
  && element.checkVisibility() && !element.matches(':disabled')
/** Settings hides the chat's composer. Its connection card's Change takes focus there, or the Settings heading while the editor is open. */
const FALLBACKS = ['.settings .change', '.settings > h2', '.composer textarea']
const fallbackFocus = () => FALLBACKS.map(selector => document.querySelector(selector)).find(canHoldFocus) ?? null

function detailOf(item: PaletteItem, now: number): string | null {
  switch (item.kind) {
    case 'chat': return item.doing ?? (item.lastActiveAt === null ? null : agoOf(item.lastActiveAt, now))
    case 'action': return item.keys
    case 'bot': return null
    case 'message': return item.bot
    case 'status': return item.detail
  }
}

interface ResultsProps {
  readonly view: PaletteView
  readonly active: Row | null
  readonly listId: string
  readonly now: number
  readonly onPick: (item: PaletteItem) => void
}

const optionId = (listId: string, item: PaletteItem) => `${listId}-${item.key}`

export function Results({ view, active, listId, now, onPick }: ResultsProps) {
  if (view.show === 'note') return <p className="palette-note" role="status">{view.words}</p>
  return (
    <div className="palette-list" role="listbox" id={listId} aria-label="Results">
      {view.sections.map(({ heading, rows }) => (
        <div key={heading} role="group" aria-label={heading}>
          <p className="palette-heading" aria-hidden="true">{heading}</p>
          {rows.map(({ item, excerpt }) => {
            const id = optionId(listId, item)
            const detail = detailOf(item, now)
            const described = [detail === null ? null : `${id}-detail`, excerpt === null ? null : `${id}-excerpt`].filter(part => part !== null).join(' ')
            return (
              <div
                key={item.key} id={id} role="option" aria-selected={item.key === active?.item.key} aria-label={item.title}
                aria-disabled={item.kind === 'status' && item.reads === null ? true : undefined}
                aria-describedby={described === '' ? undefined : described}
                className={item.key === active?.item.key ? `palette-row ${item.kind} active` : `palette-row ${item.kind}`} onClick={() => onPick(item)}
              >
                {item.kind === 'bot' && <Avatar bot={item.bot} size={22} />}
                <span className="palette-title">{item.title}</span>
                {detail !== null && <span className="palette-detail" id={`${id}-detail`} data-badge={item.kind === 'chat' && item.doing !== null ? item.badge : undefined}>{detail}</span>}
                {excerpt !== null && <span className="palette-excerpt" id={`${id}-excerpt`}>{excerpt}</span>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** A sheet to show: where focus was when Ctrl+K opened it, and the query it opens with. */
interface Opened {
  readonly back: Element | null
  readonly query: string
  /** Why main refused the pick the sheet came back for. */
  readonly note: string | null
}

interface SheetProps {
  readonly opened: Opened
  readonly target: Target | null
  readonly settingsOpen: boolean
  readonly onClose: () => void
  readonly onPick: (command: WindowCommand, query: string) => void
}

function Sheet({ opened, target, settingsOpen, onClose, onPick }: SheetProps) {
  const sidebar = useTopic('sidebar')
  const bots = useTopic('bots')
  const open = useTopic('open')
  const link = useTopic('link')
  const sessionId = shownChat(open)?.sessionId ?? null
  const openSession = useTopic(sessionId === null ? null : `session:${sessionId}`)
  const [draftId] = useState(() => crypto.randomUUID())
  const [query, setQuery] = useState(opened.query)
  const [note, setNote] = useState(opened.note)
  const [picked, setPicked] = useState<string | null>(null)
  const [search, setSearch] = useState<MessageSearch>(NOT_SEARCHED)
  const dialog = useRef<HTMLDialogElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const leaving = useRef(false)
  const listId = useId()

  const view: PaletteView = note === null ? paletteOf({ sidebar, bots, open, link, openSession, target, settingsOpen, draftId }, query, search) : { show: 'note', words: note }
  const active = activeIn(view, picked)
  const activeId = active === null ? undefined : optionId(listId, active.item)

  useLayoutEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])
  const readMessages = (from: number) => {
    setSearch(held => begin(held, from))
    void run({ do: 'readMessages', step: from }).then(outcome => setSearch(held => settle(held, from, outcome)))
  }
  const typed = query.trim() !== ''
  useEffect(() => {
    if (typed && search.state === 'idle') readMessages(0)
  }, [typed, search.state])
  useEffect(() => {
    if (activeId !== undefined) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  // The dialog closes first: while it is modal, nothing outside it can take focus.
  const dismiss = () => {
    leaving.current = true
    dialog.current?.close()
    const held = canHoldFocus(opened.back) ? opened.back : fallbackFocus()
    held?.focus()
    onClose()
  }
  const pick = (item: PaletteItem) => {
    if (item.kind === 'status') {
      if (item.reads !== null) readMessages(item.reads)
      return
    }
    if (item.kind === 'message' && item.landing !== null) landAt(item.landing, termsOf(query))
    leaving.current = true
    dialog.current?.close()
    onPick(item.command, query)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    event.stopPropagation()
    if (event.nativeEvent.isComposing) return
    const by = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : null
    if (isCommandKey(event.nativeEvent, 'k')) {
      if (!event.repeat) dismiss()
    } else if (by !== null) setPicked(step(view, picked, by))
    else if (event.key === 'Enter' && active !== null) pick(active.item)
    else if (event.key !== 'Tab') return
    event.preventDefault()
  }
  const keepFocusInField = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== field.current) event.preventDefault()
  }
  const closeOnBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) dismiss()
  }

  return (
    <dialog
      ref={dialog} className="palette" aria-label="Command palette"
      onCancel={event => { event.preventDefault(); dismiss() }}
      // The browser closes it outright, with no cancel, when no click or key came since its last cancel.
      onClose={() => { if (!leaving.current) dismiss() }}
      onKeyDown={onKeyDown} onMouseDown={keepFocusInField} onClick={closeOnBackdrop}
    >
      <div className="palette-sheet">
        <input
          ref={field} type="text" className="palette-field" role="combobox" aria-label="Search chats, bots and actions" autoFocus
          spellCheck={false} autoComplete="off" placeholder="Search chats, bots and actions" value={query}
          aria-expanded={view.show === 'rows'} aria-controls={view.show === 'rows' ? listId : undefined} aria-activedescendant={activeId} aria-autocomplete="list"
          onChange={event => { setQuery(event.target.value); setPicked(null); setNote(null) }}
        />
        <Results view={view} active={active} listId={listId} now={Date.now()} onPick={pick} />
        <p className="palette-hint"><span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span></p>
      </div>
    </dialog>
  )
}

export function Palette({ target, settingsOpen }: { readonly target: Target | null; readonly settingsOpen: boolean }) {
  const [opened, setOpened] = useState<Opened | null>(null)
  const shown = opened !== null
  useEffect(() => {
    if (shown) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isCommandKey(event, 'k') || document.querySelector('dialog:modal') !== null) return
      event.preventDefault()
      if (!event.repeat) setOpened({ back: document.activeElement, query: '', note: null })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shown])
  // The sheet goes before main answers: Hermes can take a while to open a bot, and while the sheet is modal the chat a pick opens cannot take focus.
  const pick = (back: Element | null, command: WindowCommand, query: string) => {
    setOpened(null)
    void run(command).then(outcome => {
      const note = comebackOf(outcome)
      if (note !== null) setOpened(held => held ?? { back, query, note })
      else requestAnimationFrame(() => { if (!canHoldFocus(document.activeElement)) fallbackFocus()?.focus() })
    })
  }
  return opened === null ? null : (
    <Sheet opened={opened} target={target} settingsOpen={settingsOpen} onClose={() => setOpened(null)} onPick={(command, query) => pick(opened.back, command, query)} />
  )
}
