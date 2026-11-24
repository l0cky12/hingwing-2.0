import type { Bot, BotCreated, BotDraft, BotId, Bots, CommandOutcome, Link, ModelMenu, OpenChat } from '@highwing/hermes/domain'
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { run, useTopic } from '../store'
import { BotForm } from './BotForm'
import { EMPTY_DRAFT, nameProblem } from './bot-form'
import { initialOf, listOf, newBotBlock, selectedIn, UNASSIGNED } from './roster-view'

const CARET_KEYS: ReadonlySet<string> = new Set(['PageUp', 'PageDown', 'End'])

export function BotsSidebar() {
  return (
    <BotsPanel
      bots={useTopic('bots')} open={useTopic('open')} link={useTopic('link')}
      onOpen={bot => run({ do: 'open', ref: { kind: 'bot', bot } })}
      onCreate={draft => run({ do: 'createBot', draft })}
      onModels={() => run({ do: 'botModels', bot: null })}
    />
  )
}

interface BotsPanelProps {
  readonly bots: Bots | undefined
  readonly open: OpenChat | undefined
  readonly link: Link | undefined
  readonly onOpen: (bot: BotId) => Promise<CommandOutcome<unknown>>
  readonly onCreate: (draft: BotDraft) => Promise<CommandOutcome<BotCreated>>
  readonly onModels: () => Promise<CommandOutcome<ModelMenu>>
}

function Avatar({ bot, size }: { readonly bot: Bot; readonly size: number }) {
  return <span className={`avatar tone-${bot.tone}`} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>{initialOf(bot.name)}</span>
}

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 } as const
const Search = () => <svg {...icon}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
const Plus = () => <svg {...icon}><path d="M12 5v14M5 12h14" /></svg>
const Close = () => <svg {...icon}><path d="M6 6l12 12M18 6 6 18" /></svg>
const Star = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" /></svg>

export function BotsPanel({ bots, open, link, onOpen, onCreate, onModels }: BotsPanelProps) {
  const [refused, setRefused] = useState<string | null>(null)
  const [form, setForm] = useState<{ readonly models: ModelMenu | null } | null>(null)
  const [made, setMade] = useState<BotCreated | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const searchButton = useRef<HTMLButtonElement>(null)
  const ids = useId()
  const selected = selectedIn(bots, open)
  const opening = open?.opening?.bot ?? null
  const block = newBotBlock(link, bots)
  const pick = async (bot: BotId) => {
    setMade(null)
    const outcome = await onOpen(bot)
    setRefused(outcome.ok ? null : outcome.refusal.message)
  }
  const openForm = () => {
    setForm({ models: null })
    void onModels().then(outcome => { if (outcome.ok) setForm(held => held && { models: outcome.value }) })
  }
  const create = async (draft: BotDraft) => {
    setMade(null)
    const outcome = await onCreate(draft)
    if (outcome.ok) setMade(outcome.value)
    return outcome
  }
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
    <>
      <aside className="bots" aria-label="Bots" data-state={bots?.state ?? 'loading'}>
        <div className="bots-head" onBlur={event => { if (query === '' && !event.currentTarget.contains(event.relatedTarget)) setQuery(null) }}>
          {query === null
            ? <>
                <h2>Bots</h2>
                <button ref={searchButton} type="button" aria-label="Search bots" title="Search bots" onClick={() => setQuery('')}><Search /></button>
                {block === null
                  ? <button type="button" aria-label="New bot" aria-haspopup="dialog" title="New bot" onClick={openForm}><Plus /></button>
                  : <>
                      {/* Stays focusable, so a keyboard or a screen reader finds it and hears why it does nothing. */}
                      <button type="button" aria-label="New bot" aria-disabled="true" aria-describedby={`${ids}-new`} title={block}><Plus /></button>
                      <span className="sr" id={`${ids}-new`}>{block}</span>
                    </>}
              </>
            : <>
                <input autoFocus aria-label="Search bots" placeholder="Search bots" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onSearchKey} />
                <button type="button" aria-label="Close search" title="Close search" onClick={closeSearch}><Close /></button>
              </>}
        </div>
        <div className="bots-list" aria-busy={list.show === 'loading' || undefined}>
          {list.show === 'note' && <p className="bots-note" role="status">{list.words}</p>}
          {featured !== null && (
            <button type="button" className="bot-feature" aria-label={`${featured.name}, default bot`} aria-current={selected === featured.id || undefined} aria-busy={opening === featured.id || undefined} onClick={() => void pick(featured.id)}>
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
                  <button key={bot.id} type="button" className="bot" aria-label={bot.name} aria-describedby={preview} aria-current={selected === bot.id || undefined} aria-busy={opening === bot.id || undefined} onClick={() => void pick(bot.id)}>
                    <Avatar bot={bot} size={32} />
                    <span className="bot-text">
                      <span className="bot-name">{bot.name}</span>
                      <span className="bot-preview" id={preview}>{bot.preview ?? 'No messages yet'}</span>
                    </span>
                  </button>
                )
              })}
            </section>
          ))}
        </div>
        {refused !== null && <p className="bots-refused" role="alert">{refused}</p>}
        {made !== null && made.warnings.length > 0 && (
          <p className="bots-refused bots-warned" role="status">
            {made.warnings.map((warning, at) => <span key={at}>Hermes made {made.bot}, with a warning: {warning}</span>)}
          </p>
        )}
      </aside>
      {form !== null && (
        <BotForm
          title="New bot" submitLabel="Create" initial={EMPTY_DRAFT} problemOf={name => nameProblem(name, bots)}
          models={form.models} onSubmit={create} onClose={() => setForm(null)}
        />
      )}
    </>
  )
}
