import { pickBotPicture, run } from '../store'
import type { EditCalls } from './bot-form'
import type { PictureCalls } from './BotPicture'

export const EDIT_CALLS: EditCalls & PictureCalls = {
  onDescribe: bot => run({ do: 'describeBot', bot }),
  onEdit: (bot, edit, revision) => run({ do: 'editBot', bot, edit, revision }),
  onPickPicture: bot => pickBotPicture(bot),
  onRemovePicture: bot => run({ do: 'removeBotPicture', bot })
}
