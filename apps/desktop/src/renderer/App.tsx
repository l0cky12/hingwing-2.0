import type { SessionId, Target } from '@highwing/hermes/domain'
import type { ReactNode } from 'react'
import { SESSION_PARAM, type Setup } from '../ipc-contract'
import { BotsSidebar } from './bots/Bots'
import { Chat } from './chat/Chat'
import { Banner, TopBar } from './chrome/Chrome'
import { Composer } from './composer/Composer'
import { Saved, SetupForm } from './setup/Setup'
import { Epoch, useTopic } from './store'

const fixed = new URLSearchParams(window.location.search).get(SESSION_PARAM) as SessionId | null

const NO_CHAT = async () => ({ ok: false, refusal: { kind: 'rejected', message: 'There is no chat to send to.' } }) as const

function FirstChat() {
  const first = useTopic('sidebar')?.rows[0]?.id
  return first === undefined
    ? <><main id="scroll" /><Composer canSend={false} showStop={false} onSend={NO_CHAT} onStop={() => {}} onInput={() => {}} /></>
    : <Chat key={first} id={first} />
}

function ChatScreen({ target }: { readonly target: Target | null }) {
  const link = useTopic('link')
  return (
    <>
      <div className="top">
        <TopBar target={target} />
        {link !== undefined && <Banner link={link} />}
      </div>
      {fixed !== null ? <Chat id={fixed} /> : <FirstChat />}
    </>
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
  if (setup === undefined) return null
  const over = (SCREENS[setup.at] as (setup: Setup) => ReactNode)(setup)
  const live = setup.at === 'pinned' ? null : setup.live
  return (
    <>
      {(setup.at === 'pinned' || live !== null) && (
        <Epoch key={live?.epoch ?? 0} value={live?.epoch ?? 0}>
          <div className="window" hidden={over !== null}>
            <BotsSidebar />
            <div className="screen">
              <ChatScreen target={live?.target ?? null} />
            </div>
          </div>
        </Epoch>
      )}
      {over}
    </>
  )
}
