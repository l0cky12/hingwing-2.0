import type { Bot, BotCreated, BotDetails, BotDraft, BotId, ModelMenu, SessionId } from '@highwing/hermes/domain'
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { pickBotPicture, run, useTopic } from '../store'
import { Avatar } from './Avatar'
import { BotEditor, type BotEditorProps } from './BotEditor'
import { nameProblem } from './bot-form'
import type { LookCalls } from './LookPicker'
import { NewBotForm } from './NewBotForm'
import { Routines, type RoutinesProps } from './Routines'

export const BOT_EDIT_CALLS: Pick<BotEditorProps, 'onDescribe' | 'onEdit' | 'onPickPicture' | 'onRemovePicture'> = {
  onDescribe: bot => run({ do: 'describeBot', bot }),
  onEdit: (bot, edit, revision) => run({ do: 'editBot', bot, edit, revision }),
  onPickPicture: bot => pickBotPicture(bot),
  onRemovePicture: bot => run({ do: 'removeBotPicture', bot })
}

export const LOOKS: LookCalls = {
  canGenerate: () => run({ do: 'canGeneratePicture' }),
  generate: prompt => run({ do: 'generatePicture', prompt }),
  choose: () => window.highwing.choosePicture(),
  pets: () => run({ do: 'pets' }),
  petPicture: ({ slug, url }) => run({ do: 'petPicture', slug, url })
}

const ROUTINE_CALLS: Pick<RoutinesProps, 'onList' | 'onControl' | 'onRuns'> = {
  onList: bot => run({ do: 'listRoutines', bot }),
  onControl: (bot, routine, action) => run({ do: 'controlRoutine', bot, routine, action }),
  onRuns: (bot, routine) => window.highwing.routineRuns(bot, routine)
}

type Panel =
  | { readonly at: 'closed' }
  | { readonly at: 'open'; readonly bot: Bot; readonly details: BotDetails }
  | { readonly at: 'refused'; readonly bot: Bot; readonly words: string }

const CLOSED: Panel = { at: 'closed' }

/** Add a tab here when its content lands. The row stays hidden until there is more than one. */
const TABS = [{ id: 'details', label: 'Details' }, { id: 'routines', label: 'Routines' }] as const
type TabId = typeof TABS[number]['id']

export function useBotPanel() {
  const [panel, setPanel] = useState<Panel>(CLOSED)
  const asked = useRef(0)
  const open = useCallback(async (bot: Bot) => {
    const at = ++asked.current
    const outcome = await BOT_EDIT_CALLS.onDescribe(bot.id)
    // Only the newest open lands, and never over a dialog another control opened while Hermes answered.
    if (at !== asked.current || document.querySelector('dialog[open]') !== null) return
    setPanel(outcome.ok ? { at: 'open', bot, details: outcome.value } : { at: 'refused', bot, words: outcome.refusal.message })
  }, [])
  const close = useCallback(() => {
    asked.current++
    setPanel(CLOSED)
  }, [])
  return { panel, open, close }
}

export interface TabRowProps<T extends string> {
  readonly tabs: readonly { readonly id: T; readonly label: string }[]
  readonly selected: T
  readonly onSelect: (id: T) => void
}

export function TabRow<T extends string>({ tabs, selected, onSelect }: TabRowProps<T>) {
  if (tabs.length < 2) return null
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (by === 0) return
    const at = (tabs.findIndex(tab => tab.id === selected) + by + tabs.length) % tabs.length
    onSelect(tabs[at]!.id)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[at]?.focus()
  }
  return (
    <div role="tablist" className="bot-tabs" onKeyDown={step}>
      {tabs.map(tab => (
        <button key={tab.id} type="button" role="tab" aria-selected={tab.id === selected} tabIndex={tab.id === selected ? 0 : -1} onClick={() => onSelect(tab.id)}>{tab.label}</button>
      ))}
    </div>
  )
}

/** `current` is the roster's entry for the open chat's bot, which shows a picture changed in the panel. */
export function BotPanel({ panel, current, onClose }: { readonly panel: Panel; readonly current: Bot | null; readonly onClose: () => void }) {
  if (panel.at === 'open') {
    const bot = current?.id === panel.bot.id ? current : panel.bot
    return <OpenPanel key={bot.id} bot={bot} details={panel.details} onClose={onClose} />
  }
  return panel.at === 'refused' ? <Refused bot={panel.bot} words={panel.words} onClose={onClose} /> : null
}

/**
 * The Details form stays mounted under another tab and under the New bot form, so an edit not yet saved is still there on the way back.
 * New bot… is off while Save is out: a save that lands closes the panel, and would take an open New bot form with it.
 */
function OpenPanel({ bot, details, onClose }: { readonly bot: Bot; readonly details: BotDetails; readonly onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('details')
  const [making, setMaking] = useState<ModelMenu | 'loading' | null>(null)
  const [made, setMade] = useState<BotCreated | null>(null)
  const bots = useTopic('bots')
  const startNew = () => {
    setMade(null)
    setMaking('loading')
    void run({ do: 'botModels', bot: null }).then(outcome => { if (outcome.ok) setMaking(held => held && outcome.value) })
  }
  const create = async (draft: BotDraft, picture: string) => {
    const outcome = await run({ do: 'createBot', draft, picture })
    if (outcome.ok) setMade(outcome.value)
    return outcome
  }
  const tabs = <TabRow tabs={TABS} selected={tab} onSelect={setTab} />
  const warned = made !== null && made.warnings.length > 0 && (
    <p className="form-refused bots-warned" role="status">
      {made.warnings.map((warning, at) => <span key={at}>Hermes made {made.bot}, with a warning: {warning}</span>)}
    </p>
  )
  return (
    <>
      <BotEditor
        bot={bot} details={details} className={tab === 'details' ? 'bot-panel' : `bot-panel on-${tab}`}
        tabs={sending => (
          <>
            {tabs}
            <button type="button" className="bot-new" aria-haspopup="dialog" disabled={sending} onClick={startNew}>New bot…</button>
            {warned}
            {tab === 'routines' ? <RoutinesTab bot={bot} onClose={onClose} /> : null}
          </>
        )}
        {...BOT_EDIT_CALLS} onClose={onClose}
      />
      {making !== null && <NewBotForm problemOf={name => nameProblem(name, bots)} models={making} looks={LOOKS} onCreate={create} onClose={() => setMaking(null)} />}
    </>
  )
}

/** The Details form's Save and Cancel are hidden under this tab, so it has a Close of its own. */
function RoutinesTab({ bot, onClose }: { readonly bot: Bot; readonly onClose: () => void }) {
  const onOpenRun = useCallback((owner: BotId, sessionId: SessionId) => {
    void run({ do: 'open', ref: { kind: 'run', bot: owner, sessionId } })
    onClose()
  }, [onClose])
  return (
    <div className="routines-tab" role="tabpanel" aria-label="Routines">
      <Routines bot={bot.id} name={bot.name} revision={useTopic('routines')} onOpenRun={onOpenRun} {...ROUTINE_CALLS} />
      <div className="form-choices"><button type="button" onClick={onClose}>Close</button></div>
    </div>
  )
}

function Refused({ bot, words, onClose }: { readonly bot: Bot; readonly words: string; readonly onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const shown = dialog.current
    if (shown?.open === false) shown.showModal()
    return () => shown?.close()
  }, [])
  return (
    <dialog ref={dialog} className="bot-form bot-panel" aria-label={bot.name} onCancel={event => { event.preventDefault(); onClose() }}>
      <h2>{bot.name}</h2>
      <Avatar bot={bot} size={56} />
      <p className="form-refused" role="alert">{words}</p>
      <div className="form-choices"><button type="button" autoFocus onClick={onClose}>Close</button></div>
    </dialog>
  )
}
