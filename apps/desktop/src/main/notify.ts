import type { Feed, Hermes } from '@highwing/hermes'
import { shownChat, type HermesRequest, type Job, type PromptItem, type Session, type SessionId, type SettledTurn } from '@highwing/hermes/domain'
import { failureWords } from '@highwing/thread'
import { appendFile } from 'node:fs/promises'
import type { NoticeKind, Notices } from '../ipc-contract'
import { introInFront, type Intro } from '../intro'
import type { ConnectionOwner } from './connection'

export interface Notice {
  readonly kind: NoticeKind
  /** Names what the notice is about, so it is shown once: a chat's request or turn, or a job's run. */
  readonly key: string
  /** The chat a click opens. null: Hermes names none, so a click only raises the window. */
  readonly opens: SessionId | null
  readonly title: string
  readonly body: string
}

export interface Notifier {
  show(notice: Notice, onClick: () => void): void
}

export interface NotifyDeps {
  readonly notifier: Notifier
  focused(): boolean
  raise(): void
  kinds(): Notices
}

const BODY_MAX = 140
const DONE_BODY = 'Message complete.'
const WAITING_BODY = 'Hermes is waiting for your response.'

const clipped = (text: string) => text.slice(0, BODY_MAX)

const replyOf = (turn: SettledTurn): string => {
  const tail = turn.items.slice(turn.items.findLastIndex(item => item.kind !== 'text' && item.kind !== 'helper') + 1)
  return tail.flatMap(item => (item.kind === 'text' ? [item.markdown] : [])).join('\n\n').trim()
}

const wordsOf = (turn: SettledTurn): Pick<Notice, 'title' | 'body'> | null => {
  switch (turn.outcome.kind) {
    case 'failed':
      return { title: 'Turn failed', body: failureWords(turn.outcome) }
    // Hermes Desktop says a stopped turn finished too: both end in its `message.complete`.
    case 'complete':
    case 'stopped':
      return { title: 'Hermes finished', body: clipped(replyOf(turn) || DONE_BODY) }
    // What Hermes says between turns is no turn the user waited on.
    case 'lost':
    case 'interlude':
      return null
  }
}

export function noticeOf(before: Session, after: Session): Notice | null {
  if (before.sync.state !== 'live' || after.sync.state !== 'live' || before.run.state !== 'running') return null
  const ended = after.history.at(-1)
  if (ended?.id !== before.run.turn.id) return null
  const words = wordsOf(ended)
  return words === null ? null : { kind: 'replies', key: `${after.id} ${ended.id}`, opens: after.id, ...words }
}

const promptWords = ({ ask }: PromptItem): Pick<Notice, 'title' | 'body'> =>
  ask.kind === 'approval' ? { title: 'Approval needed', body: clipped(ask.command) } : { title: 'Input needed', body: clipped(ask.question) }

const requestWords = ({ ask }: HermesRequest): Pick<Notice, 'title' | 'body'> => {
  if (ask.kind === 'questions') return { title: 'Input needed', body: clipped(ask.questions[0]?.text || WAITING_BODY) }
  if (ask.kind === 'secret' && ask.for.is === 'env') return { title: 'Input needed', body: clipped(ask.for.prompt || ask.for.name) }
  return { title: 'Input needed', body: WAITING_BODY }
}

/** Everything the chat waits on the user for now: the running turn's approvals and questions, and Hermes's requests. */
export function asksOf(session: Session): readonly Notice[] {
  const prompts = session.run.state === 'running'
    ? session.run.turn.items.flatMap(item => (item.kind === 'prompt' && item.state.s === 'waiting' ? [item] : []))
    : []
  return [
    ...prompts.map(item => ({ kind: 'asks' as const, key: `${session.id} ${item.id}`, opens: session.id, ...promptWords(item) })),
    ...session.requests.filter(request => request.state.s === 'waiting')
      .map(request => ({ kind: 'asks' as const, key: `${session.id} ${request.id}`, opens: session.id, ...requestWords(request) }))
  ]
}

/** A notice for each job that ran since `before`. A first list (`before` null) is where runs are counted from, so it has none. */
export function jobNotices(before: readonly Job[] | null, after: readonly Job[]): readonly Notice[] {
  if (before === null) return []
  const ran = new Map(before.map(job => [job.id, job.ranAt]))
  return after.flatMap(job => (job.ranAt === null || ran.get(job.id) === job.ranAt ? [] : [{
    kind: 'jobs' as const,
    key: `${job.id} ${job.ranAt}`,
    opens: null,
    title: job.failed ? 'Scheduled job failed' : 'Scheduled job finished',
    body: clipped(job.failed && job.error !== null ? `${job.name}: ${job.error}` : job.name)
  }]))
}

/**
 * Shows each notice once, at its first sight, and only when its kind is on and its chat is not on screen: shown in a
 * focused window, with no Settings, setup screen or first-run intro over it. A notice first seen on screen is not shown later, and one of a kind switched off is not shown when it
 * is switched on.
 */
export function notify(owner: Pick<ConnectionOwner, 'setup' | 'hermes' | 'run'>, intro: Feed<Intro>, deps: NotifyDeps): () => void {
  const told = new Set<string>()

  const serve = (hermes: Hermes) => {
    const onScreen = (id: SessionId) => {
      const setup = owner.setup.get()
      return deps.focused() && (setup.at === 'chat' || setup.at === 'pinned') && !introInFront(setup, intro.get()) && shownChat(hermes.open.get())?.sessionId === id
    }

    const tell = (notice: Notice) => {
      if (told.has(notice.key)) return
      told.add(notice.key)
      if (!deps.kinds()[notice.kind] || (notice.opens !== null && onScreen(notice.opens))) return
      deps.notifier.show(notice, () => {
        deps.raise()
        // A chat of a connection that was replaced is not this Hermes's to open.
        if (notice.opens === null || owner.hermes !== hermes || introInFront(owner.setup.get(), intro.get())) return
        // Opening the shown chat again keeps it and drops a switch to another bot still waiting on its lookup.
        void owner.run({ do: 'open', ref: { kind: 'chat', sessionId: notice.opens } })
      })
    }

    const stopChanges = hermes.changes((session, previous) => {
      for (const notice of asksOf(session)) tell(notice)
      const ended = noticeOf(previous, session)
      if (ended !== null) tell(ended)
    })
    let jobs = hermes.jobs.get()
    const stopJobs = hermes.jobs.subscribe(next => {
      if (next === null) return
      for (const notice of jobNotices(jobs, next)) tell(notice)
      jobs = next
    })
    return () => {
      stopChanges()
      stopJobs()
    }
  }

  let hermes = owner.hermes
  let stop = hermes === null ? () => {} : serve(hermes)
  const unsubscribe = owner.setup.subscribe(() => {
    if (owner.hermes === hermes) return
    stop()
    hermes = owner.hermes
    stop = hermes === null ? () => {} : serve(hermes)
  })
  return () => {
    unsubscribe()
    stop()
  }
}

const NOTICES_HELD = 16

export function desktopNotifier(Notification: typeof Electron.Notification): Notifier {
  // A notification nothing holds can be garbage-collected while on screen, and its click then reaches nobody.
  // `close` is not a release point: Windows fires it on a timeout while the notice stays clickable in Action
  // Center, and it is not guaranteed at all, so the newest few are kept instead.
  const held: Electron.Notification[] = []
  return {
    show({ title, body }, onClick) {
      if (!Notification.isSupported()) return
      const shown = new Notification({ title, body })
      held.push(shown)
      if (held.length > NOTICES_HELD) held.shift()
      shown.on('click', () => {
        const at = held.indexOf(shown)
        if (at !== -1) held.splice(at, 1)
        onClick()
      })
      shown.show()
    }
  }
}

export function recordingNotifier(logFile: string): Notifier {
  return { show: ({ kind, key, opens, title, body }) => void appendFile(logFile, `${JSON.stringify({ kind, key, opens, title, body })}\n`) }
}
