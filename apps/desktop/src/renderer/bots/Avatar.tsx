import type { Bot } from '@highwing/hermes/domain'
import { useState } from 'react'
import { faceOf, faceSvg, type FaceMood } from './look'
import { usePicture } from './pictures'
import { initialOf } from './roster-view'

/** The picture a bot can be drawn with now: null while it has none, is still being read, or failed to decode. `failed` reports a decode failure. */
export function useBotPicture(bot: Pick<Bot, 'id' | 'picture'> | null): { readonly url: string | null; readonly failed: () => void } {
  const read = usePicture(bot?.picture ? bot.id : null)
  const [broken, setBroken] = useState<string | null>(null)
  return { url: read !== broken ? read : null, failed: () => setBroken(read) }
}

export function Avatar({ bot, size }: { readonly bot: Bot | Pick<Bot, 'name' | 'tone'>; readonly size: number }) {
  const { url, failed } = useBotPicture('picture' in bot ? bot : null)
  if (url !== null) return <img className="avatar avatar-picture" src={url} alt="" width={size} height={size} onError={failed} />
  return <span className={`avatar tone-${bot.tone}`} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>{initialOf(bot.name)}</span>
}

export function BotFace({ bot, mood, size }: { readonly bot: Pick<Bot, 'name' | 'tone'>; readonly mood: FaceMood; readonly size: number }) {
  const { shape, color } = faceOf(bot)
  return <span className="face" data-mood={mood} aria-hidden="true" dangerouslySetInnerHTML={{ __html: faceSvg(shape, color, size, mood) }} />
}
