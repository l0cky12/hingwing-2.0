import type { Bot, BotDetails, BotDraft, BotId, CommandOutcome } from '@highwing/hermes/domain'
import { useContext, useState, type ReactNode } from 'react'
import type { PictureChoice } from '../../ipc-contract'
import { Epoch } from '../store'
import { Avatar } from './Avatar'
import { BotForm } from './BotForm'
import { draftOf, saveEdit, type EditCalls, type Submitted } from './bot-form'
import { usePetPicture, type PetCalls } from './pet-picture'
import { useForgetPicture, usePictureWrites } from './pictures'

export interface BotEditorProps extends EditCalls {
  readonly bot: Bot
  readonly details: BotDetails
  /** `epoch`: the connection the editor was opened on, so main refuses a change that waited out a switch to another Hermes. */
  readonly onPickPicture: (bot: BotId, epoch: number) => Promise<CommandOutcome<PictureChoice>>
  readonly onRemovePicture: (bot: BotId, epoch: number) => Promise<CommandOutcome>
  readonly pet: PetCalls
  readonly onClose: () => void
  readonly className?: string
  readonly tabs?: (sending: boolean) => ReactNode
}

export function BotEditor({ bot, details: loaded, onDescribe, onEdit, onPickPicture, onRemovePicture, pet, onClose, className, tabs }: BotEditorProps) {
  const [details, setDetails] = useState(loaded)
  const [picturing, setPicturing] = useState<{ readonly doing: 'file' | 'pet' | null; readonly words: string | null }>({ doing: null, words: null })
  const forget = useForgetPicture()
  const { claim, write } = usePictureWrites()
  const epoch = useContext(Epoch)
  const drawPet = usePetPicture(pet)

  const save = async (draft: BotDraft): Promise<Submitted> => {
    const saved = await saveEdit(details, draft, { onDescribe, onEdit })
    setDetails(saved.details)
    return saved.submitted
  }
  const picture = async (change: () => Promise<CommandOutcome<PictureChoice | void>>, doing: 'file' | 'pet' = 'file') => {
    setPicturing({ doing, words: null })
    if (doing === 'file') claim(bot.id)
    const outcome = await (doing === 'file' ? write(bot.id, change) : change())
    if (outcome.ok && outcome.value !== 'cancelled' && doing === 'file') forget(bot.id)
    setPicturing({ doing: null, words: outcome.ok ? null : outcome.refusal.message })
  }

  return (
    <BotForm title={details.name} submitLabel="Save" initial={draftOf(loaded)} problemOf={() => null} models="none" onSubmit={save} onClose={onClose} className={className}>
      {(_, sending) => (
        <>
          {tabs?.(sending)}
          <div className="bot-picture">
            <Avatar bot={bot} size={56} />
            <button type="button" disabled={picturing.doing !== null} onClick={() => void picture(() => onPickPicture(bot.id, epoch))}>Upload picture</button>
            <button type="button" disabled={picturing.doing !== null} onClick={() => void picture(() => drawPet(bot.id, details), 'pet')}>{picturing.doing === 'pet' ? 'Drawing…' : 'Generate pet picture'}</button>
            {bot.picture && <button type="button" disabled={picturing.doing !== null} onClick={() => void picture(() => onRemovePicture(bot.id, epoch))}>Remove picture</button>}
            {picturing.words !== null && <p className="form-refused" role="alert">{picturing.words}</p>}
          </div>
        </>
      )}
    </BotForm>
  )
}
