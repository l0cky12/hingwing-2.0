import type { BotId, CommandOutcome } from '@highwing/hermes/domain'
import { run } from '../store'
import { pictureOf } from './look'
import { useForgetPicture } from './pictures'

export interface PetAbout { readonly name: string; readonly description: string }

export function petPrompt({ name, description }: PetAbout): string {
  const job = description.trim()
  return [
    `A cute small pet animal or creature, the mascot of an assistant named ${name.trim()}`,
    ...(job === '' ? [] : [`whose job is: ${job}`]),
    'chibi style, big friendly eyes, centred, facing the viewer, plain soft background, flat clean illustration, no text or letters, no border.'
  ].join(', ')
}

export interface PetCalls {
  readonly generate: (prompt: string) => Promise<CommandOutcome<string>>
  readonly save: (bot: BotId, data: string) => Promise<CommandOutcome>
}

export const PET_CALLS: PetCalls = {
  generate: prompt => run({ do: 'generatePicture', prompt }),
  save: (bot, data) => run({ do: 'setBotPicture', bot, data })
}

const UNDRAWN: CommandOutcome = { ok: false, refusal: { kind: 'rejected', message: "Highwing couldn't draw that picture." } }

/** Has Hermes draw a pet for the bot, then keeps it as the bot's picture. A refusal comes back unchanged and keeps the bot's current picture. */
export async function givePet(calls: PetCalls, bot: BotId, about: PetAbout): Promise<CommandOutcome> {
  const generated = await calls.generate(petPrompt(about))
  if (!generated.ok) return generated
  const drawn = await pictureOf({ from: 'generate', picture: generated.value }, about.name).catch(() => null)
  return drawn === null ? UNDRAWN : calls.save(bot, drawn)
}

export type DrawPet = (bot: BotId, about: PetAbout) => Promise<CommandOutcome>

/** `givePet`, then every avatar reads the bot's picture again. */
export function usePetPicture(calls: PetCalls = PET_CALLS): DrawPet {
  const forget = useForgetPicture()
  return async (bot, about) => {
    const outcome = await givePet(calls, bot, about)
    if (outcome.ok) forget(bot)
    return outcome
  }
}

/** Once a bot is made with the look its maker left alone, draws its pet in the background. The bot keeps its face until Hermes finishes, and for good if Hermes refuses. */
export function petForNewBot(made: CommandOutcome<{ readonly bot: BotId }>, untouched: boolean, drawPet: DrawPet, about: PetAbout): void {
  if (untouched && made.ok) void drawPet(made.value.bot, about)
}
