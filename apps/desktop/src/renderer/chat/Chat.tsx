import { activityOf, modelViewOf, sendPlan, type Attachment, type AttachmentId, type BackgroundProcess, type BranchId, type ChatVersions, type CommandOutcome, type HelperId, type ModelMenu, type PromptId, type PromptReply, type QueuedAction, type Relay, type SessionId, type Shown, type SideId, type TurnId, type Version } from '@highwing/hermes/domain'
import { threadView } from '@highwing/thread'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { isLocal } from '../../ipc-contract'
import { Composer } from '../composer/Composer'
import { carryToNewChat, slotOf } from '../composer/drafts'
import { ContextMeter } from '../composer/ContextMeter'
import { editingOf, type EditTarget } from '../composer/edit'
import { FolderChip } from '../composer/FolderChip'
import { ModelPicker } from '../composer/ModelPicker'
import { StatusStack } from '../composer/StatusStack'
import { ThinkingPill } from '../composer/ThinkingPill'
import { folderFieldLabel, thinkingShown } from '../composer/tuning'
import { YoloPill } from '../composer/YoloPill'
import { run, useTopic } from '../store'
import { FileCallContext, fileCallFor, FilesHereContext, NO_FILE_CALL } from './FilePath'
import type { HelperControls } from './Helpers'
import { ImageSessionContext } from './Image'
import { forget, landAt, landed, pressFor } from './landing'
import { marked, pressedOf, unmarked } from './marks'
import { distanceFrom, FOLLOW_WITHIN, FOLLOWING, jumpWords, placeAfter, progressOf, type Place } from './place'
import type { RequestAnswer } from './Asks'
import { Sides } from './Sides'
import { closeSide, sortSides, useClosedSides } from './sides'
import { useTail } from './tail'
import { Thread, type QueueControls, type QueuedRow } from './Thread'
import { TIME_ZONE, useWakeAt } from './wake'

const PAGE = 0.875
const NO_RELAYS: readonly Relay[] = []
const NO_VERSIONS: ChatVersions = []
const NO_PROCESSES: readonly BackgroundProcess[] = []

type Held = { readonly id: SessionId | null } & EditTarget

const holdsText = (target: EventTarget | null) =>
  (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) && target.value !== ''

/** `chat.sessionId` null: the chat is not started. The thread is empty, and the first message makes the session. */
export function Chat({ chat }: { readonly chat: Shown }) {
  const id = chat.sessionId
  const session = useTopic(id === null ? null : `session:${id}`)
  const relays = useTopic('relay')?.bySession[id ?? ''] ?? NO_RELAYS
  const [tick, wake] = useReducer((count: number) => count + 1, 0)
  const view = useMemo(() => (session === undefined ? null : threadView(session, { now: Date.now(), timeZone: TIME_ZONE })), [session, tick])
  const closed = useClosedSides(id)
  const { cards, rows } = useMemo(() => sortSides(session?.sides ?? [], closed), [session?.sides, closed])
  const drawn = useTail(view, relays, rows)
  const progress = useMemo(() => (drawn === null ? '' : progressOf(drawn.view, drawn.sides)), [drawn])
  const whole = drawn?.whole === true
  const scroller = useRef<HTMLElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const jumper = useRef<HTMLButtonElement>(null)
  const [place, setPlace] = useState<Place>(FOLLOWING)
  const following = useRef(true)
  const words = useId()

  following.current = place.kind === 'following'

  useWakeAt(view?.changesAt ?? null, tick, wake)

  const [read, setRead] = useState<{ readonly id: SessionId; readonly versions: ChatVersions } | null>(null)
  useEffect(() => {
    if (id === null) return
    let open = true
    void run({ do: 'versions', sessionId: id }).then(outcome => {
      if (open && outcome.ok) setRead({ id, versions: outcome.value })
    })
    return () => {
      open = false
      landed(id)
    }
  }, [id])
  const versions = read !== null && read.id === id ? read.versions : NO_VERSIONS
  const onVersion = useCallback((version: Version) => {
    landAt(version)
    void run({ do: 'open', ref: { kind: 'chat', sessionId: version.sessionId } })
  }, [])

  useLayoutEffect(() => {
    const element = scroller.current
    if (element === null) return
    if (following.current) element.scrollTop = element.scrollHeight
    else setPlace(held => placeAfter(held, distanceFrom(element), progress))
  }, [drawn, progress, versions])

  const [paging, setPaging] = useState(false)
  useLayoutEffect(() => {
    const element = scroller.current
    const press = id === null ? null : pressFor(id)
    if (element === null || id === null || press === null || view === null || view.turns.length === 0) return
    if (press.landing === 'end') return landed(id)
    if (!whole) return
    const request = element.querySelector(`.turn[data-row="${press.landing}"] > .request`)
    if (request === null) {
      if (view.earlier === 'none') landed(id)
      else if (view.earlier === 'more' && !paging) {
        setPaging(true)
        void run({ do: 'loadEarlier', sessionId: id }).then(outcome => {
          if (!outcome.ok) forget(press)
          setPaging(false)
        })
      }
      return
    }
    landed(id)
    request.scrollIntoView({ block: 'center', behavior: 'instant' })
    setPlace(held => placeAfter(held, distanceFrom(element), progress))
  }, [id, view, whole, progress, paging])

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

  const activity = session === undefined ? null : activityOf(session).kind
  const shown = place.kind === 'reading' && place.far
  useLayoutEffect(() => {
    if (!shown && document.activeElement === jumper.current) composer.current?.focus()
  }, [shown])

  const waitsOnYou = activity === 'asking' || activity === 'answering'
  const notice = jumpWords(place, activity, progress)

  const onAnswer = useCallback(async (promptId: PromptId, reply: PromptReply) => {
    if (id === null) return undefined
    const outcome = await run({ do: 'answer', sessionId: id, promptId, reply })
    return outcome.ok ? outcome.value : undefined
  }, [id])
  const onAnswerRequest = useCallback<RequestAnswer>(async (requestId, reply) => id !== null && (await run({ do: 'answer', sessionId: id, requestId, reply })).ok, [id])
  const onLoadEarlier = useCallback(() => {
    if (id !== null) void run({ do: 'loadEarlier', sessionId: id })
  }, [id])
  const onFindClosed = useCallback(() => composer.current?.focus(), [])

  const live = session?.sync.state === 'live'
  const idle = session?.run.state === 'idle'
  const waiting = view !== null && view.pending.some(message => message.status !== 'failed')
  const listed = useMemo(() => new Map((view?.pending ?? []).flatMap(row => ('admissionId' in row ? [[row.admissionId, row] as const] : []))), [view])
  const [held, setEditing] = useState<Held | null>(null)
  const editing = useMemo(() => (held === null || held.id !== id ? null : editingOf(held, view?.turns ?? [], listed)), [held, id, view, listed])
  const [marks, dispatchMark] = useReducer(marked, listed, unmarked)
  if (marks.listed !== listed) dispatchMark({ kind: 'listed', listed })
  const pressed = useMemo(() => pressedOf(marks), [marks])
  const mark = useCallback((row: QueuedRow, action: QueuedAction | null) => dispatchMark(action === null ? { kind: 'refused', row } : { kind: 'pressed', row, action }), [])
  const [refused, setRefused] = useState<{ readonly id: SessionId | null; readonly message: string } | null>(null)
  const [rewriting, setRewriting] = useState(false)
  const [branching, setBranching] = useState(false)
  const branchKeys = useRef(new Map<number, BranchId>())
  const presses = useRef(0)
  const canEdit = live === true && idle && !waiting && !rewriting
  const canBranch = canEdit && !branching
  const settled = view === null ? 0 : session?.run.state === 'running' ? view.turns.length - 1 : view.turns.length
  const regenerateTurn = view?.turns[settled - 1]
  const regenerateTurnKey = regenerateTurn?.rowId == null ? null : regenerateTurn.key

  const rewrite = useCallback(async (sessionId: SessionId, rowId: number, text: string) => {
    setRewriting(true)
    return run({ do: 'rewind', sessionId, rowId, text }).finally(() => setRewriting(false))
  }, [])
  const onEdit = useCallback((rowId: number, text: string) => {
    setRefused(null)
    setEditing({ id, kind: 'sent', press: ++presses.current, rowId, text })
  }, [id])
  const onQueued = useCallback(async (row: QueuedRow, action: QueuedAction) => {
    if (id === null) return
    setRefused(null)
    if (action === 'edit') {
      setEditing({ id, kind: 'queued', press: ++presses.current, admissionId: row.admissionId, text: row.text })
      return
    }
    mark(row, action)
    const outcome = await run({ do: 'queued', sessionId: id, admissionId: row.admissionId, action })
    if (!outcome.ok) {
      mark(row, null)
      setRefused({ id, message: outcome.refusal.message })
    }
  }, [id, mark])
  const onRegenerate = useCallback(async (rowId: number, text: string) => {
    if (id === null) return
    setRefused(null)
    const outcome = await rewrite(id, rowId, text)
    if (!outcome.ok) setRefused({ id, message: outcome.refusal.message })
  }, [id, rewrite])
  const onBranch = useCallback(async (rowId: number) => {
    if (id === null) return
    setRefused(null)
    const branchId = branchKeys.current.get(rowId) ?? crypto.randomUUID() as BranchId
    branchKeys.current.set(rowId, branchId)
    setBranching(true)
    const outcome = await run({ do: 'branch', sessionId: id, rowId, branchId })
    setBranching(false)
    if (outcome.ok || outcome.refusal.kind !== 'offline') branchKeys.current.delete(rowId)
    if (!outcome.ok) setRefused({ id, message: outcome.refusal.message })
  }, [id])
  const onNewChat = useCallback((text: string) => {
    carryToNewChat(chat.bot, text)
    void run({ do: 'open', ref: { kind: 'new', bot: chat.bot, draftId: crypto.randomUUID() } })
  }, [chat.bot])
  const onReact = useCallback(async (turn: TurnId, emoji: string | null) => {
    if (id === null) return
    setRefused(null)
    const outcome = await run({ do: 'react', sessionId: id, turn, emoji })
    if (!outcome.ok) setRefused({ id, message: outcome.refusal.message })
  }, [id])
  const onSend = useCallback(async (text: string, attachments: readonly AttachmentId[]): Promise<CommandOutcome<string | null>> => {
    setRefused(null)
    if (chat.sessionId === null) return run({ do: 'start', chat, text, attachments })
    if (editing === null) return run({ do: 'send', sessionId: chat.sessionId, text, attachments })
    const { press } = editing
    if (editing.kind === 'gone') return { ok: false, refusal: { kind: 'stale', message: editing.why } }
    if (editing.kind === 'sent') {
      const outcome = await rewrite(chat.sessionId, editing.rowId, text)
      if (!outcome.ok) return outcome
    } else {
      const row = listed.get(editing.admissionId)
      if (row !== undefined) mark(row, 'edit')
      const outcome = await run({ do: 'queued', sessionId: chat.sessionId, admissionId: editing.admissionId, action: 'edit', text })
      if (!outcome.ok) {
        if (row !== undefined) mark(row, null)
        return outcome
      }
    }
    setEditing(current => (current?.press === press ? null : current))
    return { ok: true, value: null }
  }, [chat, editing, rewrite, listed, mark])
  const queue = useMemo((): QueueControls => ({ canAct: live, pressed, onAct: onQueued }), [live, pressed, onQueued])
  const [stopping, setStopping] = useState<ReadonlySet<HelperId>>(new Set())
  const onStopHelper = useCallback(async (helperId: HelperId) => {
    if (id === null) return
    setRefused(null)
    setStopping(held => new Set(held).add(helperId))
    const outcome = await run({ do: 'stopHelper', sessionId: id, helperId })
    if (outcome.ok) return
    setStopping(held => new Set([...held].filter(other => other !== helperId)))
    setRefused({ id, message: outcome.refusal.message })
  }, [id])
  const helpers = useMemo((): HelperControls | null => (live ? { stopping, onStop: helperId => void onStopHelper(helperId) } : null), [live, stopping, onStopHelper])

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
  const fill = session?.usage.context ?? null
  const yolo = id !== null && live ? (session?.tuning.yolo ?? null) : null
  const online = useTopic('link')?.state === 'online'
  const planFor = (held: readonly Attachment[]) => (session !== undefined && live ? sendPlan(session, held).by : 'submit')
  const tuning = session !== undefined && thinkingShown(session.tuning) ? session.tuning : null
  const cwd = session?.cwd ?? null
  const setup = useTopic('setup')
  const target = setup === undefined || setup.at === 'pinned' ? null : (setup.live?.target ?? null)
  const filesHere = setup !== undefined && isLocal(setup)

  const onCloseSide = useCallback((side: SideId) => {
    if (id === null) return
    closeSide(id, side)
    composer.current?.focus()
  }, [id])
  const returnFocus = useCallback(() => composer.current?.focus(), [])
  const onEscape = () => {
    const newest = cards.at(-1)
    if (id === null || newest === undefined) return false
    closeSide(id, newest.id)
    return true
  }

  const fileCall = useMemo(() => (id === null ? NO_FILE_CALL : fileCallFor(id)), [id])

  return (
    <>
      <main id="scroll" ref={scroller} onScroll={onScroll}>
        {drawn !== null && (
          <FilesHereContext value={filesHere}>
            <FileCallContext value={fileCall}>
              <ImageSessionContext value={id}>
                <Thread
                  view={drawn.view} relays={drawn.relays} sides={drawn.sides} onAnswer={onAnswer} onAnswerRequest={onAnswerRequest} onLoadEarlier={onLoadEarlier} onFindClosed={onFindClosed} onFindScrolled={onScroll}
                  canEdit={canEdit} regenerateTurnKey={regenerateTurnKey} canRegenerate={canEdit && editing === null} onEdit={onEdit} onRegenerate={onRegenerate}
                  canBranch={canBranch} onBranch={onBranch} onNewChat={onNewChat} versions={versions} onVersion={onVersion} queue={queue} canReact={live === true} onReact={onReact} helpers={helpers}
                />
              </ImageSessionContext>
            </FileCallContext>
          </FilesHereContext>
        )}
      </main>
      <div className={`jump${shown ? ' shown' : ''}${waitsOnYou ? ' asking' : ''}`}>
        <button ref={jumper} type="button" aria-label="Jump to latest" aria-describedby={words} onClick={jump}>
          <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12"><path d="M6 2v8M2.5 6.5 6 10l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span id={words} role="status">{notice}</span>
      </div>
      <Composer
        slot={slotOf(chat)}
        sessionId={id}
        cwd={session?.cwd ?? null}
        inputRef={composer}
        autoFocus={chat.kind === 'branch' || (chat.kind === 'new' && chat.sessionId === null)}
        seed={chat.kind === 'branch' ? chat.text : ''}
        canSend={id === null || live}
        canAttach={online}
        showStop={session?.run.state === 'running'}
        onSend={onSend}
        planFor={planFor}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        above={id !== null && cards.length > 0 && <Sides cards={cards} onClose={onCloseSide} returnFocus={returnFocus} />}
        onEscape={onEscape}
        onStop={() => { if (id !== null) void run({ do: 'stop', sessionId: id }) }}
        onInput={onInput}
        stack={id !== null && session !== undefined && (
          <StatusStack
            key={`stack-${id}`} processes={session.processes ?? NO_PROCESSES} control={session.control} disabled={!live}
            onKill={processId => run({ do: 'killProcess', sessionId: id, processId })} onControl={action => run({ do: 'control', sessionId: id, action })}
          />
        )}
        start={id !== null && (
          <>
            {yolo !== null && (
              <YoloPill
                key={`yolo-${id}`} on={yolo} approvals={session?.tuning.approvals ?? null}
                onSet={on => run({ do: 'tune', sessionId: id, set: 'yolo', on })}
                onApprovals={to => run({ do: 'tune', sessionId: id, set: 'approvals', to })}
              />
            )}
            {cwd !== null && (
              <FolderChip
                key={`folder-${id}`} cwd={cwd} field={folderFieldLabel(target)} disabled={!live} running={!idle}
                onMove={to => run({ do: 'move', sessionId: id, cwd: to })}
              />
            )}
          </>
        )}
        end={id !== null && (
          <>
            {model.show !== 'hidden' && (
              <ModelPicker
                key={`model-${id}`} view={model} onOpen={() => void refreshModels()}
                onPick={(pick, confirm) => run({ do: 'pickModel', sessionId: id, model: pick, ...(confirm === null ? {} : { confirm }) })}
              />
            )}
            {tuning !== null && (
              <ThinkingPill key={`thinking-${id}`} tuning={tuning} disabled={!live} running={!idle} onTune={change => run({ do: 'tune', sessionId: id, ...change })} />
            )}
            {fill !== null && <ContextMeter key={`context-${id}`} fill={fill} stale={!live} onBreakdown={() => run({ do: 'contextBreakdown', sessionId: id })} />}
          </>
        )}
      >
        {refused !== null && refused.id === id && <p className="err refusal">{refused.message}</p>}
      </Composer>
    </>
  )
}
