import { machineOf, shownChat, shownGroup, type Bot, type Link, type Target } from '@highwing/hermes/domain'
import { useCallback, useEffect, useRef, type ReactNode, type Ref, type RefObject } from 'react'
import type { WindowCommand } from '../../ipc-contract'
import { Avatar } from '../bots/Avatar'
import { botIn } from '../bots/roster-view'
import { detailsKeys, isCommandKey, MAC } from '../keys'
import { CopyLink } from '../chat/Copy'
import { openChatName } from '../chats/chat-list'
import { GroupMembers } from '../groups/GroupThread'
import { faceOf } from '../groups/group-rows'
import { newChatIn, newChatKeys } from '../new-chat'
import { run, useTopic } from '../store'

/** The bar every screen has. `children` is what the screen puts at its right end. */
export function Bar({ where, label, children, ref }: { readonly where: ReactNode; readonly label?: string | undefined; readonly children?: ReactNode; readonly ref?: Ref<HTMLElement> }) {
  return (
    <header ref={ref} className="bar">
      <h1 aria-label={label}><span className="brand">Hermes</span>{where === null ? null : <> {where}</>}</h1>
      {children}
    </header>
  )
}

function useNewChat(bar: RefObject<HTMLElement | null>) {
  const open = useTopic('open')
  const start = useCallback(() => void run(newChatIn(open, crypto.randomUUID())), [open])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isCommandKey(event, 'n') || bar.current?.checkVisibility() !== true) return
      event.preventDefault()
      if (!event.repeat) start()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [start, bar])
  return start
}

export function useOpenChat(): { readonly bot: Bot | null; readonly title: string | null } {
  const shown = shownChat(useTopic('open'))
  const bots = useTopic('bots')
  const title = useTopic(shown?.sessionId == null ? null : `session:${shown.sessionId}`)?.title ?? null
  return { bot: shown?.bot == null ? null : botIn(bots, shown.bot), title }
}

function useOpenGroup() {
  const group = shownGroup(useTopic('open'))
  const groups = useTopic('groups')
  const bots = useTopic('bots')
  const row = group === null || groups?.state !== 'listed' ? undefined : groups.rows.find(held => held.id === group)
  return row === undefined ? null : { name: row.name, faces: row.members.map(member => faceOf(member, bots)) }
}

const words = (...parts: readonly (string | null)[]) => parts.filter(part => part !== null).join(' ')

export interface DetailsToggle {
  readonly open: boolean
  readonly panel: string
  readonly pill: RefObject<HTMLButtonElement | null>
  readonly toggle: () => void
}

function BotPill({ bot, details }: { readonly bot: Bot; readonly details: DetailsToggle }) {
  return (
    <button
      ref={details.pill} type="button" className="bot-pill" aria-label={`${bot.name} details`} aria-expanded={details.open} aria-controls={details.open ? details.panel : undefined}
      aria-keyshortcuts={detailsKeys(MAC).aria} title={`${bot.name} details (${detailsKeys(MAC).shown})`} onClick={details.toggle}
    >
      <Avatar bot={bot} size={20} />
      {bot.name}
    </button>
  )
}

/** `target` is null in a fixture run, which has no connection to name or to change. */
export function TopBar({ target, settingsButton, details }: { readonly target: Target | null; readonly settingsButton: RefObject<HTMLButtonElement | null>; readonly details: DetailsToggle }) {
  const bar = useRef<HTMLElement>(null)
  const startChat = useNewChat(bar)
  const { bot, title } = useOpenChat()
  const group = useOpenGroup()
  const sessionId = shownChat(useTopic('open'))?.sessionId ?? null
  const machine = target === null ? null : `on ${machineOf(target)}`
  const named = words(group?.name ?? openChatName(bot?.name ?? null, title), machine)
  const pill = group === null && bot !== null
  const titled = openChatName(null, title)
  const after = words(titled === null ? null : `· ${titled}`, machine)
  return (
    <Bar
      ref={bar} label={pill ? `Hermes ${named}` : undefined}
      where={pill ? <><BotPill bot={bot} details={details} />{after === '' ? null : ` ${after}`}</> : named === '' ? null : named}
    >
      {group === null
        ? <button type="button" aria-keyshortcuts={newChatKeys(MAC).aria} onClick={startChat}>New chat</button>
        : <GroupMembers faces={group.faces} />}
      {target !== null && <button ref={settingsButton} onClick={() => void run({ do: 'editTarget' })}>Settings</button>}
      {sessionId !== null && <CopyLink sessionId={sessionId} />}
    </Bar>
  )
}

type Press = Extract<WindowCommand, { readonly do: 'reconnect' | 'editTarget' | 'checkTarget' }>

export interface BannerAction { readonly label: string; readonly run: readonly Press[] }

interface BannerCopy {
  readonly words: string
  readonly action: BannerAction | null
}

const reconnect = (label: string, start: boolean): BannerAction => ({ label, run: [{ do: 'reconnect', start }] })

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

export async function press(commands: readonly Press[]): Promise<void> {
  for (const command of commands) if (!(await run(command)).ok) return
}

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
