import type { Bot, BotDetails, BotDraft } from '@highwing/hermes/domain'
import { useState } from 'react'
import { BotForm } from './BotForm'
import { BotPicture, type PictureCalls } from './BotPicture'
import { draftOf, saveEdit, type EditCalls, type Submitted } from './bot-form'

export interface BotEditorProps extends EditCalls, PictureCalls {
  readonly bot: Bot
  readonly details: BotDetails
  readonly onClose: () => void
}

export function BotEditor({ bot, details: loaded, onDescribe, onEdit, onPickPicture, onRemovePicture, onClose }: BotEditorProps) {
  const [details, setDetails] = useState(loaded)

  const save = async (draft: BotDraft): Promise<Submitted> => {
    const saved = await saveEdit(details, draft, { onDescribe, onEdit })
    setDetails(saved.details)
    return saved.submitted
  }

  return (
    <BotForm title={details.name} submitLabel="Save" initial={draftOf(loaded)} problemOf={() => null} models="none" onSubmit={save} onClose={onClose}>
      <BotPicture bot={bot} onPickPicture={onPickPicture} onRemovePicture={onRemovePicture} />
    </BotForm>
  )
}
