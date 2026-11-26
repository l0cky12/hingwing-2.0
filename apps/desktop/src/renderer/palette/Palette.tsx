import { shownChat, type Target } from '@highwing/hermes/domain'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Avatar } from '../bots/Avatar'
import { agoOf } from '../chats/chat-list'
import { isCommandKey } from '../keys'
import { run, useTopic } from '../store'
import { activeIn, paletteOf, step, type PaletteItem, type PaletteView, type Row } from './palette-view'

const composerBox = () => document.querySelector<HTMLTextAreaElement>('.composer textarea')

function detailOf(item: PaletteItem, now: number): string | null {
  switch (item.kind) {
    case 'chat': return item.doing ?? (item.lastActiveAt === null ? null : agoOf(item.lastActiveAt, now))
    case 'action': return item.keys
    case 'bot': return null
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

interface SheetProps {
  readonly target: Target | null
  readonly returnFocusTo: Element | null
  readonly onClose: () => void
}

function Sheet({ target, returnFocusTo, onClose }: SheetProps) {
  const sidebar = useTopic('sidebar')
  const bots = useTopic('bots')
  const open = useTopic('open')
  const link = useTopic('link')
  const sessionId = shownChat(open)?.sessionId ?? null
  const openSession = useTopic(sessionId === null ? null : `session:${sessionId}`)
  const [draftId] = useState(() => crypto.randomUUID())
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const leaving = useRef(false)
  const listId = useId()

  const view = paletteOf({ sidebar, bots, open, link, openSession, target, draftId }, query)
  const active = activeIn(view, picked)
  const activeId = active === null ? undefined : optionId(listId, active.item)

  useLayoutEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])
  useEffect(() => {
    if (activeId !== undefined) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  // The dialog closes first: while it is modal, nothing outside it can take focus.
  const dismiss = () => {
    leaving.current = true
    dialog.current?.close()
    const held = returnFocusTo instanceof HTMLElement && returnFocusTo !== document.body && returnFocusTo.isConnected ? returnFocusTo : composerBox()
    held?.focus()
    onClose()
  }
  const pick = (item: PaletteItem) => {
    leaving.current = true
    dialog.current?.close()
    onClose()
    void run(item.command).then(() => requestAnimationFrame(() => {
      if (document.activeElement === null || document.activeElement === document.body) composerBox()?.focus()
    }))
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
          onChange={event => { setQuery(event.target.value); setPicked(null) }}
        />
        <Results view={view} active={active} listId={listId} now={Date.now()} onPick={pick} />
        <p className="palette-hint"><span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span></p>
      </div>
    </dialog>
  )
}

/** Ctrl+K (Cmd+K on macOS) opens the palette over the chat window. */
export function Palette({ target }: { readonly target: Target | null }) {
  const [back, setBack] = useState<Element | null | undefined>(undefined)
  const opened = back !== undefined
  useEffect(() => {
    if (opened) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isCommandKey(event, 'k') || document.querySelector('dialog:modal') !== null) return
      event.preventDefault()
      if (!event.repeat) setBack(document.activeElement)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [opened])
  return back === undefined ? null : <Sheet target={target} returnFocusTo={back} onClose={() => setBack(undefined)} />
}
