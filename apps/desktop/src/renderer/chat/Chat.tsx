import { activityOf, modelViewOf, type ModelMenu, type ModelOption, type PromptId, type PromptReply, type SessionId } from '@highwing/hermes/domain'
import { threadView } from '@highwing/thread'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Composer } from '../composer/Composer'
import { ModelPicker } from '../composer/ModelPicker'
import { run, useTopic } from '../store'
import { FileCallContext, fileCallFor } from './FilePath'
import { FOLLOW_WITHIN, FOLLOWING, placeAfter, progressOf, type Place } from './place'
import { Thread } from './Thread'

const PAGE = 0.875
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const LONGEST_WAIT_MS = 60_000

const distanceFrom = (element: HTMLElement) => element.scrollHeight - element.scrollTop - element.clientHeight

const holdsText = (target: EventTarget | null) =>
  (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) && target.value !== ''

export function Chat({ id }: { readonly id: SessionId }) {
  const session = useTopic(`session:${id}`)
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

  const onAnswer = useCallback((promptId: PromptId, reply: PromptReply) => void run({ do: 'answer', sessionId: id, promptId, reply }), [id])
  const onLoadEarlier = useCallback(() => void run({ do: 'loadEarlier', sessionId: id }), [id])
  const onFindClosed = useCallback(() => composer.current?.focus(), [])

  const [menu, setMenu] = useState<{ readonly id: SessionId; readonly menu: ModelMenu | null }>({ id, menu: null })
  const live = session?.sync.state === 'live'
  const asked = useRef(0)
  const refreshModels = useCallback(async () => {
    const request = ++asked.current
    const outcome = await run({ do: 'models', sessionId: id })
    if (request !== asked.current) return
    const doesNotList = !outcome.ok && outcome.refusal.kind === 'unsupported'
    if (outcome.ok || doesNotList) setMenu({ id, menu: outcome.ok ? outcome.value : null })
  }, [id])
  useEffect(() => { if (live) void refreshModels() }, [live, refreshModels])
  const model = modelViewOf(menu.id === id ? menu.menu : null, session)
  const onPickModel = useCallback((pick: ModelOption, confirm: string | null) =>
    run({ do: 'pickModel', sessionId: id, model: pick, ...(confirm === null ? {} : { confirm }) }), [id])

  const fileCall = useMemo(() => fileCallFor(id), [id])

  return (
    <>
      <main id="scroll" ref={scroller} onScroll={onScroll}>
        {view !== null && (
          <FileCallContext value={fileCall}>
            <Thread view={view} onAnswer={onAnswer} onLoadEarlier={onLoadEarlier} onFindClosed={onFindClosed} onFindScrolled={onScroll} />
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
        key={id}
        inputRef={composer}
        canSend={session?.sync.state === 'live'}
        showStop={session !== undefined && activityOf(session).kind !== 'idle'}
        onSend={text => run({ do: 'send', sessionId: id, text })}
        onStop={() => void run({ do: 'stop', sessionId: id })}
        onInput={onInput}
      >
        {model.show !== 'hidden' && <ModelPicker key={id} view={model} onOpen={() => void refreshModels()} onPick={onPickModel} />}
      </Composer>
    </>
  )
}
