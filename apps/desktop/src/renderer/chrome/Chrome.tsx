import { machineOf, shownChat, shownGroup, type Bot, type Link, type Target } from '@highwing/hermes/domain'
import { useCallback, useEffect, useRef, type ReactNode, type Ref, type RefObject } from 'react'
import type { WindowCommand } from '../../ipc-contract'
import { detailsKeys, isShortcut, MAC } from '../keys'
import { modalOpen } from '../shortcuts'
import { Avatar } from '../bots/Avatar'
import { BotPanel, useBotPanel } from '../bots/BotPanel'
import { botIn } from '../bots/roster-view'
import { openChatName } from '../chats/chat-list'
import { GroupMembers } from '../groups/GroupThread'
import { faceOf } from '../groups/group-rows'
import { newChatIn } from '../new-chat'
import { NewChatButton } from './SidebarHead'
import { run, useTopic } from '../store'

/**
 * The bar every screen has. `children` is what the screen puts at its right end.
 * `shown` draws `where` with controls in it, and the heading keeps `where` as its name.
 */
export function Bar({ where, shown, children, ref }: { readonly where: string | null; readonly shown?: ReactNode; readonly children?: ReactNode; readonly ref?: Ref<HTMLElement> }) {
  return (
    <header ref={ref} className="bar">
      <h1 aria-label={shown === undefined || where === null ? undefined : `Hermes ${where}`}>
        <span className="brand">Hermes</span>{where === null ? null : <> {shown ?? where}</>}
      </h1>
      {children}
    </header>
  )
}

function useNewChatKey(bar: RefObject<HTMLElement | null>) {
  const open = useTopic('open')
  const start = useCallback(() => void run(newChatIn(open, crypto.randomUUID())), [open])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isShortcut(event, 'newChat') || modalOpen() || bar.current?.checkVisibility() !== true) return
      event.preventDefault()
      if (!event.repeat) start()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [start, bar])
}

function useOpenChat() {
  const shown = shownChat(useTopic('open'))
  const bots = useTopic('bots')
  const bot = shown?.bot == null ? null : botIn(bots, shown.bot)
  const title = useTopic(shown?.sessionId == null ? null : `session:${shown.sessionId}`)?.title ?? null
  return { bot, name: openChatName(bot?.name ?? null, title), title: openChatName(null, title) }
}

function useDetailsKey(bar: RefObject<HTMLElement | null>, bot: Bot | null, open: (bot: Bot) => Promise<void>) {
  useEffect(() => {
    if (bot === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isShortcut(event, 'details') || bar.current?.checkVisibility() !== true) return
      event.preventDefault()
      if (!event.repeat && document.querySelector('dialog[open]') === null) void open(bot)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bar, bot, open])
}

function useOpenGroup() {
  const group = shownGroup(useTopic('open'))
  const groups = useTopic('groups')
  const bots = useTopic('bots')
  const row = group === null || groups?.state !== 'listed' ? undefined : groups.rows.find(held => held.id === group)
  return row === undefined ? null : { name: row.name, faces: row.members.map(member => faceOf(member, bots)) }
}

export function TopBar({ target }: { readonly target: Target | null }) {
  const bar = useRef<HTMLElement>(null)
  useNewChatKey(bar)
  const { bot, name, title } = useOpenChat()
  const group = useOpenGroup()
  const { panel, open, close } = useBotPanel()
  const pill = group === null ? bot : null
  useDetailsKey(bar, pill, open)
  const machine = target === null ? null : `on ${machineOf(target)}`
  const where = [group?.name ?? name, machine].filter(part => part !== null).join(' ')
  const keys = detailsKeys(MAC)
  const rest = [title === null ? null : `· ${title}`, machine].filter(part => part !== null).join(' ')
  const shown = pill === null ? undefined : (
    <>
      <button
        type="button" className="bot-pill" aria-label={`Details for ${pill.name}`} aria-haspopup="dialog" aria-keyshortcuts={keys.aria}
        title={`Bot details (${keys.shown})`} onClick={() => void open(pill)}
      >
        <Avatar bot={pill} size={20} /><span className="name">{pill.name}</span>
      </button>
      {rest !== '' && <span className="where">{rest}</span>}
    </>
  )
  return (
    <>
      <Bar ref={bar} where={where === '' ? null : where} shown={shown}>
        {group === null ? <NewChatButton /> : <GroupMembers faces={group.faces} />}
      </Bar>
      <BotPanel panel={panel} current={bot} onClose={close} />
    </>
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
