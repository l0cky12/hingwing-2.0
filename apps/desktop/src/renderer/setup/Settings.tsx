import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import type { Accent, Mode, Theme } from '../../ipc-contract'
import { Bar } from '../chrome/Chrome'
import { COMMAND_KEY } from '../keys'
import { run, useTopic } from '../store'
import { Bubble, ConnectionCard, Monitor, Moon, People, Segmented, Sun, type Segment } from './ConnectionCard'
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

const swatch = (tone: string) => <span className={`swatch tone-${tone}`} aria-hidden="true" />

const ACCENTS: readonly Segment<Accent>[] = [
  { value: 'bot', label: 'Bot', icon: <People /> },
  { value: 'ink', label: 'Ink', icon: swatch('ink') },
  { value: 'slate', label: 'Slate', icon: swatch('slate') },
  { value: 'plum', label: 'Plum', icon: swatch('plum') },
  { value: 'olive', label: 'Olive', icon: swatch('olive') },
  { value: 'mauve', label: 'Mauve', icon: swatch('mauve') },
  { value: 'umber', label: 'Umber', icon: swatch('umber') }
]

const SHORTCUTS: readonly { readonly label: string; readonly key: string; readonly onlyIn: string | null }[] = [
  { label: 'Command palette', key: 'K', onlyIn: null },
  { label: 'New chat', key: 'N', onlyIn: 'In a chat' },
  { label: 'Find in chat', key: 'F', onlyIn: 'In a chat' }
]

export function Settings({ setup, mode, theme, accent, onRequestClose }: { readonly setup: CardSetup; readonly mode: Mode; readonly theme: Theme; readonly accent: Accent; readonly onRequestClose: () => void }) {
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
              <div className="row wrapped">
                <div className="text">
                  <p className="label" id={`${ids}-accent`}>Accent</p>
                  <p className="desc">Bot uses the color of the open chat’s bot.</p>
                </div>
                <div className="control">
                  <Segmented labelledBy={`${ids}-accent`} value={accent} segments={ACCENTS} onPick={picked => void run({ do: 'setAccent', accent: picked })} />
                </div>
              </div>
            </div>
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
