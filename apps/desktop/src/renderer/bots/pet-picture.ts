import type { BotId, CommandOutcome } from '@highwing/hermes/domain'
import { useContext } from 'react'
import { Epoch, runAt } from '../store'
import { pictureOf } from './look'
import { useForgetPicture, usePictureWrites } from './pictures'

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
  readonly generate: (prompt: string, epoch: number) => Promise<CommandOutcome<string>>
  readonly save: (bot: BotId, data: string, epoch: number) => Promise<CommandOutcome>
}

export const PET_CALLS: PetCalls = {
  generate: (prompt, epoch) => runAt(epoch, { do: 'generatePicture', prompt }),
  save: (bot, data, epoch) => runAt(epoch, { do: 'setBotPicture', bot, data })
}

const DROPPED: CommandOutcome = { ok: true, value: undefined }

const UNDRAWN: CommandOutcome = { ok: false, refusal: { kind: 'rejected', message: "Highwing couldn't draw that picture." } }

/**
 * Every call names the epoch the pet was asked in, so main refuses it once another connection is live, where the same bot id may be another bot.
 * `commit` sends the save, or drops it once a newer change to the picture has started.
 */
export async function givePet(calls: PetCalls, bot: BotId, about: PetAbout, epoch: number, commit: (save: () => Promise<CommandOutcome>) => Promise<CommandOutcome>): Promise<CommandOutcome> {
  const generated = await calls.generate(petPrompt(about), epoch)
  if (!generated.ok) return generated
  const drawn = await pictureOf({ from: 'generate', picture: generated.value }, about.name).catch(() => null)
  if (drawn === null) return UNDRAWN
  return commit(() => calls.save(bot, drawn, epoch))
}

export type DrawPet = (bot: BotId, about: PetAbout) => Promise<CommandOutcome>

export function usePetPicture(calls: PetCalls = PET_CALLS): DrawPet {
  const epoch = useContext(Epoch)
  const { claim, write } = usePictureWrites()
  const forget = useForgetPicture()
  return async (bot, about) => {
    const current = claim(bot)
    let saved = false
    const outcome = await givePet(calls, bot, about, epoch, save => write(bot, async () => {
      if (!current()) return DROPPED
      const done = await save()
      saved = done.ok
      return done
    }))
    if (saved) forget(bot)
    return outcome
  }
}

export function petForNewBot(made: CommandOutcome<{ readonly bot: BotId }>, keptDefaultLook: boolean, drawPet: DrawPet, about: PetAbout): void {
  if (keptDefaultLook && made.ok) void drawPet(made.value.bot, about)
}
