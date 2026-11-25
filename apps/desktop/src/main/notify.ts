import type { Hermes } from '@highwing/hermes'
import type { OpenChat, Session, SessionId, SettledTurn, TurnId } from '@highwing/hermes/domain'
import { failureWords } from '@highwing/thread'
import { appendFile } from 'node:fs/promises'
import type { ConnectionOwner } from './connection'

/** A turn end worth a desktop notification, in the words Hermes Desktop uses. */
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
  /** Whether any Highwing window has focus. */
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
    case 'lost':
      return null
  }
}

/**
 * The notice for the turn that ended between two values of one chat, or null. Only an end heard on
 * the live socket counts: history read at open, and an end that replay or catch-up delivered, are
 * old news by the time they arrive.
 */
export function noticeOf(before: Session, after: Session): TurnNotice | null {
  if (before.sync.state !== 'live' || after.sync.state !== 'live' || before.run.state !== 'running') return null
  const ended = after.history.at(-1)
  if (ended?.id !== before.run.turn.id) return null
  const words = wordsOf(ended)
  return words === null ? null : { sessionId: after.id, turnId: ended.id, ...words }
}

/**
 * Notifies once for each turn of the shown chat that ends while no Highwing window has focus, on
 * whichever Hermes is live. A click raises the window and opens that chat again if another is shown.
 */
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
        if (hermes.open.get().shown?.sessionId !== sessionId) void hermes.run({ do: 'open', ref: { kind: 'chat', sessionId } })
      })
    })
  }

  const followShown = (hermes: Hermes) => {
    let shown: SessionId | null = null
    let unwatch = () => {}
    const follow = (open: OpenChat) => {
      const next = open.shown?.sessionId ?? null
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

export function desktopNotifier(Notification: typeof Electron.Notification): Notifier {
  // A notification nothing holds can be garbage-collected while on screen, and its click then reaches nobody.
  const held = new Set<Electron.Notification>()
  return {
    show({ title, body }, onClick) {
      if (!Notification.isSupported()) return
      const shown = new Notification({ title, body })
      held.add(shown)
      shown.on('click', () => {
        held.delete(shown)
        onClick()
      })
      shown.on('close', () => held.delete(shown))
      shown.show()
    }
  }
}

export function recordingNotifier(logFile: string): Notifier {
  return { show: notice => void appendFile(logFile, `${JSON.stringify(notice)}\n`) }
}
