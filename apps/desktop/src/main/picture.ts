import { PICTURE_MAX_BYTES, PICTURE_RULE, pictureTypeOf, type BotId, type CommandOutcome } from '@highwing/hermes/domain'
import { open } from 'node:fs/promises'
import type { PictureChoice, PictureFile } from '../ipc-contract'

export function pictureDataUrl(bytes: Uint8Array): string | null {
  if (bytes.length > PICTURE_MAX_BYTES) return null
  const type = pictureTypeOf(bytes)
  return type && `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
}

export interface PictureDeps {
  choose(): Promise<string | null>
  read(path: string, limit: number): Promise<Uint8Array>
  set(bot: BotId, data: string): Promise<CommandOutcome>
}

const TOO_BIG = PICTURE_MAX_BYTES + 1

const UNREADABLE: CommandOutcome<never> = { ok: false, refusal: { kind: 'rejected', message: "Highwing couldn't read that file." } }
const NOT_A_PICTURE: CommandOutcome<never> = { ok: false, refusal: { kind: 'rejected', message: PICTURE_RULE } }

export async function choosePicture(deps: Pick<PictureDeps, 'choose' | 'read'>): Promise<CommandOutcome<PictureFile>> {
  const path = await deps.choose()
  if (path === null) return { ok: true, value: 'cancelled' }
  let bytes: Uint8Array
  try {
    bytes = await deps.read(path, TOO_BIG)
  } catch {
    return UNREADABLE
  }
  const data = pictureDataUrl(bytes)
  return data === null ? NOT_A_PICTURE : { ok: true, value: data }
}

export async function pickPicture(deps: PictureDeps, bot: BotId): Promise<CommandOutcome<PictureChoice>> {
  const chosen = await choosePicture(deps)
  if (!chosen.ok) return chosen
  if (chosen.value === 'cancelled') return { ok: true, value: 'cancelled' }
  const set = await deps.set(bot, chosen.value)
  return set.ok ? { ok: true, value: 'set' } : set
}

export async function readHead(path: string, limit: number): Promise<Uint8Array> {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(limit)
    const { bytesRead } = await file.read(buffer, 0, limit, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}
