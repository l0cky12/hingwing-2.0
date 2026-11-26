import type { CommandOutcome, ShownGroup } from '@highwing/hermes/domain'
import { groupThread } from '@highwing/thread'
import { useLayoutEffect, useMemo, useReducer, useRef } from 'react'
import { distanceFrom, FOLLOW_WITHIN } from '../chat/place'
import { TIME_ZONE, useWakeAt } from '../chat/wake'
import { MentionHandles } from '../chat/text'
import { Composer, type ComposerGroup } from '../composer/Composer'
import { slotOf } from '../composer/drafts'
import { run, useTopic } from '../store'
import { GroupThread } from './GroupThread'
import { faceOf, namesFrom } from './group-rows'

const NOT_RUNNING = "Hermes isn't running group chats right now."

/** The open group: its thread and its composer. Attachments are off: Highwing sends a group text only. */
export function GroupPane({ shown }: { readonly shown: ShownGroup }) {
  const { group } = shown
  const chat = useTopic('groupChat')
  const bots = useTopic('bots')
  const groups = useTopic('groups')
  const online = useTopic('link')?.state === 'online'
  const [tick, wake] = useReducer((count: number) => count + 1, 0)
  const view = useMemo(() => groupThread(chat?.group === group ? chat : null, { now: Date.now(), timeZone: TIME_ZONE }, namesFrom(bots)), [chat, group, bots, tick])
  const thread = view.show === 'thread' ? view : null
  const row = groups?.state === 'listed' ? groups.rows.find(held => held.id === group) : undefined
  const seats = thread ?? row
  const stopped = groups?.state === 'listed' && !groups.driver

  useWakeAt(thread?.changesAt ?? null, tick, wake)

  const scroller = useRef<HTMLElement>(null)
  const following = useRef(true)
  const onScroll = () => {
    const element = scroller.current
    if (element !== null) following.current = distanceFrom(element) < FOLLOW_WITHIN
  }
  useLayoutEffect(() => {
    if (following.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [view])

  const handles = useMemo(() => new Set((seats?.members ?? []).map(member => member.handle.toLowerCase())), [seats?.members])
  const composer = useMemo((): ComposerGroup => ({
    name: seats?.name ?? 'the group chat',
    mentions: (seats?.members ?? []).map(member => ({ bot: faceOf(member, bots), word: `@${member.handle} ` })),
    busy: stopped ? NOT_RUNNING : thread?.busy ?? null
  }), [seats, bots, stopped, thread?.busy])

  const send = async (text: string): Promise<CommandOutcome<string | null>> => {
    const sent = await run({ do: 'sendToGroup', group, text })
    return sent.ok ? { ok: true, value: null } : sent
  }

  return (
    <>
      <main id="scroll" ref={scroller} onScroll={onScroll}>
        <MentionHandles value={handles}>
          <GroupThread view={view} faceOf={member => faceOf(member, bots)} />
        </MentionHandles>
      </main>
      <Composer
        slot={slotOf(shown)} group={composer} canAttach={false}
        canSend={online && thread !== null && !stopped} showStop={thread?.stoppable === true}
        onSend={send} onStop={() => void run({ do: 'stopGroup', group })} onInput={() => {}}
      />
    </>
  )
}
