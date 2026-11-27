import { shownChat, type Shown, type ShownGroup, type Target } from '@highwing/hermes/domain'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { introInFront } from '../intro'
import { isSettingsChord } from './keys'
import { epochOf, type Accent, type Mode, type SidebarWidth, type Theme } from '../ipc-contract'
import { BotPicker } from './bots/BotPicker'
import { BotsSidebar } from './bots/Bots'
import { useRetryPicturesOnceOnline } from './bots/pictures'
import { ChatsSidebar, DraftSweep } from './chats/Chats'
import { Chat } from './chat/Chat'
import { GroupPane } from './groups/GroupPane'
import { accentTone, toneOfBot } from './chrome/accent'
import { Banner, TopBar } from './chrome/Chrome'
import { HermesFoot } from './chrome/HermesFoot'
import { ModeSwitch, ModeToggle } from './chrome/ModeSwitch'
import { composerBox, Shortcuts } from './chrome/Shortcuts'
import { ShortcutSheet } from './chrome/ShortcutSheet'
import { Preview } from './preview/Preview'
import { Composer } from './composer/Composer'
import { showComputer, useComputerShown } from './computer/computer'
import { ComputerView } from './computer/Computer'
import { Apps, AppsButton } from './apps/Apps'
import { Palette } from './palette/Palette'
import { Tasks } from './tasks/Tasks'
import { screenOf, type CardSetup } from './setup/screens'
import { Settings } from './setup/Settings'
import { Intro } from './setup/Intro'
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

function ChatScreen({ target }: { readonly target: Target | null }) {
  const link = useTopic('link')
  useRetryPicturesOnceOnline(link?.state === 'online')
  return (
    <>
      <div className="top">
        <TopBar target={target} />
        {link !== undefined && <Banner link={link} target={target} />}
      </div>
      <OpenPane />
    </>
  )
}

type ModeControl = '.mode-switch' | '.mode-toggle'

function useSwitchModeKeepingFocus(mode: Mode) {
  const root = useRef<HTMLDivElement>(null)
  const controlUnmountedWithItsColumn = useRef<ModeControl | null>(null)
  useLayoutEffect(() => {
    const control = controlUnmountedWithItsColumn.current
    if (control === null) return
    controlUnmountedWithItsColumn.current = null
    if (document.activeElement === document.body) root.current?.querySelector<HTMLButtonElement>(control)?.focus()
  }, [mode])
  const pick = (next: Mode, from: ModeControl) => {
    controlUnmountedWithItsColumn.current = from
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
    const button = settingsButton.current
    if (button?.checkVisibility() === true) button.focus()
    else composerBox()?.focus()
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
  readonly accent: Accent
  readonly width: SidebarWidth
  readonly onOpenApps: () => void
}

function useSettingsChord(target: Target | null, settingsOpen: boolean) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSettingsChord(event) || target === null || settingsOpen || document.querySelector('dialog:modal') !== null) return
      event.preventDefault()
      void run({ do: 'editTarget' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [target, settingsOpen])
}

function ChatWindow({ hidden, settings, target, mode, theme, accent, width, onOpenApps }: ChatWindowProps) {
  const preview = useTopic('preview')
  const screen = useTopic('screen')
  const tone = accentTone(accent, toneOfBot(useTopic('bots'), shownChat(useTopic('open'))?.bot ?? null))
  useSettingsChord(target, settings !== null)
  const { root, pick } = useSwitchModeKeepingFocus(mode)
  const { settingsButton, close } = useCloseSettings(settings !== null)
  const [sheet, setSheet] = useState<{ readonly back: Element | null } | null>(null)
  const openSheet = useCallback(() => setSheet(held => held ?? { back: document.activeElement }), [])
  const switcher = <ModeSwitch mode={mode} onPick={next => pick(next, '.mode-switch')} />
  const foot = <div className="account"><HermesFoot target={target} ref={settingsButton} /><AppsButton onOpen={onOpenApps} /><ModeToggle mode={mode} onPick={next => pick(next, '.mode-toggle')} /></div>
  const previewed = preview?.state === 'open' ? preview.address : null
  useEffect(() => {
    if (previewed !== null) showComputer(false)
  }, [previewed])
  const computer = useComputerShown() && settings === null ? screen ?? null : null
  const paned = (preview?.state === 'open' || computer !== null) && settings === null
  const compact = mode === 'bots' && width === 'compact'
  const [tasksOpen, setTasksOpen] = useState(false)
  const shown = useTopic('open')?.shown ?? null
  const pane = shown === null ? null : samePaneOnFirstMessage(shown)
  useEffect(() => setTasksOpen(false), [pane])
  const settingsOpen = settings !== null
  const openTasks = useCallback(() => {
    if (!settingsOpen && !hidden) setTasksOpen(true)
  }, [settingsOpen, hidden])
  return (
    <div ref={root} className="window" hidden={hidden} data-preview={paned ? (computer === null && preview?.state === 'open' ? preview.layout : 'beside') : undefined} data-compact={compact || undefined} data-settings={settings !== null || undefined}>
      {mode === 'bots' && <BotsSidebar head={switcher} compact={compact} foot={foot} />}
      {mode === 'chats' && <ChatsSidebar head={<>{switcher}<BotPicker /></>} foot={foot} />}
      <div key="screen" className="screen" data-accent={tone ?? undefined} hidden={settings !== null || tasksOpen}>
        <ChatScreen target={target} />
      </div>
      {tasksOpen && settings === null && <Tasks onClose={() => setTasksOpen(false)} />}
      {settings !== null && <Settings setup={settings} mode={mode} theme={theme} accent={accent} onRequestClose={close} onShowShortcuts={openSheet} />}
      <DraftSweep />
      <Shortcuts onSheet={openSheet} onTasks={openTasks} />
      {sheet !== null && <ShortcutSheet back={sheet.back} onClose={() => setSheet(null)} />}
      {computer !== null ? <ComputerView view={computer} /> : paned && preview?.state === 'open' && <Preview preview={preview} />}
    </div>
  )
}

export function App() {
  const setup = useTopic('setup')
  const mode = useTopic('mode')
  const theme = useTopic('theme')
  const accent = useTopic('accent')
  const width = useTopic('sidebarWidth')
  const intro = useTopic('intro')
  const [appsOpen, setAppsOpen] = useState(false)
  const appsBack = useRef<Element | null>(null)
  const openApps = useCallback(() => {
    appsBack.current = document.activeElement
    setAppsOpen(true)
  }, [])
  if (setup === undefined || mode === undefined || theme === undefined || accent === undefined || width === undefined || intro === undefined) return null
  const screen = screenOf(setup)
  const live = setup.at === 'pinned' ? null : setup.live
  const cover = introInFront(setup, intro)
  return (
    <>
      {(setup.at === 'pinned' || live !== null) && (
        <Epoch value={epochOf(setup)}>
          <ChatWindow key={epochOf(setup)} hidden={screen.show === 'saved' || cover} settings={screen.show === 'settings' ? screen.setup : null} target={live?.target ?? null} mode={mode} theme={theme} accent={accent} width={width} onOpenApps={openApps} />
          {/* Outside the window a new connection remounts, so a pick main refused for the old one comes back over the new one. */}
          {screen.show !== 'saved' && !cover && <Palette target={live?.target ?? null} settingsOpen={screen.show === 'settings'} />}
          {screen.show !== 'saved' && !cover && <Apps open={appsOpen} back={appsBack} onOpen={openApps} onClose={() => setAppsOpen(false)} />}
        </Epoch>
      )}
      {screen.show === 'first-run' && <FirstRun setup={screen.setup} />}
      {cover && live !== null && <Intro target={live.target} />}
      {screen.show === 'saved' && !cover && <Saved target={screen.live.target} />}
    </>
  )
}
