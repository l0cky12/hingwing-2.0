import { machineOf, type Link, type Target } from '@highwing/hermes/domain'
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import type { WindowCommand } from '../../ipc-contract'
import { isCommandKey } from '../keys'
import { CopyLink } from '../chat/Copy'
import { botNameOf, openChatName } from '../chats/chat-list'
import { newChatIn, newChatKeys } from '../new-chat'
import { run, useTopic } from '../store'

/** The bar every screen has. `children` is what the screen puts at its right end. */
export function Bar({ where, children }: { readonly where: string | null; readonly children?: ReactNode }) {
  return (
    <header className="bar">
      <h1><span className="brand">Hermes</span>{where === null ? null : ` ${where}`}</h1>
      {children}
    </header>
  )
}

function NewChat() {
  const open = useTopic('open')
  const button = useRef<HTMLButtonElement>(null)
  const start = useCallback(() => void run(newChatIn(open, crypto.randomUUID())), [open])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isCommandKey(event, 'n') || button.current?.checkVisibility() !== true) return
      event.preventDefault()
      if (!event.repeat) start()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [start])
  return <button ref={button} type="button" aria-keyshortcuts={newChatKeys(navigator.userAgent.includes('Mac')).aria} onClick={start}>New chat</button>
}

function useOpenChatName(): string | null {
  const shown = useTopic('open')?.shown ?? null
  const bot = botNameOf(useTopic('bots'), shown?.bot ?? null)
  const title = useTopic(shown?.sessionId == null ? null : `session:${shown.sessionId}`)?.title ?? null
  return openChatName(bot, title)
}

/** `target` is null in a fixture run, which has no connection to name or to change. */
export function TopBar({ target }: { readonly target: Target | null }) {
  const chat = useOpenChatName()
  const sessionId = useTopic('open')?.shown?.sessionId ?? null
  const where = [chat, target === null ? null : `on ${machineOf(target)}`].filter(part => part !== null).join(' ')
  return (
    <Bar where={where === '' ? null : where}>
      <NewChat />
      {target !== null && <button onClick={() => void run({ do: 'editTarget' })}>Connection</button>}
      {sessionId !== null && <CopyLink sessionId={sessionId} />}
    </Bar>
  )
}

type Press = Extract<WindowCommand, { readonly do: 'reconnect' | 'editTarget' | 'checkTarget' }>

interface BannerCopy {
  readonly words: string
  /** `run`: what the button sends, in order, stopping at the first that main refuses. */
  readonly action: { readonly label: string; readonly run: readonly Press[] } | null
}

const reconnect = (label: string, start: boolean): BannerCopy['action'] => ({ label, run: [{ do: 'reconnect', start }] })

/**
 * A retry of a signed-out link would fail the same way, because only a check opens the browser. Sign in
 * opens the Connection screen and checks the live target, as Connection and then Connect do.
 */
export function bannerOf(link: Link, target: Target | null): BannerCopy | null {
  switch (link.state) {
    case 'blocked': return {
      words: link.message,
      action: link.why === 'signed-out' && target !== null
        ? { label: 'Sign in', run: [{ do: 'editTarget' }, { do: 'checkTarget', target }] }
        : reconnect('Retry', false)
    }
    case 'waiting': return { words: link.message, action: link.why === 'not-running' ? reconnect('Start Hermes', true) : null }
    default: return null
  }
}

async function press(commands: readonly Press[]): Promise<void> {
  for (const command of commands) if (!(await run(command)).ok) return
}

/** `target` is null in a fixture run, as for `TopBar`. */
export function Banner({ link, target }: { readonly link: Link; readonly target: Target | null }) {
  const copy = bannerOf(link, target)
  if (copy === null) return null
  const { action } = copy
  return (
    <div className="banner" role="status" aria-label="Connection">
      <p>{copy.words}</p>
      {action !== null && <button onClick={() => void press(action.run)}>{action.label}</button>}
    </div>
  )
}
