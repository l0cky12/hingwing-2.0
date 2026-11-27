import { machineOf, shownChat, type Target } from '@highwing/hermes/domain'
import { useRef, useState } from 'react'
import { run, useTopic } from '../store'
import { usageView, type UsageAsk } from '../setup/usage-view'
import { accountMenuOf, HELP_URL, type AccountAction } from './account-menu'
import { anchorAt } from './popup-menu'
import { PopupMenu } from './PopupMenu'

export function AccountMenu({ target }: { readonly target: Target | null }) {
  const [ask, setAsk] = useState<UsageAsk | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const asked = useRef(0)
  const sessionId = shownChat(useTopic('open'))?.sessionId ?? null
  const online = useTopic('link')?.state === 'online'
  const machine = target === null ? null : machineOf(target)
  const state = online ? 'Connected' : 'Not connected'

  const close = (focusButton: boolean) => {
    asked.current++
    setAsk(null)
    if (focusButton) button.current?.focus()
  }
  const toggle = async () => {
    if (ask !== null) return close(false)
    const request = ++asked.current
    if (sessionId === null) return setAsk({ at: 'idle' })
    setAsk({ at: 'reading', sessionId })
    const outcome = await run({ do: 'accountUsage', sessionId })
    if (request === asked.current) setAsk({ at: 'settled', sessionId, outcome })
  }
  const choose = (action: AccountAction) => {
    close(false)
    if (action === 'settings') void run({ do: 'editTarget' })
    else if (action === 'help') void run({ do: 'browse', url: HELP_URL })
    else if (action === 'quit') void run({ do: 'quit' })
  }

  return (
    <>
      <button
        ref={button} type="button" className="account-button" aria-haspopup="menu" aria-expanded={ask !== null}
        aria-label={`Hermes${machine === null ? '' : ` on ${machine}`}, ${state}`} onClick={() => void toggle()}
      >
        <span className="account-mark" aria-hidden="true">H</span>
        <span className="account-name" aria-hidden="true">
          <span>Hermes</span>
          <span className="account-detail">{machine === null ? state : `on ${machine}`}</span>
          {machine !== null && <span className="account-detail" data-online={online || undefined}>{state}</span>}
        </span>
      </button>
      {ask !== null && (
        <PopupMenu
          label="Account" className="account-menu" groups={accountMenuOf(usageView(sessionId, ask), target !== null)}
          anchor={() => {
            const box = button.current?.getBoundingClientRect() ?? { left: 0, top: 0, right: 0, bottom: 0 }
            return anchorAt({ by: 'more' }, box, box.right)
          }}
          owns={element => button.current?.contains(element) === true} onChoose={choose} onClose={how => close(how !== 'away')}
        />
      )}
    </>
  )
}
