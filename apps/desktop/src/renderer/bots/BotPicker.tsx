import type { Bot, BotId, Bots, OpenChat } from '@highwing/hermes/domain'
import { useId, useRef, useState } from 'react'
import { usePickMenu } from '../chat/menu'
import { Check, Chevron } from '../chrome/ModeSwitch'
import { run, useTopic } from '../store'
import { Avatar } from './Avatar'
import { Star } from './Bots'
import { botIn, listOf, NEW_BOT_BLOCKS, selectedIn, UNASSIGNED, type ListView } from './roster-view'

export function BotPicker() {
  const [refused, setRefused] = useState<string | null>(null)
  const latestPick = useRef(0)
  const pick = async (bot: BotId) => {
    const thisPick = ++latestPick.current
    setRefused(null)
    const outcome = await run({ do: 'open', ref: { kind: 'bot', bot } })
    if (thisPick === latestPick.current) setRefused(outcome.ok ? null : outcome.refusal.message)
  }
  return <BotMenu bots={useTopic('bots')} open={useTopic('open')} refused={refused} onPick={bot => void pick(bot)} />
}

interface BotMenuProps {
  readonly bots: Bots | undefined
  readonly open: OpenChat | undefined
  readonly refused: string | null
  readonly onPick: (bot: BotId) => void
}

export function BotMenu({ bots, open, refused, onPick }: BotMenuProps) {
  const { open: shown, setOpen, close, holder, toggle, onKeyDown, menuProps } = usePickMenu()
  const ids = useId()
  const list = listOf(bots, null)
  const showing = open?.shown?.bot ?? null
  const bot = showing === null ? null : botIn(bots, showing)
  const opening = open?.opening?.kind === 'bot' ? open.opening.bot : null
  const block = list.show === 'loading' ? NEW_BOT_BLOCKS.loading : list.show === 'note' ? list.words : null
  const pick = (picked: BotId) => {
    close()
    onPick(picked)
  }
  return (
    <>
      <div className="bot-pick" ref={holder} data-state={bots?.state ?? 'loading'} onKeyDown={onKeyDown}>
        <button
          ref={toggle} type="button" className="bot-pick-button" aria-haspopup="menu" aria-expanded={shown} aria-busy={opening !== null || undefined}
          aria-disabled={block === null ? undefined : 'true'} aria-describedby={block === null ? undefined : `${ids}-why`} title={block ?? bot?.name}
          onClick={() => { if (block === null) setOpen(held => !held) }}
        >
          {bot === null
            ? <span className="bot-pick-name">Choose a bot</span>
            : <><span className="sr">Bot: </span><Avatar bot={bot} size={20} /><span className="bot-pick-name">{bot.name}</span></>}
          <Chevron />
        </button>
        {block !== null && <span className="sr" id={`${ids}-why`}>{block}</span>}
        {shown && list.show === 'roster' && (
          <div {...menuProps} className="file-menu bot-pick-menu" aria-label="Bots">
            <BotItems list={list} selected={selectedIn(bots, open)} idPrefix={ids} onPick={pick} />
          </div>
        )}
      </div>
      {refused !== null && <p className="err bot-pick-err" role="alert">{refused}</p>}
    </>
  )
}

interface BotItemsProps {
  readonly list: Extract<ListView, { show: 'roster' }>
  readonly selected: BotId | null
  readonly idPrefix: string
  readonly onPick: (bot: BotId) => void
}

export function BotItems({ list, selected, idPrefix, onPick }: BotItemsProps) {
  const item = (bot: Bot, featured: boolean) => (
    <button
      key={bot.id} type="button" role="menuitemradio" aria-checked={bot.id === selected} aria-label={featured ? `${bot.name}, default bot` : undefined}
      tabIndex={-1} onClick={() => onPick(bot.id)}
    >
      <span className="mode-check" aria-hidden="true">{bot.id === selected && <Check />}</span>
      <Avatar bot={bot} size={20} />
      <span className="bot-pick-name">{bot.name}</span>
      {featured && <span className="bot-pick-star" aria-hidden="true" title="Default bot"><Star /></span>}
    </button>
  )
  return (
    <>
      {list.featured !== null && item(list.featured, true)}
      {list.sections.map((section, at) => (
        // An id cannot hold the spaces a section name may, so it comes from the section's place.
        <div key={section.name ?? ''} role="group" aria-labelledby={`${idPrefix}-section-${at}`}>
          <div className="bot-pick-section" id={`${idPrefix}-section-${at}`}>{section.name ?? UNASSIGNED}</div>
          {section.bots.map(bot => item(bot, false))}
        </div>
      ))}
    </>
  )
}
