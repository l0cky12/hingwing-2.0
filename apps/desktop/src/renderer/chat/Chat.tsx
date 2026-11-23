import { activityOf, type PromptId, type PromptReply, type SessionId } from '@highwing/hermes/domain'
import { threadView } from '@highwing/thread'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Composer } from '../composer/Composer'
import { run, useTopic } from '../store'
import { FOLLOWING, placeAfter, progressOf, type Place } from './place'
import { Thread } from './Thread'

const PAGE = 0.875

const distanceFrom = (element: HTMLElement) => element.scrollHeight - element.scrollTop - element.clientHeight

const holdsText = (target: EventTarget | null) =>
  (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) && target.value !== ''

export function Chat({ id }: { readonly id: SessionId }) {
  const session = useTopic(`session:${id}`)
  const view = useMemo(() => (session === undefined ? null : threadView(session)), [session])
  const progress = useMemo(() => (view === null ? '' : progressOf(view)), [view])
  const scroller = useRef<HTMLElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const jumper = useRef<HTMLButtonElement>(null)
  const [place, setPlace] = useState<Place>(FOLLOWING)
  const following = useRef(true)
  const words = useId()

  following.current = place.kind === 'following'

  useLayoutEffect(() => {
    const element = scroller.current
    if (element === null) return
    if (following.current) element.scrollTop = element.scrollHeight
    else setPlace(held => placeAfter(held, distanceFrom(element), progress))
  }, [view, progress])

  const onScroll = useCallback(() => {
    const element = scroller.current
    if (element !== null) setPlace(held => placeAfter(held, distanceFrom(element), progress))
  }, [progress])

  const jump = useCallback(() => {
    const element = scroller.current
    if (element === null) return
    element.scrollTop = element.scrollHeight
    setPlace(FOLLOWING)
    if (document.activeElement === jumper.current) field.current?.focus()
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
    if (!shown && document.activeElement === jumper.current) field.current?.focus()
  }, [shown])

  const notice = place.kind !== 'reading' ? '' : asking ? 'Waiting for your OK' : progress !== place.since ? 'New steps below' : ''

  const onAnswer = useCallback((promptId: PromptId, reply: PromptReply) => void run({ do: 'answer', sessionId: id, promptId, reply }), [id])
  const onLoadEarlier = useCallback(() => void run({ do: 'loadEarlier', sessionId: id }), [id])

  return (
    <>
      <main id="scroll" ref={scroller} onScroll={onScroll}>
        {view !== null && (
          <Thread view={view} onAnswer={onAnswer} onLoadEarlier={onLoadEarlier} />
        )}
      </main>
      <div className={`jump${shown ? ' shown' : ''}${asking ? ' asking' : ''}`}>
        <button ref={jumper} type="button" aria-label="Jump to latest" aria-describedby={words} onClick={jump}>
          <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12"><path d="M6 2v8M2.5 6.5 6 10l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span id={words} role="status">{notice}</span>
      </div>
      <Composer
        field={field}
        canSend={session?.sync.state === 'live'}
        showStop={session !== undefined && activityOf(session).kind !== 'idle'}
        onSend={text => run({ do: 'send', sessionId: id, text })}
        onStop={() => void run({ do: 'stop', sessionId: id })}
      />
    </>
  )
}
