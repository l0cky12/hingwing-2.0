import { activityOf, modelViewOf, type ModelMenu, type ModelOption, type PromptId, type PromptReply, type SessionId } from '@highwing/hermes/domain'
import { threadView } from '@highwing/thread'
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Composer } from '../composer/Composer'
import { ModelPicker } from '../composer/ModelPicker'
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
      >
        {model.show !== 'hidden' && <ModelPicker key={id} view={model} onOpen={() => void refreshModels()} onPick={onPickModel} />}
      </Composer>
    </>
  )
}
