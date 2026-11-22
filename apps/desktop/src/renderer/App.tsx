import type { SessionId } from '@highwing/hermes/domain'
import { SESSION_PARAM } from '../ipc-contract'
import { Chat } from './chat/Chat'
import { Banner, TopBar } from './chrome/Chrome'
import { Composer } from './composer/Composer'
import { useTopic } from './store'

const fixed = new URLSearchParams(window.location.search).get(SESSION_PARAM) as SessionId | null

const NO_CHAT = async () => ({ ok: false, refusal: { kind: 'rejected', message: 'There is no chat to send to.' } }) as const

function FirstChat() {
  const first = useTopic('sidebar')?.rows[0]?.id
  return first === undefined
    ? <><main id="scroll" /><Composer canSend={false} showStop={false} onSend={NO_CHAT} onStop={() => {}} /></>
    : <Chat id={first} />
}

export function App() {
  const link = useTopic('link')
  return (
    <>
      <div className="top">
        <TopBar />
        {link !== undefined && <Banner link={link} />}
      </div>
      {fixed !== null ? <Chat id={fixed} /> : <FirstChat />}
    </>
  )
}
