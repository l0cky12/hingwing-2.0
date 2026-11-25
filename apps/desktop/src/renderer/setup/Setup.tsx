import { byKind, CHECK_FAILURES, machineOf, parseSshHost, STEP_WORDS, type Target } from '@highwing/hermes/domain'
import { Fragment, useId, useState, type FormEvent } from 'react'
import type { Setup } from '../../ipc-contract'
import { Bar } from '../chrome/Chrome'
import { run } from '../store'

type Editing = Extract<Setup, { at: 'form' | 'checking' | 'failed' }>

const NOTICES = {
  unreadable: "Highwing couldn't read its saved connection, so it is asking again. The old file is kept under another name when you connect.",
  newer: 'A newer Highwing saved the connection on this computer. This one can\'t read it, and keeps that file under another name when you connect.'
} as const

const NOT_A_NAME = "That isn't a machine name. Use the name Tailscale lists, such as hermes-host."

interface Choice {
  readonly label: string
  /** What the choice asks for under its radio. null: nothing to type. */
  readonly field: { readonly label: string; readonly placeholder: string; readonly hint: string } | null
  readonly target: (text: string) => Target | null
}

/** In the order the form lists them. */
const CHOICES: { readonly [K in Target['kind']]: Choice } = {
  remote: {
    label: 'Another machine on my tailnet',
    field: { label: 'Hermes machine', placeholder: 'hermes-host', hint: 'Its Tailscale name. Add user@ in front to log in as someone else.' },
    target: text => {
      const host = parseSshHost(text)
      return host && { kind: 'remote', host }
    }
  },
  local: { label: 'This computer', field: null, target: () => ({ kind: 'local' }) }
}

const KINDS = Object.keys(CHOICES) as readonly Target['kind'][]

const textOf = (shown: Target | undefined): string => (shown === undefined ? '' : byKind(shown, { local: () => '', remote: ({ host }) => host }))

function Progress({ setup }: { readonly setup: Extract<Setup, { at: 'checking' }> }) {
  return (
    <p className="progress" role="status" aria-label="Checking">
      <span className="glyph" />{STEP_WORDS[setup.step](machineOf(setup.target))}
    </p>
  )
}

function Problem({ words, fix }: { readonly words: string; readonly fix: string | null }) {
  return (
    <div className="problem" role="alert">
      <h3>{words}</h3>
      {fix !== null && <p>{fix}</p>}
    </div>
  )
}

export function SetupForm({ setup }: { readonly setup: Editing }) {
  const shown = setup.at === 'form' ? setup.live?.target : setup.target
  const [kind, setKind] = useState<Target['kind']>(shown?.kind ?? 'remote')
  const [text, setText] = useState(textOf(shown))
  const [notAName, setNotAName] = useState(false)
  const hint = useId()
  const busy = setup.at === 'checking'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const target = CHOICES[kind].target(text)
    setNotAName(target === null)
    if (target !== null) void run({ do: 'checkTarget', target })
  }

  const failed = setup.at === 'failed' ? CHECK_FAILURES[setup.failure] : null
  const machine = setup.at === 'failed' ? machineOf(setup.target) : ''

  return (
    <div className="screen">
      <Bar where="Connection" />
      <main>
        <form className="setup" onSubmit={submit}>
          <h2>Where does Hermes run?</h2>
          <p className="lead">Highwing talks to the Hermes gateway on this computer, or on another machine of your tailnet over SSH.</p>
          {setup.at === 'form' && setup.notice !== null && <p className="kept" role="note">{NOTICES[setup.notice]}</p>}
          <fieldset disabled={busy}>
            <legend className="sr">Where Hermes runs</legend>
            {KINDS.map(choice => {
              const { label, field } = CHOICES[choice]
              return (
                <Fragment key={choice}>
                  <label className="choice">
                    <input type="radio" name="kind" checked={kind === choice} onChange={() => { setKind(choice); setNotAName(false) }} />
                    {label}
                  </label>
                  {field !== null && (
                    <div className="field" hidden={kind !== choice}>
                      <label htmlFor={`${hint}-host`}>{field.label}</label>
                      <input
                        id={`${hint}-host`} type="text" spellCheck={false} autoCapitalize="off" autoComplete="off" autoFocus
                        placeholder={field.placeholder} aria-describedby={hint} value={text}
                        onChange={event => { setText(event.target.value); setNotAName(false) }}
                      />
                      <p id={hint} className="hint">{field.hint}</p>
                    </div>
                  )}
                </Fragment>
              )
            })}
          </fieldset>
          {setup.at === 'checking' && <Progress setup={setup} />}
          {notAName
            ? <Problem words={NOT_A_NAME} fix={null} />
            : failed !== null && <Problem words={failed.words(machine)} fix={failed.fix(machine)} />}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>Connect</button>
            {setup.live !== null && <button type="button" onClick={() => void run({ do: 'keepTarget' })}>Cancel</button>}
          </div>
        </form>
      </main>
    </div>
  )
}

export function Saved({ target }: { readonly target: Target }) {
  return (
    <div className="screen">
      <Bar where="Connection" />
      <main>
        <div className="setup saved">
          <h2><span className="glyph" />Highwing now uses the Hermes on {machineOf(target)}.</h2>
          <p className="lead">This connection is saved, and Highwing opens on the chat from now on. To change it, press Connection in the top bar.</p>
          <div className="actions">
            <button type="button" className="primary" autoFocus onClick={() => void run({ do: 'openChat' })}>Open chat</button>
          </div>
        </div>
      </main>
    </div>
  )
}
