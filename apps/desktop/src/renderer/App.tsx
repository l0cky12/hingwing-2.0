import type { Shown, Target } from '@highwing/hermes/domain'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { Mode, Setup } from '../ipc-contract'
import { BotPicker } from './bots/BotPicker'
import { BotsSidebar } from './bots/Bots'
import { useRetryPicturesOnceOnline } from './bots/pictures'
import { ChatsSidebar, DraftSweep } from './chats/Chats'
import { Chat } from './chat/Chat'
import { Banner, TopBar } from './chrome/Chrome'
import { ModeSwitch } from './chrome/ModeSwitch'
import { Preview } from './preview/Preview'
import { Composer } from './composer/Composer'
import { Palette } from './palette/Palette'
import { Saved, SetupForm } from './setup/Setup'
import { Epoch, run, useTopic } from './store'

const NO_CHAT = async () => ({ ok: false, refusal: { kind: 'rejected', message: 'There is no chat to send to.' } }) as const

function samePaneOnFirstMessage(shown: Shown): string {
  switch (shown.kind) {
    case 'bot': return `bot:${shown.bot}`
    case 'new': return `new:${shown.draftId}`
    case 'chat': return `chat:${shown.sessionId}`
    case 'branch': return `branch:${shown.sessionId}`
  }
}

function OpenPane() {
  const shown = useTopic('open')?.shown ?? null
  return shown === null
    ? <><main id="scroll" /><Composer slot={null} canSend={false} canAttach={false} showStop={false} onSend={NO_CHAT} onStop={() => {}} onInput={() => {}} /></>
    : <Chat key={samePaneOnFirstMessage(shown)} chat={shown} />
}

function ChatScreen({ target }: { readonly target: Target | null }) {
  const link = useTopic('link')
  useRetryPicturesOnceOnline(link?.state === 'online')
  return (
    <>
      <div className="top">
        <TopBar target={target} />
        {link !== undefined && <Banner link={link} />}
      </div>
      <OpenPane />
    </>
  )
}

function useSwitchModeKeepingFocus(mode: Mode) {
  const root = useRef<HTMLDivElement>(null)
  const switchUnmountedWithItsColumn = useRef(false)
  useLayoutEffect(() => {
    if (!switchUnmountedWithItsColumn.current) return
    switchUnmountedWithItsColumn.current = false
    if (document.activeElement === document.body) root.current?.querySelector<HTMLButtonElement>('.mode-switch')?.focus()
  }, [mode])
  const pick = (next: Mode) => {
    switchUnmountedWithItsColumn.current = true
    void run({ do: 'setMode', mode: next })
  }
  return { root, pick }
}

function ChatWindow({ hidden, target, mode }: { readonly hidden: boolean; readonly target: Target | null; readonly mode: Mode }) {
  const preview = useTopic('preview')
  const { root, pick } = useSwitchModeKeepingFocus(mode)
  const switcher = <ModeSwitch mode={mode} onPick={pick} />
  return (
    <div ref={root} className="window" hidden={hidden} data-preview={preview?.state === 'open' || undefined}>
      {mode === 'bots' && <BotsSidebar head={switcher} />}
      {mode === 'chats' && <ChatsSidebar head={<>{switcher}<BotPicker /></>} />}
      <div key="screen" className="screen">
        <ChatScreen target={target} />
      </div>
      <DraftSweep />
      {preview?.state === 'open' && <Preview preview={preview} />}
      {!hidden && <Palette target={target} />}
    </div>
  )
}

const SCREENS: { readonly [A in Setup['at']]: (setup: Extract<Setup, { at: A }>) => ReactNode } = {
  chat: () => null,
  pinned: () => null,
  form: setup => <SetupForm setup={setup} />,
  checking: setup => <SetupForm setup={setup} />,
  failed: setup => <SetupForm setup={setup} />,
  saved: setup => <Saved target={setup.live.target} />
}

/**
 * Each setup state names its own screen. While a connection is live its chat stays mounted under
 * the setup screen, hidden, so an unsent draft survives Connection and Cancel. Only a new epoch
 * remounts it, which also makes it ask Electron main again for every topic it reads.
 */
export function App() {
  const setup = useTopic('setup')
  const mode = useTopic('mode')
  if (setup === undefined || mode === undefined) return null
  const over = (SCREENS[setup.at] as (setup: Setup) => ReactNode)(setup)
  const live = setup.at === 'pinned' ? null : setup.live
  return (
    <>
      {(setup.at === 'pinned' || live !== null) && (
        <Epoch key={live?.epoch ?? 0} value={live?.epoch ?? 0}>
          <ChatWindow hidden={over !== null} target={live?.target ?? null} mode={mode} />
        </Epoch>
      )}
      {over}
    </>
  )
}
