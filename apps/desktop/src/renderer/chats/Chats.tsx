import type { Bots, OpenChat, SessionId, Sidebar } from '@highwing/hermes/domain'
import { useEffect, useId, useState } from 'react'
import { slotOf, sweepDrafts, useChatDrafts } from '../composer/drafts'
import { run, useTopic } from '../store'
import { botNameOf, CHATS, chatsOf, DRAFT } from './chat-list'

const TICK_MS = 30_000

function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])
  return now
}

export function ChatsSidebar() {
  const sidebar = useTopic('sidebar')
  const open = useTopic('open')
  const drafts = useChatDrafts()
  const shown = open?.shown ?? null
  const openKey = shown === null ? null : slotOf(shown).key
  useEffect(() => sweepDrafts(sidebar, openKey), [sidebar, openKey, drafts])
  return (
    <ChatsPanel
      sidebar={sidebar} open={open} bots={useTopic('bots')} now={useNow()} drafts={drafts}
      onOpen={sessionId => void run({ do: 'open', ref: { kind: 'chat', sessionId } })}
    />
  )
}

interface ChatsPanelProps {
  readonly sidebar: Sidebar | undefined
  readonly open: OpenChat | undefined
  readonly bots: Bots | undefined
  readonly now: number
  readonly drafts: ReadonlySet<SessionId>
  readonly onOpen: (sessionId: SessionId) => void
}

export function ChatsPanel({ sidebar, open, bots, now, drafts, onOpen }: ChatsPanelProps) {
  const ids = useId()
  const view = chatsOf(sidebar, open, now, drafts)
  return (
    <nav className="chats" aria-label="Chats">
      <div className="chats-head"><h2>{botNameOf(bots, open?.shown?.bot ?? null) ?? CHATS}</h2></div>
      <div className="chats-list" aria-busy={view.show === 'loading' || undefined}>
        {view.show === 'note' && <p className="chats-note" role="status">{view.words}</p>}
        {view.show === 'rows' && view.rows.map((row, at) => {
          // A session id is any word Hermes mints, so the ids come from the row's place.
          const [doing, when, preview] = [`${ids}-${at}-doing`, `${ids}-${at}-when`, `${ids}-${at}-preview`]
          const words = row.doing ?? (row.showsDraft ? DRAFT : null)
          return (
            <button
              key={row.id} type="button" className="chat-row" aria-label={row.name} aria-describedby={`${doing} ${when} ${preview}`}
              aria-current={row.current || undefined} onClick={() => onOpen(row.id)}
            >
              <span className="chat-top">
                <span className="chat-title">{row.name}</span>
                <span className="chat-when" id={when}>{row.when}</span>
              </span>
              <span className="chat-doing" id={doing} data-badge={row.badge}>{words ?? ''}</span>
              {/* Hidden, the preview is still read as part of the row's description. */}
              <span className="chat-preview" id={preview} hidden={words !== null}>{row.preview ?? ''}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
