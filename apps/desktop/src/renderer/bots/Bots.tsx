import type { Bot, BotId, Bots } from '@highwing/hermes/domain'
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { useTopic } from '../store'
import { initialOf, listOf, selectedIn, UNASSIGNED } from './roster-view'

const NO_NEW_BOT = "Highwing can't create bots yet"
const CARET_KEYS: ReadonlySet<string> = new Set(['PageUp', 'PageDown', 'End'])

export function BotsSidebar() {
  return <BotsPanel bots={useTopic('bots')} />
}

function Avatar({ bot, size }: { readonly bot: Bot; readonly size: number }) {
  return <span className={`avatar tone-${bot.tone}`} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>{initialOf(bot.name)}</span>
}

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 } as const
const Search = () => <svg {...icon}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
const Plus = () => <svg {...icon}><path d="M12 5v14M5 12h14" /></svg>
const Close = () => <svg {...icon}><path d="M6 6l12 12M18 6 6 18" /></svg>
const Star = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" /></svg>

export function BotsPanel({ bots }: { readonly bots: Bots | undefined }) {
  const [picked, setPicked] = useState<BotId | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const searchButton = useRef<HTMLButtonElement>(null)
  const ids = useId()
  const selected = selectedIn(bots, picked)
  const list = listOf(bots, query)
  const { featured, sections } = list.show === 'roster' ? list : { featured: null, sections: [] }
  const closeSearch = () => {
    // The Search bots button is back in the page only once this has rendered.
    flushSync(() => setQuery(null))
    searchButton.current?.focus()
  }
  const onSearchKey = (event: KeyboardEvent) => {
    if (CARET_KEYS.has(event.key)) event.stopPropagation()
    if (event.key !== 'Escape') return
    // The chat's find bar closes on an Escape nobody claimed. This one closes the search only.
    event.preventDefault()
    closeSearch()
  }
  return (
    <aside className="bots" aria-label="Bots" data-state={bots?.state ?? 'loading'}>
      <div className="bots-head" onBlur={event => { if (query === '' && !event.currentTarget.contains(event.relatedTarget)) setQuery(null) }}>
        {query === null
          ? <>
              <h2>Bots</h2>
              <button ref={searchButton} type="button" aria-label="Search bots" title="Search bots" onClick={() => setQuery('')}><Search /></button>
              {/* Stays focusable, so a keyboard or a screen reader finds it and hears why it does nothing. */}
              <button type="button" aria-label="New bot" aria-disabled="true" aria-describedby={`${ids}-new`} title={NO_NEW_BOT}><Plus /></button>
              <span className="sr" id={`${ids}-new`}>{NO_NEW_BOT}</span>
            </>
          : <>
              <input autoFocus aria-label="Search bots" placeholder="Search bots" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onSearchKey} />
              <button type="button" aria-label="Close search" title="Close search" onClick={closeSearch}><Close /></button>
            </>}
      </div>
      <div className="bots-list" aria-busy={list.show === 'loading' || undefined}>
        {list.show === 'note' && <p className="bots-note" role="status">{list.words}</p>}
        {featured !== null && (
          <button type="button" className="bot-feature" aria-label={`${featured.name}, default bot`} aria-current={selected === featured.id || undefined} onClick={() => setPicked(featured.id)}>
            <span className="bot-badged"><Avatar bot={featured} size={48} /><span className="bot-badge" title="Default bot"><Star /></span></span>
            <span className="bot-name">{featured.name}</span>
          </button>
        )}
        {sections.map((section, at) => (
          <section key={section.name ?? ''}>
            <h3>{section.name ?? UNASSIGNED}</h3>
            {section.bots.map((bot, row) => {
              // A profile name may hold a space, which would split an id list, so the id comes from the row's place.
              const preview = `${ids}-${at}-${row}`
              return (
                <button key={bot.id} type="button" className="bot" aria-label={bot.role === null ? bot.name : `${bot.name}, ${bot.role}`} aria-describedby={preview} aria-current={selected === bot.id || undefined} onClick={() => setPicked(bot.id)}>
                  <Avatar bot={bot} size={32} />
                  <span className="bot-text">
                    <span className="bot-name">{bot.name}{bot.role !== null && <span className="bot-role"> · {bot.role}</span>}</span>
                    <span className="bot-preview" id={preview}>{bot.preview ?? 'No messages yet'}</span>
                  </span>
                </button>
              )
            })}
          </section>
        ))}
      </div>
    </aside>
  )
}
