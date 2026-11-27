import type { Shown, ShownGroup, Target } from '@highwing/hermes/domain'
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { epochOf, type Mode, type Theme } from '../ipc-contract'
import { BotPicker } from './bots/BotPicker'
import { BotsSidebar } from './bots/Bots'
import { useRetryPicturesOnceOnline } from './bots/pictures'
import { ChatsSidebar, DraftSweep } from './chats/Chats'
import { Chat } from './chat/Chat'
import { GroupPane } from './groups/GroupPane'
import { Banner, TopBar } from './chrome/Chrome'
import { ModeSwitch } from './chrome/ModeSwitch'
import { Preview } from './preview/Preview'
import { Composer } from './composer/Composer'
import { useComputerShown } from './computer/computer'
import { ComputerView } from './computer/Computer'
import { Palette } from './palette/Palette'
import { screenOf, type CardSetup } from './setup/screens'
import { Settings } from './setup/Settings'
import { FirstRun, Saved } from './setup/Setup'
import { Epoch, run, useTopic } from './store'

const NO_CHAT = async () => ({ ok: false, refusal: { kind: 'rejected', message: 'There is no chat to send to.' } }) as const

function samePaneOnFirstMessage(shown: Shown | ShownGroup): string {
  switch (shown.kind) {
    case 'bot': return `bot:${shown.bot}`
    case 'new': return `new:${shown.draftId}`
    case 'chat': return `chat:${shown.sessionId}`
    case 'branch': return `branch:${shown.sessionId}`
    case 'group': return `group:${shown.group}`
  }
}

function OpenPane() {
  const shown = useTopic('open')?.shown ?? null
  if (shown === null) return <><main id="scroll" /><Composer slot={null} canSend={false} canAttach={false} showStop={false} onSend={NO_CHAT} onStop={() => {}} onInput={() => {}} /></>
  return shown.kind === 'group' ? <GroupPane key={samePaneOnFirstMessage(shown)} shown={shown} /> : <Chat key={samePaneOnFirstMessage(shown)} chat={shown} />
}

function ChatScreen({ target, settingsButton }: { readonly target: Target | null; readonly settingsButton: RefObject<HTMLButtonElement | null> }) {
  const link = useTopic('link')
  useRetryPicturesOnceOnline(link?.state === 'online')
  return (
    <>
      <div className="top">
        <TopBar target={target} settingsButton={settingsButton} />
        {link !== undefined && <Banner link={link} target={target} />}
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

function useCloseSettings(shown: boolean) {
  const settingsButton = useRef<HTMLButtonElement>(null)
  const closing = useRef(false)
  useLayoutEffect(() => {
    if (shown || !closing.current) return
    closing.current = false
    settingsButton.current?.focus()
  }, [shown])
  const close = useCallback(() => {
    closing.current = true
    void run({ do: 'keepTarget' }).then(outcome => {
      if (!outcome.ok) closing.current = false
    })
  }, [])
  return { settingsButton, close }
}

interface ChatWindowProps {
  readonly hidden: boolean
  readonly settings: CardSetup | null
  readonly target: Target | null
  readonly mode: Mode
  readonly theme: Theme
}

function ChatWindow({ hidden, settings, target, mode, theme }: ChatWindowProps) {
  const preview = useTopic('preview')
  const screen = useTopic('screen')
  const { root, pick } = useSwitchModeKeepingFocus(mode)
  const { settingsButton, close } = useCloseSettings(settings !== null)
  const switcher = <ModeSwitch mode={mode} onPick={pick} />
  const computer = useComputerShown() && settings === null ? screen ?? null : null
  const paned = (preview?.state === 'open' || computer !== null) && settings === null
  return (
    <div ref={root} className="window" hidden={hidden} data-preview={paned || undefined}>
      {mode === 'bots' && <BotsSidebar head={switcher} />}
      {mode === 'chats' && <ChatsSidebar head={<>{switcher}<BotPicker /></>} />}
      <div key="screen" className="screen" hidden={settings !== null}>
        <ChatScreen target={target} settingsButton={settingsButton} />
      </div>
      {settings !== null && <Settings setup={settings} mode={mode} theme={theme} onRequestClose={close} />}
      <DraftSweep />
      {computer !== null ? <ComputerView view={computer} /> : paned && preview?.state === 'open' && <Preview preview={preview} />}
    </div>
  )
}

export function App() {
  const setup = useTopic('setup')
  const mode = useTopic('mode')
  const theme = useTopic('theme')
  if (setup === undefined || mode === undefined || theme === undefined) return null
  const screen = screenOf(setup)
  const live = setup.at === 'pinned' ? null : setup.live
  return (
    <>
      {(setup.at === 'pinned' || live !== null) && (
        <Epoch value={epochOf(setup)}>
          <ChatWindow key={epochOf(setup)} hidden={screen.show === 'saved'} settings={screen.show === 'settings' ? screen.setup : null} target={live?.target ?? null} mode={mode} theme={theme} />
          {/* Outside the window a new connection remounts, so a pick main refused for the old one comes back over the new one. */}
          {screen.show !== 'saved' && <Palette target={live?.target ?? null} settingsOpen={screen.show === 'settings'} />}
        </Epoch>
      )}
      {screen.show === 'first-run' && <FirstRun setup={screen.setup} />}
      {screen.show === 'saved' && <Saved target={screen.live.target} />}
    </>
  )
}
