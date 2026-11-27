import {
  MANAGERS, shownBot, type Bot, type BotId, type BotManagers, type Bots, type Command, type CommandOutcome, type Manager, type ManagerName, type OpenChat
} from '@highwing/hermes/domain'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Avatar } from '../bots/Avatar'
import { BotItems } from '../bots/BotPicker'
import { botIn, listOf, pickerOf } from '../bots/roster-view'
import { usePickMenu } from '../chat/menu'
import { Chevron } from '../chrome/ModeSwitch'
import { run, useTopic } from '../store'
import { NO_BOT, readOf, saysOf, sectionOf, STATES, stillUnlocked, type Read } from './managers-view'

type ManagerCommand = Extract<Command, { do: 'passwordManagers' | 'usePasswordManager' | 'unlockPasswordManager' | 'lockPasswordManager' }>
type Change = Exclude<ManagerCommand, { do: 'passwordManagers' }>

function startingBot(bots: Bots | undefined, open: OpenChat | undefined): Bot | null {
  const shown = shownBot(open)
  const listed = shown === null ? null : botIn(bots, shown)
  if (listed !== null || bots?.state !== 'listed') return listed
  return bots.roster.featured ?? bots.roster.sections[0]?.bots[0] ?? null
}

export function PasswordManagers({ labelledBy }: { readonly labelledBy: string }) {
  const link = useTopic('link')
  const bots = useTopic('bots')
  const open = useTopic('open')
  const [chosen, setChosen] = useState<BotId | null>(null)
  const bot = (chosen === null ? null : botIn(bots, chosen)) ?? startingBot(bots, open)
  const online = link?.state === 'online'
  const [read, setRead] = useState<Read>({ at: 'reading' })
  const [busy, setBusy] = useState<ManagerName | null>(null)
  const [problem, setProblem] = useState<{ readonly manager: ManagerName; readonly words: string } | null>(null)
  const latest = useRef(0)

  const askLatest = async (command: ManagerCommand): Promise<CommandOutcome<BotManagers> | null> => {
    const asked = ++latest.current
    const outcome = await run(command)
    return asked === latest.current ? outcome : null
  }
  const reread = async (id: BotId) => {
    const outcome = await askLatest({ do: 'passwordManagers', bot: id })
    if (outcome !== null) setRead(readOf(outcome))
  }

  useEffect(() => {
    setRead({ at: 'reading' })
    setProblem(null)
    if (online && bot !== null) void reread(bot.id)
  }, [online, bot?.id])

  const change = async (command: Change) => {
    setBusy(command.manager)
    setProblem(null)
    const outcome = await askLatest(command)
    setBusy(null)
    if (outcome === null) return
    if (!outcome.ok && outcome.refusal.kind !== 'unsupported') {
      setProblem({ manager: command.manager, words: outcome.refusal.message })
      return
    }
    setRead(readOf(outcome))
    const after = outcome.ok ? outcome.value.managers.find(manager => manager.name === command.manager) : undefined
    if (command.do === 'lockPasswordManager' && after?.state.at === 'ready' && bot !== null) setProblem({ manager: after.name, words: stillUnlocked(after.label, bot.name) })
  }

  const section = sectionOf(link, bot !== null, read)
  if (section.show === 'note' || bot === null) return <div className="card managers"><div className="row"><p className="desc">{section.show === 'note' ? section.words : NO_BOT}</p></div></div>
  return (
    <div className="card managers" aria-busy={section.show === 'reading' || undefined}>
      <div className="row">
        <div className="text">
          <p className="label" id={`${labelledBy}-bot`}>Bot</p>
          <p className="desc">Each bot keeps its own password managers.</p>
        </div>
        <div className="control">
          <BotChooser bots={bots} bot={bot} labelledBy={`${labelledBy}-bot`} onPick={setChosen} />
        </div>
      </div>
      {section.show === 'reading' && <div className="row"><p className="desc">Asking Hermes…</p></div>}
      {section.show === 'failed' && (
        <div className="row">
          <p className="desc problem-line" role="alert">{section.words}</p>
          <div className="control"><button type="button" className="btn" onClick={() => void reread(bot.id)}>Try again</button></div>
        </div>
      )}
      {section.show === 'managers' && section.managers.managers.map(manager => (
        <ManagerRow
          key={manager.name} manager={manager} bot={bot} busy={busy === manager.name} anyBusy={busy !== null}
          problem={problem?.manager === manager.name ? problem.words : null} onChange={command => void change(command)}
          onCheck={() => void reread(bot.id)}
        />
      ))}
    </div>
  )
}

function BotChooser({ bots, bot, labelledBy, onPick }: { readonly bots: Bots | undefined; readonly bot: Bot; readonly labelledBy: string; readonly onPick: (bot: BotId) => void }) {
  const { open, setOpen, close, holder, toggle, onKeyDown, menuProps } = usePickMenu()
  const ids = useId()
  const list = pickerOf(listOf(bots, null), bot.id)
  return (
    <div className="bot-pick bot-choose" ref={holder} onKeyDown={onKeyDown}>
      <button
        ref={toggle} type="button" className="bot-pick-button" aria-haspopup="menu" aria-expanded={open} aria-labelledby={`${labelledBy} ${ids}-name`}
        onClick={() => setOpen(held => !held)}
      >
        <Avatar bot={bot} size={20} />
        <span className="bot-pick-name" id={`${ids}-name`}>{bot.name}</span>
        <Chevron />
      </button>
      {open && list.show === 'roster' && (
        <div {...menuProps} className="file-menu bot-pick-menu" aria-label="Bots">
          <BotItems list={list} selected={bot.id} idPrefix={ids} onPick={picked => { close(); onPick(picked) }} />
        </div>
      )}
    </div>
  )
}

interface RowProps {
  readonly manager: Manager
  readonly bot: Bot
  readonly busy: boolean
  readonly anyBusy: boolean
  readonly problem: string | null
  readonly onChange: (command: Change) => void
  readonly onCheck: () => void
}

export function ManagerRow({ manager, bot, busy, anyBusy, problem, onChange, onCheck }: RowProps) {
  const { name, label, state } = manager
  const facts = MANAGERS[name]
  const badge = STATES[state.at]
  const id = useId()
  const target = { bot: bot.id, manager: name }
  const stop = <button type="button" className="btn" aria-label={`Stop using ${label}`} disabled={anyBusy} onClick={() => onChange({ do: 'usePasswordManager', ...target, use: false })}>Stop using</button>
  return (
    <section className="manager" aria-labelledby={`${id}-name`} aria-busy={busy || undefined}>
      <div className="row">
        <div className="text">
          <p className="label"><span id={`${id}-name`}>{label}</span><span className={`state ${badge.tone}`}>{badge.badge}</span></p>
          <p className="desc">{saysOf(state, bot.name)}</p>
        </div>
        <div className="control">
          {state.at === 'missing' && <>
            <a className="btn" href={facts.install} target="_blank" rel="noreferrer" aria-label={`How to install ${label}`}>How to install</a>
            <button type="button" className="btn" aria-label={`Check for ${label} again`} disabled={anyBusy} onClick={onCheck}>Check again</button>
          </>}
          {state.at === 'off' && (
            <button type="button" className="btn primary" aria-label={`Use ${label} with ${bot.name}`} disabled={anyBusy} onClick={() => onChange({ do: 'usePasswordManager', ...target, use: true })}>
              Use with {bot.name}
            </button>
          )}
          {state.at === 'locked' && stop}
          {state.at === 'ready' && <>
            <button type="button" className="btn" aria-label={`Lock ${label}`} disabled={anyBusy} onClick={() => onChange({ do: 'lockPasswordManager', ...target })}>Lock</button>
            {stop}
          </>}
        </div>
      </div>
      {state.at === 'locked' && <Unlock manager={manager} bot={bot} busy={busy} anyBusy={anyBusy} onUnlock={password => onChange({ do: 'unlockPasswordManager', ...target, password })} />}
      {problem !== null && <p className="problem" role="alert">{problem}</p>}
    </section>
  )
}

function Unlock({ manager, bot, busy, anyBusy, onUnlock }: { readonly manager: Manager; readonly bot: Bot; readonly busy: boolean; readonly anyBusy: boolean; readonly onUnlock: (password: string) => void }) {
  const [password, setPassword] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const id = useId()
  const hint = MANAGERS[manager.name].firstTime(bot.id)
  const wasBusy = useRef(busy)
  useEffect(() => {
    if (wasBusy.current && !busy) field.current?.focus()
    wasBusy.current = busy
  }, [busy])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (password === '' || anyBusy) return
    setPassword('')
    onUnlock(password)
  }
  return (
    <form className="unlock" onSubmit={submit}>
      <label htmlFor={`${id}-field`}>Master password</label>
      <div className="unlock-line">
        <input
          ref={field} id={`${id}-field`} type="password" autoComplete="off" spellCheck={false} aria-label={`${manager.label} master password`}
          value={password} disabled={busy} onChange={event => setPassword(event.target.value)}
        />
        <button type="submit" className="btn primary" aria-label={`Unlock ${manager.label}`} disabled={password === '' || anyBusy}>{busy ? 'Unlocking…' : 'Unlock'}</button>
      </div>
      <p className="hint">{hint.lead} <code>{hint.command}</code> {hint.after}</p>
    </form>
  )
}
