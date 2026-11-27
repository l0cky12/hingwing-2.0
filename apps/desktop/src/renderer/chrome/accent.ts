import { botsIn, type AvatarTone, type BotId, type Bots } from '@highwing/hermes/domain'
import type { Accent } from '../../ipc-contract'

export const accentTone = (accent: Accent, botTone: AvatarTone | null): AvatarTone | null => (accent === 'bot' ? botTone : accent)

export const toneOfBot = (bots: Bots | undefined, bot: BotId | null): AvatarTone | null =>
  bot === null || bots?.state !== 'listed' ? null : botsIn(bots.roster).find(held => held.id === bot)?.tone ?? null
