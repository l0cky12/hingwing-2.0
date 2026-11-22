import { activityOf, type PromptId, type PromptReply, type SessionId } from '@highwing/hermes/domain'
import { threadView } from '@highwing/thread'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { Composer } from '../composer/Composer'
import { run, useTopic } from '../store'
import { Thread } from './Thread'

const NEAR_END = 60

export function Chat({ id }: { readonly id: SessionId }) {
  const session = useTopic(`session:${id}`)
  const view = useMemo(() => (session === undefined ? null : threadView(session)), [session])
  const scroller = useRef<HTMLElement>(null)
  const stuck = useRef(true)

  useLayoutEffect(() => {
    const element = scroller.current
    if (element !== null && stuck.current) element.scrollTop = element.scrollHeight
  }, [view])

  useLayoutEffect(() => {
    const element = scroller.current
    if (element === null) return
    // `stuck` can be stale when a scroll lands in the same frame as the resize, and the old height misleads when the resize also reflows the thread, so either one keeps the thread at its end.
    let height = element.clientHeight
    const observer = new ResizeObserver(() => {
      if (stuck.current || element.scrollHeight - element.scrollTop - height < NEAR_END) {
        stuck.current = true
        element.scrollTop = element.scrollHeight
      }
      height = element.clientHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const onScroll = () => {
    const element = scroller.current
    if (element !== null) stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_END
  }
  // Pasting over a selection lays the box out empty between the delete and the insert. That clamps the thread's scroll with no net resize for the observer to see, and the clamp's scroll event would then clear `stuck`.
  const onInput = () => {
    const element = scroller.current
    if (element !== null && stuck.current) element.scrollTop = element.scrollHeight
  }
  const onAnswer = useCallback((promptId: PromptId, reply: PromptReply) => void run({ do: 'answer', sessionId: id, promptId, reply }), [id])
  const onLoadEarlier = useCallback(() => void run({ do: 'loadEarlier', sessionId: id }), [id])

  return (
    <>
      <main id="scroll" ref={scroller} onScroll={onScroll}>
        {view !== null && (
          <Thread view={view} onAnswer={onAnswer} onLoadEarlier={onLoadEarlier} />
        )}
      </main>
      <Composer
        canSend={session?.sync.state === 'live'}
        showStop={session !== undefined && activityOf(session).kind !== 'idle'}
        onSend={text => run({ do: 'send', sessionId: id, text })}
        onStop={() => void run({ do: 'stop', sessionId: id })}
        onInput={onInput}
      />
    </>
  )
}
