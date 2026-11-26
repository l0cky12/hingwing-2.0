import type { Hermes } from '@highwing/hermes'
import { shownChat, type OpenChat, type Session, type SessionId, type SettledTurn, type TurnId } from '@highwing/hermes/domain'
import { failureWords } from '@highwing/thread'
import { appendFile } from 'node:fs/promises'
import type { ConnectionOwner } from './connection'

export interface TurnNotice {
  readonly sessionId: SessionId
  readonly turnId: TurnId
  readonly title: string
  readonly body: string
}

export interface Notifier {
  show(notice: TurnNotice, onClick: () => void): void
}

export interface NotifyDeps {
  readonly notifier: Notifier
  focused(): boolean
  raise(): void
}

const BODY_MAX = 140
const DONE_BODY = 'Message complete.'

const replyOf = (turn: SettledTurn): string => {
  const tail = turn.items.slice(turn.items.findLastIndex(item => item.kind !== 'text' && item.kind !== 'helper') + 1)
  return tail.flatMap(item => (item.kind === 'text' ? [item.markdown] : [])).join('\n\n').trim()
}

const wordsOf = (turn: SettledTurn): Pick<TurnNotice, 'title' | 'body'> | null => {
  switch (turn.outcome.kind) {
    case 'failed':
      return { title: 'Turn failed', body: failureWords(turn.outcome) }
    // Hermes Desktop says a stopped turn finished too: both end in its `message.complete`.
    case 'complete':
    case 'stopped':
      return { title: 'Hermes finished', body: (replyOf(turn) || DONE_BODY).slice(0, BODY_MAX) }
    // What Hermes says between turns is no turn the user waited on.
    case 'lost':
    case 'interlude':
      return null
  }
}

export function noticeOf(before: Session, after: Session): TurnNotice | null {
  if (before.sync.state !== 'live' || after.sync.state !== 'live' || before.run.state !== 'running') return null
  const ended = after.history.at(-1)
  if (ended?.id !== before.run.turn.id) return null
  const words = wordsOf(ended)
  return words === null ? null : { sessionId: after.id, turnId: ended.id, ...words }
}

export function notifyTurnEnds(owner: Pick<ConnectionOwner, 'setup' | 'hermes'>, deps: NotifyDeps): () => void {
  const told = new Set<string>()

  const watchChat = (hermes: Hermes, sessionId: SessionId) => {
    let before: Session | null = null
    return hermes.watch(sessionId, session => {
      const notice = before === null ? null : noticeOf(before, session)
      before = session
      if (notice === null || deps.focused()) return
      const key = `${sessionId} ${notice.turnId}`
      if (told.has(key)) return
      told.add(key)
      deps.notifier.show(notice, () => {
        deps.raise()
        // A chat of a connection that was replaced is not this Hermes's to open.
        if (owner.hermes !== hermes) return
        // Opening the shown chat again keeps it and drops a switch to another bot still waiting on its lookup.
        void hermes.run({ do: 'open', ref: { kind: 'chat', sessionId } })
      })
    })
  }

  const followShown = (hermes: Hermes) => {
    let shown: SessionId | null = null
    let unwatch = () => {}
    const follow = (open: OpenChat) => {
      const next = shownChat(open)?.sessionId ?? null
      if (next === shown) return
      unwatch()
      shown = next
      unwatch = next === null ? () => {} : watchChat(hermes, next)
    }
    follow(hermes.open.get())
    const unsubscribe = hermes.open.subscribe(follow)
    return () => {
      unsubscribe()
      unwatch()
    }
  }

  let hermes = owner.hermes
  let stop = hermes === null ? () => {} : followShown(hermes)
  const unsubscribe = owner.setup.subscribe(() => {
    if (owner.hermes === hermes) return
    stop()
    hermes = owner.hermes
    stop = hermes === null ? () => {} : followShown(hermes)
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
  return { show: notice => void appendFile(logFile, `${JSON.stringify(notice)}\n`) }
}
