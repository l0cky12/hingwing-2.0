import { activityOf, modelViewOf, type CommandOutcome, type ModelMenu, type PromptId, type PromptReply, type SessionId, type Shown } from '@highwing/hermes/domain'
import { threadView } from '@highwing/thread'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Composer } from '../composer/Composer'
import type { Editing } from '../composer/edit'
import { ModelPicker } from '../composer/ModelPicker'
import { run, useTopic } from '../store'
import { FileCallContext, fileCallFor, NO_FILE_CALL } from './FilePath'
import { ImageSessionContext } from './Image'
import { FOLLOW_WITHIN, FOLLOWING, placeAfter, progressOf, type Place } from './place'
import { Thread } from './Thread'

const PAGE = 0.875
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const LONGEST_WAIT_MS = 60_000

const distanceFrom = (element: HTMLElement) => element.scrollHeight - element.scrollTop - element.clientHeight

const holdsText = (target: EventTarget | null) =>
  (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) && target.value !== ''

/** `chat.sessionId` null: the chat is not started. The thread is empty, and the first message makes the session. */
export function Chat({ chat }: { readonly chat: Shown }) {
  const id = chat.sessionId
  const session = useTopic(id === null ? null : `session:${id}`)
  const [tick, wake] = useReducer((count: number) => count + 1, 0)
  const view = useMemo(() => (session === undefined ? null : threadView(session, { now: Date.now(), timeZone: TIME_ZONE })), [session, tick])
  const progress = useMemo(() => (view === null ? '' : progressOf(view)), [view])
  const scroller = useRef<HTMLElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const jumper = useRef<HTMLButtonElement>(null)
  const [place, setPlace] = useState<Place>(FOLLOWING)
  const following = useRef(true)
  const words = useId()

  following.current = place.kind === 'following'

  useEffect(() => {
    const at = view?.changesAt ?? null
    if (at === null) return
    // A timer does not count the time the machine sleeps, so a long wait is cut into short ones.
    const id = setTimeout(wake, Math.min(Math.max(0, at - Date.now()) + 25, LONGEST_WAIT_MS))
    return () => clearTimeout(id)
  }, [view])

  useLayoutEffect(() => {
    const element = scroller.current
    if (element === null) return
    if (following.current) element.scrollTop = element.scrollHeight
    else setPlace(held => placeAfter(held, distanceFrom(element), progress))
  }, [view, progress])

  useLayoutEffect(() => {
    const element = scroller.current
    if (element === null) return
    // `following` can be stale when a scroll lands in the same frame as the resize, and the old height misleads when the resize also reflows the thread, so either one keeps the thread at its end.
    let height = element.clientHeight
    const observer = new ResizeObserver(() => {
      if (following.current || element.scrollHeight - element.scrollTop - height < FOLLOW_WITHIN) {
        following.current = true
        setPlace(FOLLOWING)
        element.scrollTop = element.scrollHeight
      }
      height = element.clientHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const onScroll = useCallback(() => {
    const element = scroller.current
    if (element !== null) setPlace(held => placeAfter(held, distanceFrom(element), progress))
  }, [progress])

  // Pasting over a selection lays the box out empty between the delete and the insert. That clamps the thread's scroll with no net resize for the observer to see, and the clamp's scroll event would then stop following.
  const onInput = () => {
    const element = scroller.current
    if (element !== null && following.current) element.scrollTop = element.scrollHeight
  }

  const jump = useCallback(() => {
    const element = scroller.current
    if (element === null) return
    element.scrollTop = element.scrollHeight
    setPlace(FOLLOWING)
    if (document.activeElement === jumper.current) composer.current?.focus()
  }, [])

  useEffect(() => {
    const page = (direction: 1 | -1) => () => {
      const element = scroller.current
      if (element === null) return
      element.scrollBy({ top: direction * PAGE * element.clientHeight, behavior: 'instant' })
      onScroll()
    }
    const keys: Record<string, () => void> = { PageUp: page(-1), PageDown: page(1), End: jump }
    const onKeyDown = (event: KeyboardEvent) => {
      const act = keys[event.key]
      if (act === undefined || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (scroller.current?.checkVisibility() !== true) return
      if (event.target instanceof Node && scroller.current?.contains(event.target)) return
      if (holdsText(event.target)) return
      event.preventDefault()
      act()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [jump, onScroll])

  const asking = session !== undefined && activityOf(session).kind === 'asking'
  const shown = place.kind === 'reading' && place.far
  useLayoutEffect(() => {
    if (!shown && document.activeElement === jumper.current) composer.current?.focus()
  }, [shown])

  const notice = place.kind !== 'reading' ? '' : asking ? 'Waiting for your OK' : progress !== place.since ? 'New steps below' : ''

  const onAnswer = useCallback((promptId: PromptId, reply: PromptReply) => {
    if (id !== null) void run({ do: 'answer', sessionId: id, promptId, reply })
  }, [id])
  const onLoadEarlier = useCallback(() => {
    if (id !== null) void run({ do: 'loadEarlier', sessionId: id })
  }, [id])
  const onFindClosed = useCallback(() => composer.current?.focus(), [])

  const live = session?.sync.state === 'live'
  const idle = session !== undefined && activityOf(session).kind === 'idle'
  const waiting = view !== null && view.pending.some(message => message.status !== 'failed')
  const [held, setEditing] = useState<(Omit<Editing, 'later'> & { readonly id: SessionId | null }) | null>(null)
  const editedAt = held === null || held.id !== id || view === null ? -1 : view.turns.findIndex(turn => turn.rowId === held.rowId)
  const later = view === null ? 0 : view.turns.length - 1 - editedAt
  const editing = useMemo(() => (held === null || editedAt < 0 ? null : { ...held, later }), [held, editedAt, later])
  const [regenerating, setRegenerating] = useState<{ readonly id: SessionId | null; readonly refusal: string } | null>(null)
  const [rewriting, setRewriting] = useState(false)
  const presses = useRef(0)
  const canEdit = live === true && idle && !waiting && !rewriting
  const settled = view === null ? 0 : session?.run.state === 'running' ? view.turns.length - 1 : view.turns.length
  const regenerateTurn = view?.turns[settled - 1]
  const regenerateTurnKey = regenerateTurn?.rowId == null ? null : regenerateTurn.key

  const rewrite = useCallback(async (sessionId: SessionId, rowId: number, text: string) => {
    setRewriting(true)
    return run({ do: 'rewind', sessionId, rowId, text }).finally(() => setRewriting(false))
  }, [])
  const onEdit = useCallback((rowId: number, text: string) => {
    setRegenerating(null)
    setEditing({ id, press: ++presses.current, rowId, text })
  }, [id])
  const onRegenerate = useCallback(async (rowId: number, text: string) => {
    if (id === null) return
    setRegenerating(null)
    const outcome = await rewrite(id, rowId, text)
    if (!outcome.ok) setRegenerating({ id, refusal: outcome.refusal.message })
  }, [id, rewrite])
  const onSend = useCallback(async (text: string): Promise<CommandOutcome<string | null>> => {
    setRegenerating(null)
    if (chat.sessionId === null) return run({ do: 'start', chat, text })
    if (editing === null) return run({ do: 'send', sessionId: chat.sessionId, text })
    const { press } = editing
    const outcome = await rewrite(chat.sessionId, editing.rowId, text)
    if (!outcome.ok) return outcome
    setEditing(current => (current?.press === press ? null : current))
    return { ok: true, value: null }
  }, [chat, editing, rewrite])

  const [menu, setMenu] = useState<{ readonly id: SessionId | null; readonly menu: ModelMenu | null }>({ id, menu: null })
  const asked = useRef(0)
  const refreshModels = useCallback(async () => {
    if (id === null) return
    const request = ++asked.current
    const outcome = await run({ do: 'models', sessionId: id })
    if (request !== asked.current) return
    const doesNotList = !outcome.ok && outcome.refusal.kind === 'unsupported'
    if (outcome.ok || doesNotList) setMenu({ id, menu: outcome.ok ? outcome.value : null })
  }, [id])
  useEffect(() => { if (live) void refreshModels() }, [live, refreshModels])
  const model = modelViewOf(menu.id === id ? menu.menu : null, session)

  const fileCall = useMemo(() => (id === null ? NO_FILE_CALL : fileCallFor(id)), [id])

  return (
    <>
      <main id="scroll" ref={scroller} onScroll={onScroll}>
        {view !== null && (
          <FileCallContext value={fileCall}>
            <ImageSessionContext value={id}>
              <Thread
                view={view} onAnswer={onAnswer} onLoadEarlier={onLoadEarlier} onFindClosed={onFindClosed} onFindScrolled={onScroll}
                canEdit={canEdit} regenerateTurnKey={regenerateTurnKey} canRegenerate={canEdit && editing === null} onEdit={onEdit} onRegenerate={onRegenerate}
              />
            </ImageSessionContext>
          </FileCallContext>
        )}
      </main>
      <div className={`jump${shown ? ' shown' : ''}${asking ? ' asking' : ''}`}>
        <button ref={jumper} type="button" aria-label="Jump to latest" aria-describedby={words} onClick={jump}>
          <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12"><path d="M6 2v8M2.5 6.5 6 10l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span id={words} role="status">{notice}</span>
      </div>
      <Composer
        inputRef={composer}
        autoFocus={chat.kind === 'new' && chat.sessionId === null}
        canSend={id === null || live}
        showStop={session !== undefined && activityOf(session).kind !== 'idle'}
        onSend={onSend}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onStop={() => { if (id !== null) void run({ do: 'stop', sessionId: id }) }}
        onInput={onInput}
      >
        {id !== null && model.show !== 'hidden' && (
          <ModelPicker
            key={id} view={model} onOpen={() => void refreshModels()}
            onPick={(pick, confirm) => run({ do: 'pickModel', sessionId: id, model: pick, ...(confirm === null ? {} : { confirm }) })}
          />
        )}
        {regenerating !== null && regenerating.id === id && <p className="err refusal">{regenerating.refusal}</p>}
      </Composer>
    </>
  )
}
