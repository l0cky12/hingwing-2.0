import type { Bot, BotDetails, BotDraft, BotId, CommandOutcome } from '@highwing/hermes/domain'
import { useState, type ReactNode } from 'react'
import type { PictureChoice } from '../../ipc-contract'
import { Avatar } from './Avatar'
import { BotForm } from './BotForm'
import { draftOf, saveEdit, type EditCalls, type Submitted } from './bot-form'
import { useForgetPicture } from './pictures'

export interface BotEditorProps extends EditCalls {
  readonly bot: Bot
  readonly details: BotDetails
  readonly onPickPicture: (bot: BotId) => Promise<CommandOutcome<PictureChoice>>
  readonly onRemovePicture: (bot: BotId) => Promise<CommandOutcome>
  readonly onClose: () => void
  readonly className?: string
  readonly tabs?: ReactNode
}

export function BotEditor({ bot, details: loaded, onDescribe, onEdit, onPickPicture, onRemovePicture, onClose, className, tabs }: BotEditorProps) {
  const [details, setDetails] = useState(loaded)
  const [picturing, setPicturing] = useState<{ readonly busy: boolean; readonly words: string | null }>({ busy: false, words: null })
  const forget = useForgetPicture()

  const save = async (draft: BotDraft): Promise<Submitted> => {
    const saved = await saveEdit(details, draft, { onDescribe, onEdit })
    setDetails(saved.details)
    return saved.submitted
  }
  const picture = async (change: () => Promise<CommandOutcome<PictureChoice | void>>) => {
    setPicturing({ busy: true, words: null })
    const outcome = await change()
    if (outcome.ok && outcome.value !== 'cancelled') forget(bot.id)
    setPicturing({ busy: false, words: outcome.ok ? null : outcome.refusal.message })
  }

  return (
    <BotForm title={details.name} submitLabel="Save" initial={draftOf(loaded)} problemOf={() => null} models="none" onSubmit={save} onClose={onClose} className={className}>
      {tabs}
      <div className="bot-picture">
        <Avatar bot={bot} size={56} />
        <button type="button" disabled={picturing.busy} onClick={() => void picture(() => onPickPicture(bot.id))}>Upload picture</button>
        {bot.picture && <button type="button" disabled={picturing.busy} onClick={() => void picture(() => onRemovePicture(bot.id))}>Remove picture</button>}
        {picturing.words !== null && <p className="form-refused" role="alert">{picturing.words}</p>}
      </div>
    </BotForm>
  )
}
