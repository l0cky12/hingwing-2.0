import { shownBot, type Bot, type BotId, type Bots, type OpenChat } from '@highwing/hermes/domain'
import { useId } from 'react'
import { Avatar } from '../bots/Avatar'
import { BotItems } from '../bots/BotPicker'
import { botIn, listOf, pickerOf } from '../bots/roster-view'
import { usePickMenu } from '../chat/menu'
import { Chevron } from '../chrome/ModeSwitch'

export function startingBot(bots: Bots | undefined, open: OpenChat | undefined): Bot | null {
  const shown = shownBot(open)
  const listed = shown === null ? null : botIn(bots, shown)
  if (listed !== null || bots?.state !== 'listed') return listed
  return bots.roster.featured ?? bots.roster.sections[0]?.bots[0] ?? null
}

export function BotChooser({ bots, bot, labelledBy, onPick }: { readonly bots: Bots | undefined; readonly bot: Bot; readonly labelledBy: string; readonly onPick: (bot: BotId) => void }) {
  const { open, setOpen, close, holder, toggle, onKeyDown, menuProps } = usePickMenu()
  const ids = useId()
  const list = pickerOf(listOf(bots, null), bot.id)
  return (
    <div className="bot-pick bot-choose" ref={holder} onKeyDown={onKeyDown}>
      <button
        ref={toggle} type="button" className="bot-pick-button" aria-haspopup="menu" aria-expanded={open} aria-labelledby={`${labelledBy} ${ids}-name`}
        onClick={() => setOpen(held => !held)}
      >
        <Avatar bot={bot} size={20} />
        <span className="bot-pick-name" id={`${ids}-name`}>{bot.name}</span>
        <Chevron />
      </button>
      {open && list.show === 'roster' && (
        <div {...menuProps} className="file-menu bot-pick-menu" aria-label="Bots">
          <BotItems list={list} selected={bot.id} idPrefix={ids} onPick={picked => { close(); onPick(picked) }} />
        </div>
      )}
    </div>
  )
}
