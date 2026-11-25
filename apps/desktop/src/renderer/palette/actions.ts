import type { Bots, Link, OpenChat, Session, Sidebar, Target } from '@highwing/hermes/domain'
import type { WindowCommand } from '../../ipc-contract'

/** What the palette reads, from the topics. undefined: Electron main has not pushed that topic yet. */
export interface Scene {
  readonly sidebar: Sidebar | undefined
  readonly bots: Bots | undefined
  readonly open: OpenChat | undefined
  readonly link: Link | undefined
  /** The open chat's session. */
  readonly session: Session | undefined
  /** null in a fixture run, which has no connection to change. */
  readonly target: Target | null
  /** The new chat New chat opens. Minted once per opening, so the same opening always offers the same chat. */
  readonly draftId: string
}

export interface ActionRow {
  readonly id: string
  readonly label: string
  /** The shortcut shown at the row's right. null: none. */
  readonly keys: string | null
  /** The command Enter sends now. null: not offered, so not listed. */
  readonly offer: (scene: Scene) => WindowCommand | null
}

const MAC = navigator.userAgent.includes('Mac')

/** Table order is the order the palette lists them in. */
export const ACTIONS: readonly ActionRow[] = [
  {
    id: 'new-chat', label: 'New chat', keys: MAC ? '⌘N' : 'Ctrl+N',
    offer: ({ open, draftId }) => ({ do: 'open', ref: { kind: 'new', bot: open?.shown?.bot ?? null, draftId } })
  },
  {
    id: 'stop', label: 'Stop', keys: null,
    offer: ({ open, session }) => {
      const sessionId = open?.shown?.sessionId ?? null
      return sessionId !== null && session?.run.state === 'running' && session.sync.state === 'live' ? { do: 'stop', sessionId } : null
    }
  },
  { id: 'connection', label: 'Open Connection', keys: null, offer: ({ target }) => (target === null ? null : { do: 'editTarget' }) },
  { id: 'reconnect', label: 'Reconnect', keys: null, offer: ({ link }) => (link?.state === 'blocked' ? { do: 'reconnect', start: false } : null) },
  {
    id: 'start-hermes', label: 'Start Hermes', keys: null,
    offer: ({ link }) => (link?.state === 'waiting' && link.why === 'not-running' ? { do: 'reconnect', start: true } : null)
  }
]
