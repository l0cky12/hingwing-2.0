import { shownBot } from '@highwing/hermes/domain'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { Mode, Theme } from '../../ipc-contract'
import { botIn } from '../bots/roster-view'
import { Bar } from '../chrome/Chrome'
import { COMMAND_KEY } from '../keys'
import { run, useTopic } from '../store'
import { Bubble, ConnectionCard, Monitor, Moon, People, Segmented, Sun, type Segment } from './ConnectionCard'
import { PasswordManagers } from './PasswordManagers'
import type { CardSetup } from './screens'

const SIDEBAR: readonly Segment<Mode>[] = [
  { value: 'bots', label: 'Bots', icon: <People /> },
  { value: 'chats', label: 'Chats', icon: <Bubble /> }
]

const THEMES: readonly Segment<Theme>[] = [
  { value: 'system', label: 'System', icon: <Monitor /> },
  { value: 'light', label: 'Light', icon: <Sun /> },
  { value: 'dark', label: 'Dark', icon: <Moon /> }
]

const SHORTCUTS: readonly { readonly label: string; readonly key: string; readonly onlyIn: string | null }[] = [
  { label: 'Command palette', key: 'K', onlyIn: null },
  { label: 'New chat', key: 'N', onlyIn: 'In a chat' },
  { label: 'Find in chat', key: 'F', onlyIn: 'In a chat' }
]

export function Settings({ setup, mode, theme, onRequestClose }: { readonly setup: CardSetup; readonly mode: Mode; readonly theme: Theme; readonly onRequestClose: () => void }) {
  const saving = setup.at === 'checking' && setup.step === 'save'
  const link = useTopic('link')
  const heading = useRef<HTMLHeadingElement>(null)
  const ids = useId()

  useLayoutEffect(() => {
    if (setup.at !== 'saved') heading.current?.focus()
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || document.querySelector('dialog:modal') !== null) return
      event.preventDefault()
      onRequestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onRequestClose])

  return (
    <div className="screen">
      <Bar where="Settings">
        <button type="button" aria-keyshortcuts="Escape" disabled={saving} onClick={onRequestClose}>Close</button>
      </Bar>
      <main>
        <div className="settings">
          <h2 ref={heading} tabIndex={-1}>Settings</h2>
          <section className="group" aria-labelledby={`${ids}-connection`}>
            <h3 id={`${ids}-connection`}>Connection</h3>
            <ConnectionCard setup={setup} link={link} />
          </section>
          <section className="group" aria-labelledby={`${ids}-appearance`}>
            <h3 id={`${ids}-appearance`}>Appearance</h3>
            <div className="card">
              <div className="row">
                <div className="text">
                  <p className="label" id={`${ids}-theme`}>Theme</p>
                  <p className="desc">System follows your computer’s light or dark setting.</p>
                </div>
                <div className="control">
                  <Segmented labelledBy={`${ids}-theme`} value={theme} segments={THEMES} onPick={picked => void run({ do: 'setTheme', theme: picked })} />
                </div>
              </div>
            </div>
          </section>
          <section className="group" aria-labelledby={`${ids}-passwords`}>
            <h3 id={`${ids}-passwords`}>Password managers</h3>
            <PasswordManagers labelledBy={`${ids}-passwords`} />
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
          <section className="group" aria-labelledby={`${ids}-permissions`}>
            <h3 id={`${ids}-permissions`}>Permissions</h3>
            <DenyRules />
          </section>
          <section className="group short" aria-labelledby={`${ids}-keys`}>
            <h3 id={`${ids}-keys`}>Keyboard shortcuts</h3>
            <div className="card">
              {SHORTCUTS.map(({ label, key, onlyIn }) => (
                <div key={key} className="row">
                  <div className="text"><p className="label">{label}{onlyIn !== null && <span className="where">{onlyIn}</span>}</p></div>
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

type DenyRead =
  | { readonly at: 'reading' }
  | { readonly at: 'read'; readonly rules: readonly string[] }
  | { readonly at: 'refused'; readonly words: string }

/** Read again when the window comes back to the front: the rules change only in the bot's config.yaml, outside Highwing. */
function DenyRules() {
  const bot = shownBot(useTopic('open'))
  const bots = useTopic('bots')
  const name = bot === null ? null : botIn(bots, bot)?.name ?? null
  const [read, setRead] = useState<DenyRead>({ at: 'reading' })
  const ids = useId()

  useEffect(() => {
    setRead({ at: 'reading' })
    let asked = 0
    const ask = () => {
      const mine = ++asked
      void run({ do: 'denyRules', bot }).then(outcome => {
        if (mine === asked) setRead(outcome.ok ? { at: 'read', rules: outcome.value } : { at: 'refused', words: outcome.refusal.message })
      })
    }
    ask()
    window.addEventListener('focus', ask)
    return () => {
      asked = -1
      window.removeEventListener('focus', ask)
    }
  }, [bot])

  return (
    <div className="card">
      <div className="row">
        <div className="text">
          <p className="label" id={`${ids}-denied`}>Denied commands</p>
          <p className="desc">{name ?? 'This bot'} never runs a command that matches one of these, even with YOLO on. To change them, edit approvals.deny in the bot’s config.yaml.</p>
          {read.at === 'read' && read.rules.length === 0 && <p className="desc">No commands are denied.</p>}
          {read.at === 'refused' && <p className="desc">{read.words}</p>}
        </div>
      </div>
      {read.at === 'read' && read.rules.length > 0 && (
        <ul className="rules" aria-labelledby={`${ids}-denied`}>
          {read.rules.map((rule, index) => <li key={index} className="row"><code>{rule}</code></li>)}
        </ul>
      )}
    </div>
  )
}
