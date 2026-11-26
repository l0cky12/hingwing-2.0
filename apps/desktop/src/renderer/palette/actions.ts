import { shownChat, type Bots, type Link, type OpenChat, type Session, type Sidebar, type Target } from '@highwing/hermes/domain'
import type { WindowCommand } from '../../ipc-contract'
import { newChatIn, newChatKeys } from '../new-chat'

export interface Scene {
  readonly sidebar: Sidebar | undefined
  readonly bots: Bots | undefined
  readonly open: OpenChat | undefined
  readonly link: Link | undefined
  readonly openSession: Session | undefined
  readonly target: Target | null
  readonly draftId: string
}

export interface ActionRow {
  readonly id: string
  readonly label: string
  readonly keys: string | null
  readonly offer: (scene: Scene) => WindowCommand | null
}

const MAC = navigator.userAgent.includes('Mac')

export const ACTIONS: readonly ActionRow[] = [
  { id: 'new-chat', label: 'New chat', keys: newChatKeys(MAC).shown, offer: ({ open, draftId }) => newChatIn(open, draftId) },
  {
    id: 'stop', label: 'Stop', keys: null,
    offer: ({ open, openSession: session }) => {
      const sessionId = shownChat(open)?.sessionId ?? null
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
