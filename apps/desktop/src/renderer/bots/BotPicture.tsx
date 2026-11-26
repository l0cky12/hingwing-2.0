import type { Bot, BotId, CommandOutcome } from '@highwing/hermes/domain'
import { useState } from 'react'
import type { PictureChoice } from '../../ipc-contract'
import { Avatar } from './Avatar'
import { useForgetPicture } from './pictures'

export interface PictureCalls {
  readonly onPickPicture: (bot: BotId) => Promise<CommandOutcome<PictureChoice>>
  readonly onRemovePicture: (bot: BotId) => Promise<CommandOutcome>
}

export function BotPicture({ bot, onPickPicture, onRemovePicture }: PictureCalls & { readonly bot: Bot }) {
  const [picturing, setPicturing] = useState<{ readonly busy: boolean; readonly words: string | null }>({ busy: false, words: null })
  const forget = useForgetPicture()
  const picture = async (change: () => Promise<CommandOutcome<PictureChoice | void>>) => {
    setPicturing({ busy: true, words: null })
    const outcome = await change()
    if (outcome.ok && outcome.value !== 'cancelled') forget(bot.id)
    setPicturing({ busy: false, words: outcome.ok ? null : outcome.refusal.message })
  }
  return (
    <div className="bot-picture">
      <Avatar bot={bot} size={56} />
      <button type="button" disabled={picturing.busy} onClick={() => void picture(() => onPickPicture(bot.id))}>Upload picture</button>
      {bot.picture && <button type="button" disabled={picturing.busy} onClick={() => void picture(() => onRemovePicture(bot.id))}>Remove picture</button>}
      {picturing.words !== null && <p className="form-refused" role="alert">{picturing.words}</p>}
    </div>
  )
}
