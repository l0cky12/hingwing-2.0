import type { Bot, BotDetails } from '@highwing/hermes/domain'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { pickBotPicture, run } from '../store'
import { Avatar } from './Avatar'
import { BotEditor, type BotEditorProps } from './BotEditor'

export const BOT_EDIT_CALLS: Pick<BotEditorProps, 'onDescribe' | 'onEdit' | 'onPickPicture' | 'onRemovePicture'> = {
  onDescribe: bot => run({ do: 'describeBot', bot }),
  onEdit: (bot, edit, revision) => run({ do: 'editBot', bot, edit, revision }),
  onPickPicture: bot => pickBotPicture(bot),
  onRemovePicture: bot => run({ do: 'removeBotPicture', bot })
}

type Panel =
  | { readonly at: 'closed' }
  | { readonly at: 'open'; readonly bot: Bot; readonly details: BotDetails }
  | { readonly at: 'refused'; readonly bot: Bot; readonly words: string }

const CLOSED: Panel = { at: 'closed' }

/** Add a tab here when its content lands. The row stays hidden until there is more than one. */
const TABS = [{ id: 'details', label: 'Details' }] as const

export function useBotPanel() {
  const [panel, setPanel] = useState<Panel>(CLOSED)
  const open = useCallback(async (bot: Bot) => {
    const outcome = await BOT_EDIT_CALLS.onDescribe(bot.id)
    setPanel(outcome.ok ? { at: 'open', bot, details: outcome.value } : { at: 'refused', bot, words: outcome.refusal.message })
  }, [])
  const close = useCallback(() => setPanel(CLOSED), [])
  return { panel, open, close }
}

export function TabRow({ tabs }: { readonly tabs: readonly { readonly id: string; readonly label: string }[] }) {
  if (tabs.length < 2) return null
  return (
    <div role="tablist" className="bot-tabs">
      {tabs.map((tab, at) => <button key={tab.id} type="button" role="tab" aria-selected={at === 0}>{tab.label}</button>)}
    </div>
  )
}

/** `current` is the roster's entry for the open chat's bot, which shows a picture changed in the panel. */
export function BotPanel({ panel, current, onClose }: { readonly panel: Panel; readonly current: Bot | null; readonly onClose: () => void }) {
  if (panel.at === 'open') {
    const bot = current?.id === panel.bot.id ? current : panel.bot
    return <BotEditor key={bot.id} bot={bot} details={panel.details} className="bot-panel" tabs={<TabRow tabs={TABS} />} {...BOT_EDIT_CALLS} onClose={onClose} />
  }
  return panel.at === 'refused' ? <Refused bot={panel.bot} words={panel.words} onClose={onClose} /> : null
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
