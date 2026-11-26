import type { Bot, BotDetails, BotDraft } from '@highwing/hermes/domain'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BotFormBody, useBotForm } from './BotForm'
import { BotPicture, type PictureCalls } from './BotPicture'
import { draftOf, saveAndReread, type EditCalls, type Submitted } from './bot-form'
import { DETAILS_TABS, LOADING, loadOf, type DetailsLoad } from './details'

type Calls = EditCalls & PictureCalls

const NO_PROBLEM = () => null
const STAY = () => {}

interface DetailsFormProps {
  readonly bot: Bot
  readonly details: BotDetails
  readonly calls: Calls
  readonly onLost: (words: string) => void
}

function DetailsForm({ bot, details: loaded, calls, onLost }: DetailsFormProps) {
  const [details, setDetails] = useState(loaded)
  const save = async (draft: BotDraft): Promise<Submitted> => {
    const saved = await saveAndReread(details, draft, calls)
    setDetails(saved.details)
    if (saved.lost !== null) onLost(saved.lost)
    return saved.submitted
  }
  const form = useBotForm({ initial: draftOf(loaded), problemOf: NO_PROBLEM, onSubmit: save, onSaved: STAY })
  return (
    <BotFormBody form={form} submitLabel="Save" models="none">
      <BotPicture bot={bot} onPickPicture={calls.onPickPicture} onRemovePicture={calls.onRemovePicture} />
    </BotFormBody>
  )
}

interface BotDetailsPanelProps {
  readonly id: string
  readonly bot: Bot
  readonly calls: Calls
  readonly onClose: () => void
  readonly tabs?: typeof DETAILS_TABS
}

export function BotDetailsPanel({ id, bot, calls, onClose, tabs = DETAILS_TABS }: BotDetailsPanelProps) {
  const [load, setLoad] = useState<DetailsLoad>(LOADING)
  const panel = useRef<HTMLElement>(null)
  const describe = useCallback(async () => setLoad(loadOf(await calls.onDescribe(bot.id))), [calls, bot.id])
  useEffect(() => void describe(), [describe])
  useLayoutEffect(() => panel.current?.focus(), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || panel.current?.checkVisibility() !== true) return
      // A control that goes away or turns disabled, such as Save while it sends, leaves focus on the page itself.
      const at = document.activeElement
      if (at !== document.body && !panel.current.contains(at)) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <aside ref={panel} id={id} className="bot-details" aria-label={`${bot.name} details`} tabIndex={-1}>
      <header className="bot-details-head">
        <h2>{bot.name}</h2>
        <button type="button" className="bot-details-close" aria-label="Close details" title="Close details" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>
      {tabs.length > 1 && (
        <div className="bot-details-tabs" role="tablist" aria-label="Sections">
          {tabs.map(tab => <button key={tab.id} type="button" role="tab" aria-selected={tab.id === 'details'}>{tab.label}</button>)}
        </div>
      )}
      <div className="bot-details-body">
        {load.at === 'loading' && <p className="bot-details-note" role="status">Loading</p>}
        {load.at === 'refused' && <p className="form-refused" role="alert">{load.words}</p>}
        {load.at === 'shown' && <DetailsForm bot={bot} details={load.details} calls={calls} onLost={words => setLoad({ at: 'refused', words })} />}
      </div>
    </aside>
  )
}
