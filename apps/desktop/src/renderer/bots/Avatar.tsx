import type { Bot } from '@highwing/hermes/domain'
import { usePicture } from './pictures'
import { initialOf } from './roster-view'

export function Avatar({ bot, size }: { readonly bot: Bot | Pick<Bot, 'name' | 'tone'>; readonly size: number }) {
  const picture = usePicture('picture' in bot && bot.picture ? bot.id : null)
  if (picture !== null) return <img className="avatar avatar-picture" src={picture} alt="" width={size} height={size} />
  return <span className={`avatar tone-${bot.tone}`} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>{initialOf(bot.name)}</span>
}
