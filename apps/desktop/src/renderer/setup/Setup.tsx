import { failureOf, machineOf, STEP_WORDS, type Target } from '@highwing/hermes/domain'
import { Fragment, useId, useState, type FormEvent } from 'react'
import type { Setup } from '../../ipc-contract'
import { Bar } from '../chrome/Chrome'
import { run } from '../store'
import { CHOICES, KINDS, LEAD, SIGN_IN_HINT, textsOf, type Kind, type Typed } from './form'

type Editing = Extract<Setup, { at: 'form' | 'checking' | 'failed' }>

const NOTICES = {
  unreadable: "Highwing couldn't read its saved connection, so it is asking again. The old file is kept under another name when you connect.",
  newer: 'A newer Highwing saved the connection on this computer. This one can\'t read it, and keeps that file under another name when you connect.'
} as const

function Progress({ setup }: { readonly setup: Extract<Setup, { at: 'checking' }> }) {
  return (
    <>
      <p className="progress" role="status" aria-label="Checking">
        <span className="glyph" />{STEP_WORDS[setup.step](machineOf(setup.target))}
      </p>
      {setup.step === 'sign-in' && <p className="hint">{SIGN_IN_HINT}</p>}
    </>
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
  const [kind, setKind] = useState<Kind>(shown?.kind ?? 'remote')
  const [texts, setTexts] = useState(() => textsOf(shown))
  const [problem, setProblem] = useState<Extract<Typed, { ok: false }> | null>(null)
  const id = useId()
  const busy = setup.at === 'checking'
  const leave = setup.live !== null ? 'Cancel' : setup.at === 'checking' && setup.step === 'sign-in' ? 'Stop waiting' : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const typed = CHOICES[kind].read(texts[kind])
    setProblem(typed.ok ? null : typed)
    if (typed.ok) void run({ do: 'checkTarget', target: typed.target })
  }

  const failed = setup.at === 'failed' ? failureOf(setup.failure) : null
  const machine = setup.at === 'failed' ? machineOf(setup.target) : ''

  return (
    <div className="screen">
      <Bar where="Connection" />
      <main>
        <form className="setup" onSubmit={submit}>
          <h2>Where does Hermes run?</h2>
          <p className="lead">{LEAD}</p>
          {setup.at === 'form' && setup.notice !== null && <p className="kept" role="note">{NOTICES[setup.notice]}</p>}
          <fieldset disabled={busy}>
            <legend className="sr">Where Hermes runs</legend>
            {KINDS.map(choice => {
              const { label, field } = CHOICES[choice]
              const warning = field?.warning(texts[choice]) ?? null
              return (
                <Fragment key={choice}>
                  <label className="choice">
                    <input type="radio" name="kind" checked={kind === choice} onChange={() => { setKind(choice); setProblem(null) }} />
                    {label}
                  </label>
                  {field !== null && (
                    <div className="field" hidden={kind !== choice}>
                      <label htmlFor={`${id}-${choice}`}>{field.label}</label>
                      <input
                        id={`${id}-${choice}`} type="text" spellCheck={false} autoCapitalize="off" autoComplete="off" autoFocus={kind === choice}
                        placeholder={field.placeholder} aria-describedby={`${id}-${choice}-hint${warning === null ? '' : ` ${id}-${choice}-warning`}`} value={texts[choice]}
                        onChange={event => { setTexts({ ...texts, [choice]: event.target.value }); setProblem(null) }}
                      />
                      <p id={`${id}-${choice}-hint`} className="hint">{field.hint}</p>
                      {warning !== null && <p id={`${id}-${choice}-warning`} className="caution" role="status">{warning}</p>}
                    </div>
                  )}
                </Fragment>
              )
            })}
          </fieldset>
          {setup.at === 'checking' && <Progress setup={setup} />}
          {problem !== null
            ? <Problem words={problem.words} fix={problem.fix} />
            : failed !== null && <Problem words={failed.words(machine)} fix={failed.fix(machine)} />}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>Connect</button>
            {leave !== null && <button type="button" onClick={() => void run({ do: 'keepTarget' })}>{leave}</button>}
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
