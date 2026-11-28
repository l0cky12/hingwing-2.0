import { sameModel, type BotId, type BotModelSettings, type ModelOption, type ModelRef } from '@highwing/hermes/domain'
import { useEffect, useId, useReducer, useRef, useState } from 'react'
import { groupModels } from '../bots/bot-form'
import { botIn } from '../bots/roster-view'
import { run, useTopic } from '../store'
import { BotChooser, startingBot } from './BotChooser'
import { NO_BOT } from './managers-view'
import { FIRST_MODELS, modelsSectionOf, moreBackups, nextModels, NOT_CONNECTED, type ModelRow, type ModelsState } from './models-view'

const UNLISTED = 'unlisted'

export function Models({ labelledBy }: { readonly labelledBy: string }) {
  const link = useTopic('link')
  const bots = useTopic('bots')
  const open = useTopic('open')
  const [chosen, setChosen] = useState<BotId | null>(null)
  const bot = (chosen === null ? null : botIn(bots, chosen)) ?? startingBot(bots, open)
  const online = link?.state === 'online'
  const [state, dispatch] = useReducer(nextModels, FIRST_MODELS)
  const latest = useRef(0)
  // Bumped on every bot switch, so a save that answers after A → B → A is not taken for the shown bot's.
  const view = useRef(0)

  const reread = async (id: BotId) => {
    const asked = ++latest.current
    const outcome = await run({ do: 'botModelSettings', bot: id })
    if (asked === latest.current) dispatch({ on: 'read', outcome })
  }

  useEffect(() => {
    view.current++
    dispatch({ on: 'otherBot' })
    if (!online || bot === null) return
    const id = bot.id
    const ask = () => void reread(id)
    ask()
    window.addEventListener('focus', ask)
    return () => {
      latest.current++
      window.removeEventListener('focus', ask)
    }
  }, [online, bot?.id])

  const pickMain = async (id: BotId, model: ModelOption, confirm: boolean) => {
    const at = view.current
    dispatch({ on: 'saving', row: 'main' })
    const outcome = await run({ do: 'setBotModel', bot: id, model, ...(confirm ? { confirm: true as const } : {}) })
    if (view.current !== at) return
    if (!outcome.ok) dispatch({ on: 'failed', row: 'main', words: outcome.refusal.message })
    else dispatch(outcome.value.saved ? { on: 'saved' } : { on: 'confirm', model, message: outcome.value.confirm })
    void reread(id)
  }
  const pickBackup = async (id: BotId, model: ModelOption | null) => {
    const at = view.current
    dispatch({ on: 'saving', row: 'backup' })
    const outcome = await run({ do: 'setBotBackup', bot: id, model })
    if (view.current !== at) return
    dispatch(outcome.ok ? { on: 'saved' } : { on: 'failed', row: 'backup', words: outcome.refusal.message })
    void reread(id)
  }

  if (!online || bot === null) return <div className="card models"><div className="row"><p className="desc">{online ? NO_BOT : NOT_CONNECTED}</p></div></div>
  const section = modelsSectionOf(bot.name, state.read)
  return (
    <div className="card models" aria-busy={section.show === 'reading' || state.saving !== null || undefined}>
      <div className="row">
        <div className="text">
          <p className="label" id={`${labelledBy}-bot`}>Bot</p>
          <p className="desc">Each bot keeps its own models.</p>
        </div>
        <div className="control">
          <BotChooser bots={bots} bot={bot} labelledBy={`${labelledBy}-bot`} onPick={setChosen} />
        </div>
      </div>
      {section.show === 'reading' && <div className="row"><p className="desc">Asking Hermes…</p></div>}
      {section.show === 'note' && <div className="row"><p className="desc">{section.words}</p></div>}
      {section.show === 'failed' && (
        <div className="row">
          <p className="desc problem-line" role="alert">{section.words}</p>
          <div className="control"><button type="button" className="btn" onClick={() => void reread(bot.id)}>Try again</button></div>
        </div>
      )}
      {section.show === 'models' && (
        <ModelRows
          settings={section.settings} state={state} onPickMain={(model, confirm) => void pickMain(bot.id, model, confirm)} onPickBackup={model => void pickBackup(bot.id, model)}
          onKeep={() => dispatch({ on: 'keep' })}
        />
      )}
    </div>
  )
}

export function ModelRows({ settings: { options, main, backup }, state: { saving, confirm, problem }, onPickMain, onPickBackup, onKeep }: {
  readonly settings: BotModelSettings
  readonly state: ModelsState
  readonly onPickMain: (model: ModelOption, confirm: boolean) => void
  readonly onPickBackup: (model: ModelOption | null) => void
  readonly onKeep: () => void
}) {
  const ids = useId()
  const problemOf = (row: ModelRow) => problem?.row === row && <p className="problem" role="alert">{problem.words}</p>
  return <>
    <div className="row">
      <div className="text">
        <p className="label" id={`${ids}-main`}>Default model</p>
        <p className="desc" id={`${ids}-main-desc`}>New chats with this bot start on it. You can still switch a chat’s model from the composer.</p>
      </div>
      <div className="control">
        <ModelSelect labelledBy={`${ids}-main`} describedBy={`${ids}-main-desc`} options={options} value={main} disabled={saving !== null} onPick={model => model !== null && onPickMain(model, false)} />
      </div>
    </div>
    {confirm !== null && (
      <div className="model-confirm" role="alert">
        <p>{confirm.message}</p>
        <button type="button" className="btn primary" disabled={saving !== null} onClick={() => onPickMain(confirm.model, true)}>Use {confirm.model.id} anyway</button>
        {main !== null && <button type="button" className="btn" onClick={onKeep}>Keep {main.id}</button>}
      </div>
    )}
    {problemOf('main')}
    <div className="row">
      <div className="text">
        <p className="label" id={`${ids}-backup`}>Backup model</p>
        <p className="desc" id={`${ids}-backup-desc`}>Used when the default model fails, is down or hits its limit. The chat goes back to the default on its next message.</p>
        {backup.state === 'set' && backup.more > 0 && <p className="desc">{moreBackups(backup.more)}</p>}
        {backup.state === 'unknown' && <p className="desc">{backup.words}</p>}
      </div>
      {backup.state !== 'unknown' && (
        <div className="control">
          <ModelSelect
            labelledBy={`${ids}-backup`} describedBy={`${ids}-backup-desc`} noneLabel="No backup" options={options.filter(option => main === null || !sameModel(main, option))}
            value={backup.state === 'set' ? backup.model : null} disabled={saving !== null} onPick={onPickBackup}
          />
        </div>
      )}
    </div>
    {problemOf('backup')}
  </>
}

function ModelSelect({ labelledBy, describedBy, options, value, noneLabel, disabled, onPick }: {
  readonly labelledBy: string
  readonly describedBy: string
  readonly options: readonly ModelOption[]
  readonly value: ModelRef | null
  readonly noneLabel?: string
  readonly disabled: boolean
  readonly onPick: (model: ModelOption | null) => void
}) {
  const at = value === null ? -1 : options.findIndex(option => sameModel(value, option))
  const unlisted = at < 0 && (value !== null || noneLabel === undefined)
  return (
    <span className="model-pick">
      <select
        className="model-select" aria-labelledby={labelledBy} aria-describedby={describedBy} disabled={disabled}
        value={at >= 0 ? String(at) : unlisted ? UNLISTED : ''} onChange={event => onPick(event.target.value === '' ? null : options[Number(event.target.value)] ?? null)}
      >
        {noneLabel !== undefined && <option value="">{noneLabel}</option>}
        {unlisted && <option value={UNLISTED} disabled>{value?.id ?? 'Not set'}</option>}
        {groupModels(options).map(group => (
          <optgroup key={group.provider} label={group.label}>
            {group.options.map(({ index, option }) => <option key={index} value={index}>{option.id}</option>)}
          </optgroup>
        ))}
      </select>
    </span>
  )
}
