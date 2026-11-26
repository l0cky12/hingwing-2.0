import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { Mode } from '../../ipc-contract'
import { Bar } from '../chrome/Chrome'
import { COMMAND_KEY } from '../keys'
import { run, useTopic } from '../store'
import { Bubble, ConnectionCard, People, Segmented, type Segment } from './ConnectionCard'
import type { CardSetup } from './screens'

const SIDEBAR: readonly Segment<Mode>[] = [
  { value: 'bots', label: 'Bots', icon: <People /> },
  { value: 'chats', label: 'Chats', icon: <Bubble /> }
]

/** `where` names the place a shortcut works when Settings is not it. */
const SHORTCUTS: readonly { readonly label: string; readonly key: string; readonly where: string | null }[] = [
  { label: 'Command palette', key: 'K', where: null },
  { label: 'New chat', key: 'N', where: 'In a chat' },
  { label: 'Find in chat', key: 'F', where: 'In a chat' }
]

/** Settings, in the chat column. Main decides when it closes: `onClose` only asks. */
export function Settings({ setup, mode, onClose }: { readonly setup: CardSetup; readonly mode: Mode; readonly onClose: () => void }) {
  const saving = setup.at === 'checking' && setup.step === 'save'
  const link = useTopic('link')
  const heading = useRef<HTMLHeadingElement>(null)
  const ids = useId()

  // On `saved` the connection card puts focus on Change.
  useLayoutEffect(() => {
    if (setup.at !== 'saved') heading.current?.focus()
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || document.querySelector('dialog:modal') !== null) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="screen">
      <Bar where="Settings">
        <button type="button" aria-keyshortcuts="Escape" disabled={saving} onClick={onClose}>Close</button>
      </Bar>
      <main>
        <div className="settings">
          <h2 ref={heading} tabIndex={-1}>Settings</h2>
          <section className="group" aria-labelledby={`${ids}-connection`}>
            <h3 id={`${ids}-connection`}>Connection</h3>
            <ConnectionCard setup={setup} link={link} />
          </section>
          <section className="group" aria-labelledby={`${ids}-sidebar`}>
            <h3 id={`${ids}-sidebar`}>Sidebar</h3>
            <div className="card">
              <div className="row">
                <div className="text">
                  <p className="label" id={`${ids}-show`}>Show in the sidebar</p>
                  <p className="desc">Bots shows your bots. Chats shows the chats of the open bot.</p>
                </div>
                <div className="control">
                  <Segmented labelledBy={`${ids}-show`} value={mode} segments={SIDEBAR} onPick={picked => void run({ do: 'setMode', mode: picked })} />
                </div>
              </div>
            </div>
          </section>
          <section className="group short" aria-labelledby={`${ids}-keys`}>
            <h3 id={`${ids}-keys`}>Keyboard shortcuts</h3>
            <div className="card">
              {SHORTCUTS.map(({ label, key, where }) => (
                <div key={key} className="row">
                  <div className="text"><p className="label">{label}{where !== null && <span className="where">{where}</span>}</p></div>
                  <div className="control keys"><kbd>{COMMAND_KEY}</kbd><kbd>{key}</kbd></div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
