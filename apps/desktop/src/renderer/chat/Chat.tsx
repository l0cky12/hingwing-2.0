import { activityOf, type PromptId, type PromptReply, type SessionId } from '@highwing/hermes/domain'
import { threadView } from '@highwing/thread'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { Composer } from '../composer/Composer'
import { run, useTopic } from '../store'
import { Thread } from './Thread'

/** One chat: reads one session value and sends commands as data. */
export function Chat({ id }: { readonly id: SessionId }) {
  const session = useTopic(`session:${id}`)
  const view = useMemo(() => (session === undefined ? null : threadView(session)), [session])
  const scroller = useRef<HTMLElement>(null)
  const stuck = useRef(true)

  useLayoutEffect(() => {
    const element = scroller.current
    if (element !== null && stuck.current) element.scrollTop = element.scrollHeight
  }, [view])

  const onScroll = () => {
    const element = scroller.current
    if (element !== null) stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60
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
      />
    </>
  )
}
