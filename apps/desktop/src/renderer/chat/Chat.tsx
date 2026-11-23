import { activityOf, type PromptId, type PromptReply, type SessionId } from '@highwing/hermes/domain'
import { threadView } from '@highwing/thread'
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react'
import { Composer } from '../composer/Composer'
import { run, useTopic } from '../store'
import { Thread } from './Thread'

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const LONGEST_WAIT_MS = 60_000

export function Chat({ id }: { readonly id: SessionId }) {
  const session = useTopic(`session:${id}`)
  const [tick, wake] = useReducer((count: number) => count + 1, 0)
  const view = useMemo(() => (session === undefined ? null : threadView(session, { now: Date.now(), timeZone: TIME_ZONE })), [session, tick])
  const scroller = useRef<HTMLElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const stuck = useRef(true)

  useEffect(() => {
    const at = view?.changesAt ?? null
    if (at === null) return
    // A timer does not count the time the machine sleeps, so a long wait is cut into short ones.
    const id = setTimeout(wake, Math.min(Math.max(0, at - Date.now()) + 25, LONGEST_WAIT_MS))
    return () => clearTimeout(id)
  }, [view])

  useLayoutEffect(() => {
    const element = scroller.current
    if (element !== null && stuck.current) element.scrollTop = element.scrollHeight
  }, [view])

  const onScroll = useCallback(() => {
    const element = scroller.current
    if (element !== null) stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60
  }, [])
  const onAnswer = useCallback((promptId: PromptId, reply: PromptReply) => void run({ do: 'answer', sessionId: id, promptId, reply }), [id])
  const onLoadEarlier = useCallback(() => void run({ do: 'loadEarlier', sessionId: id }), [id])
  const onFindClosed = useCallback(() => composer.current?.focus(), [])

  return (
    <>
      <main id="scroll" ref={scroller} onScroll={onScroll}>
        {view !== null && (
          <Thread view={view} onAnswer={onAnswer} onLoadEarlier={onLoadEarlier} onFindClosed={onFindClosed} onFindScrolled={onScroll} />
        )}
      </main>
      <Composer
        inputRef={composer}
        canSend={session?.sync.state === 'live'}
        showStop={session !== undefined && activityOf(session).kind !== 'idle'}
        onSend={text => run({ do: 'send', sessionId: id, text })}
        onStop={() => void run({ do: 'stop', sessionId: id })}
      />
    </>
  )
}
