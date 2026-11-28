import { shownChat, type AvatarTone, type Shown, type ShownGroup, type Target } from '@highwing/hermes/domain'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { appearanceStyle, type Appearance } from '../appearance'
import { introInFront } from '../intro'
import { isSettingsChord, isShortcut } from './keys'
import { epochOf, type Accent, type Mode, type SidebarWidth, type Theme } from '../ipc-contract'
import { BotPicker } from './bots/BotPicker'
import { BotsSidebar } from './bots/Bots'
import { useRetryPicturesOnceOnline } from './bots/pictures'
import { ChatsSidebar, DraftSweep } from './chats/Chats'
import { Chat } from './chat/Chat'
import { TypesetMath } from './chat/text'
import { GroupPane } from './groups/GroupPane'
import { accentTone, toneOfBot } from './chrome/accent'
import { Banner, TopBar } from './chrome/Chrome'
import { HermesFoot } from './chrome/HermesFoot'
import { ModeToggle } from './chrome/ModeSwitch'
import { NewChatButton, SearchField } from './chrome/SidebarHead'
import { composerBox, Shortcuts } from './chrome/Shortcuts'
import { ShortcutSheet } from './chrome/ShortcutSheet'
import { Preview } from './preview/Preview'
import { Composer } from './composer/Composer'
import { showComputer, useComputerShown } from './computer/computer'
import { ComputerView } from './computer/Computer'
import { Connectors, ConnectorsButton } from './apps/Connectors'
import { Palette, paletteFrom, type Opened } from './palette/Palette'
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

function useSwitchModeKeepingFocus(mode: Mode) {
  const root = useRef<HTMLDivElement>(null)
  const toggleUnmountedWithItsColumn = useRef(false)
  useLayoutEffect(() => {
    if (!toggleUnmountedWithItsColumn.current) return
    toggleUnmountedWithItsColumn.current = false
    if (document.activeElement === document.body) root.current?.querySelector<HTMLButtonElement>('.mode-toggle')?.focus()
  }, [mode])
  const pick = (next: Mode) => {
    toggleUnmountedWithItsColumn.current = true
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
  readonly onSearch: () => void
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

const canHoldFocus = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement && element !== document.body && element.isConnected && element.closest('[hidden]') === null
  && element.checkVisibility() && !element.matches(':disabled')

const FALLBACKS = ['.settings .change', '.settings > h2', '.composer textarea']
const fallbackFocus = () => FALLBACKS.map(selector => document.querySelector(selector)).find(canHoldFocus) ?? null

type Aside = { readonly at: 'tasks' } | { readonly at: 'connectors'; readonly back: Element | null }

function useAside(pane: string | null, keys: boolean) {
  const [aside, setAside] = useState<Aside | null>(null)
  const restore = useRef<Element | null | undefined>(undefined)
  useEffect(() => setAside(null), [pane])
  useLayoutEffect(() => {
    if (aside !== null || restore.current === undefined) return
    const back = restore.current
    restore.current = undefined
    const held = canHoldFocus(back) ? back : fallbackFocus()
    held?.focus()
  }, [aside])
  const openConnectors = useCallback(() => setAside(held => (held?.at === 'connectors' ? held : { at: 'connectors', back: document.activeElement })), [])
  const close = useCallback(() => {
    restore.current = aside?.at === 'connectors' ? aside.back : undefined
    setAside(null)
  }, [aside])
  useEffect(() => {
    if (!keys) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isShortcut(event, 'apps') || document.querySelector('dialog:modal') !== null) return
      event.preventDefault()
      if (event.repeat) return
      if (aside?.at === 'connectors') close()
      else openConnectors()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [keys, aside, close, openConnectors])
  return { aside, openTasks: useCallback(() => setAside({ at: 'tasks' }), []), openConnectors, close }
}

function ChatWindow({ hidden, settings, target, mode, theme, accent, width, onSearch }: ChatWindowProps) {
  const preview = useTopic('preview')
  const screen = useTopic('screen')
  useAccentOnRoot(accentTone(accent, toneOfBot(useTopic('bots'), shownChat(useTopic('open'))?.bot ?? null)))
  useSettingsChord(target, settings !== null)
  const { root, pick } = useSwitchModeKeepingFocus(mode)
  const { settingsButton, close } = useCloseSettings(settings !== null)
  const [sheet, setSheet] = useState<{ readonly back: Element | null } | null>(null)
  const openSheet = useCallback(() => setSheet(held => held ?? { back: document.activeElement }), [])
  const shown = useTopic('open')?.shown ?? null
  const { aside, openTasks: showTasks, openConnectors, close: closeAside } = useAside(shown === null ? null : samePaneOnFirstMessage(shown), !hidden && settings === null)
  const settingsOpen = settings !== null
  const openTasks = useCallback(() => {
    if (!settingsOpen && !hidden) showTasks()
  }, [settingsOpen, hidden, showTasks])
  const foot = <div className="account"><HermesFoot target={target} ref={settingsButton} /><ConnectorsButton onOpen={openConnectors} /><ModeToggle mode={mode} onPick={pick} /></div>
  const previewed = preview?.state === 'open' ? preview.address : null
  useEffect(() => {
    if (previewed !== null) showComputer(false)
  }, [previewed])
  const covered = settings !== null || aside !== null
  const computer = useComputerShown() && !covered ? screen ?? null : null
  const paned = (preview?.state === 'open' || computer !== null) && !covered
  const compact = mode === 'bots' && width === 'compact'
  return (
    <div ref={root} className="window" hidden={hidden} data-preview={paned ? (computer === null && preview?.state === 'open' ? preview.layout : 'beside') : undefined} data-compact={compact || undefined} data-settings={settings !== null || undefined}>
      {mode === 'bots' && <BotsSidebar head={<NewChatButton />} compact={compact} foot={foot} />}
      {mode === 'chats' && <ChatsSidebar head={<><SearchField onSearch={onSearch} /><NewChatButton /><BotPicker /></>} foot={foot} />}
      <div key="screen" className="screen" hidden={covered}>
        <ChatScreen target={target} />
      </div>
      {aside?.at === 'tasks' && settings === null && <Tasks onClose={closeAside} />}
      {aside?.at === 'connectors' && settings === null && <Connectors onClose={closeAside} />}
      {settings !== null && <Settings setup={settings} mode={mode} theme={theme} accent={accent} onRequestClose={close} onShowShortcuts={openSheet} />}
      <DraftSweep />
      <Shortcuts onSheet={openSheet} onTasks={openTasks} />
      {sheet !== null && <ShortcutSheet back={sheet.back} onClose={() => setSheet(null)} />}
      {computer !== null ? <ComputerView view={computer} /> : paned && preview?.state === 'open' && <Preview preview={preview} />}
    </div>
  )
}

/** On the root, so the palette, dialogs portaled to the body and the diagrams' palette all take the accent. */
function useAccentOnRoot(tone: AvatarTone | null) {
  useLayoutEffect(() => {
    if (tone === null) return
    document.documentElement.dataset.accent = tone
    return () => { delete document.documentElement.dataset.accent }
  }, [tone])
}

function useAppearance(appearance: Appearance | undefined) {
  useLayoutEffect(() => {
    if (appearance === undefined) return
    const { style } = document.documentElement
    for (const [property, value] of Object.entries(appearanceStyle(appearance))) style.setProperty(property, value)
  }, [appearance])
}

export function App() {
  const setup = useTopic('setup')
  const mode = useTopic('mode')
  const theme = useTopic('theme')
  const accent = useTopic('accent')
  const width = useTopic('sidebarWidth')
  const intro = useTopic('intro')
  const appearance = useTopic('appearance')
  useAppearance(appearance)
  const [palette, setPalette] = useState<Opened | null>(null)
  const search = useCallback(() => setPalette(held => held ?? paletteFrom(document.activeElement)), [])
  if (setup === undefined || mode === undefined || theme === undefined || accent === undefined || width === undefined || intro === undefined || appearance === undefined) return null
  const screen = screenOf(setup)
  const live = setup.at === 'pinned' ? null : setup.live
  const cover = introInFront(setup, intro)
  return (
    <TypesetMath value={appearance.math}>
      {(setup.at === 'pinned' || live !== null) && (
        <Epoch value={epochOf(setup)}>
          <ChatWindow key={epochOf(setup)} hidden={screen.show === 'saved' || cover} settings={screen.show === 'settings' ? screen.setup : null} target={live?.target ?? null} mode={mode} theme={theme} accent={accent} width={width} onSearch={search} />
          {/* Outside the window a new connection remounts, so a pick main refused for the old one comes back over the new one. */}
          {screen.show !== 'saved' && !cover && <Palette target={live?.target ?? null} settingsOpen={screen.show === 'settings'} opened={palette} onOpened={setPalette} />}
        </Epoch>
      )}
      {screen.show === 'first-run' && <FirstRun setup={screen.setup} />}
      {cover && live !== null && <Intro target={live.target} />}
      {screen.show === 'saved' && !cover && <Saved target={screen.live.target} />}
    </TypesetMath>
  )
}
