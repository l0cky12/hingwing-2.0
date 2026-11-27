import type { Bot } from '@highwing/hermes/domain'
import { useState } from 'react'
import { faceOf, faceSvg, type FaceMood } from './look'
import { usePicture } from './pictures'
import { initialOf } from './roster-view'

export function Avatar({ bot, size }: { readonly bot: Bot | Pick<Bot, 'name' | 'tone'>; readonly size: number }) {
  const picture = usePicture('picture' in bot && bot.picture ? bot.id : null)
  const [broken, setBroken] = useState<string | null>(null)
  if (picture !== null && picture !== broken) {
    return <img className="avatar avatar-picture" src={picture} alt="" width={size} height={size} onError={() => setBroken(picture)} />
  }
  return <span className={`avatar tone-${bot.tone}`} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>{initialOf(bot.name)}</span>
}

export function BotFace({ bot, mood, size }: { readonly bot: Pick<Bot, 'name' | 'tone'>; readonly mood: FaceMood; readonly size: number }) {
  const { shape, color } = faceOf(bot)
  return <span className="face" data-mood={mood} aria-hidden="true" dangerouslySetInnerHTML={{ __html: faceSvg(shape, color, size, mood) }} />
}
