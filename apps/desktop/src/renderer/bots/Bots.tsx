import type { Bot, BotCreated, BotDetails, BotDraft, BotId, Bots, CommandOutcome, GroupDraft, Groups, Link, ModelMenu, OpenChat } from '@highwing/hermes/domain'
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { GroupForm } from '../groups/GroupForm'
import { groupRowsOf, type GroupRowView } from '../groups/group-rows'
import { newChatIn } from '../new-chat'
import { Chevron } from '../chrome/ModeSwitch'
import { run, useTopic } from '../store'
import { Avatar } from './Avatar'
import { BotEditor, type BotEditorProps } from './BotEditor'
import { nameProblem } from './bot-form'
import type { LookCalls } from './LookPicker'
import { NewBotForm } from './NewBotForm'
import { NewMenu } from './NewMenu'
import { plusMenuOf, seatableIn, type PlusItem } from './plus-menu'
import { botIn, listOf, selectedIn } from './roster-view'
import { HIDDEN_CLOSED, hiddenTriggers, nextHidden, sidebarOf, type Row, type RowGroup } from './sidebar-view'

const CARET_KEYS: ReadonlySet<string> = new Set(['PageUp', 'PageDown', 'End'])
const MAC = navigator.userAgent.includes('Mac')

const LOOKS: LookCalls = {
  canGenerate: () => run({ do: 'canGeneratePicture' }),
  generate: prompt => run({ do: 'generatePicture', prompt }),
  choose: () => window.highwing.choosePicture(),
  pets: () => run({ do: 'pets' }),
  petPicture: ({ slug, url }) => run({ do: 'petPicture', slug, url })
}

export function BotsSidebar({ head }: { readonly head: ReactNode }) {
  const open = useTopic('open')
  return (
    <BotsPanel
      head={head} bots={useTopic('bots')} open={open} link={useTopic('link')} groups={useTopic('groups')}
      onOpen={bot => run({ do: 'open', ref: { kind: 'bot', bot } })}
      onNewChat={() => void run(newChatIn(open, crypto.randomUUID()))}
      onCreate={(draft, picture) => run({ do: 'createBot', draft, picture })}
      onCreateGroup={draft => run({ do: 'createGroup', draft })}
      onModels={() => run({ do: 'botModels', bot: null })}
      onDescribe={bot => run({ do: 'describeBot', bot })}
      onEdit={(bot, edit, revision) => run({ do: 'editBot', bot, edit, revision })}
      onPickPicture={bot => window.highwing.pickBotPicture(bot)}
      onRemovePicture={bot => run({ do: 'removeBotPicture', bot })}
      looks={LOOKS}
    />
  )
}

type EditorCalls = Pick<BotEditorProps, 'onDescribe' | 'onEdit' | 'onPickPicture' | 'onRemovePicture'>

interface BotsPanelProps extends EditorCalls {
  readonly head?: ReactNode
  readonly bots: Bots | undefined
  readonly open: OpenChat | undefined
  readonly link: Link | undefined
  readonly groups: Groups | undefined
  readonly onOpen: (bot: BotId) => Promise<CommandOutcome<unknown>>
  readonly onNewChat: () => void
  readonly onCreate: (draft: BotDraft, picture: string) => Promise<CommandOutcome<BotCreated>>
  readonly onCreateGroup: (draft: GroupDraft) => Promise<CommandOutcome>
  readonly onModels: () => Promise<CommandOutcome<ModelMenu>>
  readonly looks: LookCalls
}

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 } as const
const Search = () => <svg {...icon}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
const Close = () => <svg {...icon}><path d="M6 6l12 12M18 6 6 18" /></svg>
const Pencil = () => <svg {...icon}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>
export const Star = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" /></svg>

function DetailsButton({ bot, onClick }: { readonly bot: Bot; readonly onClick: () => void }) {
  const label = `Details for ${bot.name}`
  return <button type="button" className="bot-details" aria-label={label} aria-haspopup="dialog" title={label} onClick={onClick}><Pencil /></button>
}

function GroupChats({ rows }: { readonly rows: readonly GroupRowView[] }) {
  return (
    <section>
      <h3>Group chats</h3>
      <ul className="group-rows">
        {rows.map(row => (
          <li key={row.id} className="group-row">
            <span className="stack" aria-hidden="true">
              {row.faces.map(face => <Avatar key={face.id} bot={face} size={24} />)}
              {row.more > 0 && <span className="stack-more">+{row.more}</span>}
            </span>
            <span className="bot-text">
              <span className="bot-name">{row.name}</span>
              <span className="bot-preview">{row.preview}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

interface BotRowProps {
  readonly row: Row
  readonly current: boolean
  readonly busy: boolean
  readonly onPick: () => void
  readonly onDetails: () => void
}

/** The card or a row, with its details button beside it. */
function BotRow({ row: { bot, place }, current, busy, onPick, onDetails }: BotRowProps) {
  const preview = useId()
  return (
    <div className={place === 'card' ? 'bot-row bot-row-feature' : 'bot-row'} data-place={place}>
      {place === 'card'
        ? <button type="button" className="bot-feature" aria-label={`${bot.name}, default bot`} aria-current={current || undefined} aria-busy={busy || undefined} onClick={onPick}>
            <span className="bot-badged"><Avatar bot={bot} size={48} /><span className="bot-badge" title="Default bot"><Star /></span></span>
            <span className="bot-name">{bot.name}</span>
          </button>
        : <button type="button" className="bot" aria-label={bot.name} aria-describedby={preview} aria-current={current || undefined} aria-busy={busy || undefined} onClick={onPick}>
            <Avatar bot={bot} size={32} />
            <span className="bot-text">
              <span className="bot-name">{bot.name}</span>
              <span className="bot-preview" id={preview}>{bot.preview ?? 'No messages yet'}</span>
            </span>
          </button>}
      <DetailsButton bot={bot} onClick={onDetails} />
    </div>
  )
}

export function BotsPanel({ head = <h2>Bots</h2>, bots, open, link, groups, onOpen, onNewChat, onCreate, onCreateGroup, onModels, looks, ...editor }: BotsPanelProps) {
  const [refused, setRefused] = useState<string | null>(null)
  const [form, setForm] = useState<{ readonly models: ModelMenu | 'loading' } | null>(null)
  const [grouping, setGrouping] = useState(false)
  const closeGroupForm = () => setGrouping(false)
  const [made, setMade] = useState<BotCreated | null>(null)
  const [editing, setEditing] = useState<BotDetails | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [hidden, setHidden] = useState(HIDDEN_CLOSED)
  const searchButton = useRef<HTMLButtonElement>(null)
  const selected = selectedIn(bots, open)
  const opening = open?.opening?.kind === 'bot' ? open.opening.bot : null
  const pick = async (bot: BotId) => {
    setMade(null)
    const outcome = await onOpen(bot)
    setRefused(outcome.ok ? null : outcome.refusal.message)
  }
  const openForm = () => {
    setForm({ models: 'loading' })
    void onModels().then(outcome => { if (outcome.ok) setForm(held => held && { models: outcome.value }) })
  }
  const create = async (draft: BotDraft, picture: string) => {
    setMade(null)
    const outcome = await onCreate(draft, picture)
    if (outcome.ok) setMade(outcome.value)
    return outcome
  }
  const describe = async (bot: BotId) => {
    const outcome = await editor.onDescribe(bot)
    setRefused(outcome.ok ? null : outcome.refusal.message)
    if (outcome.ok) setEditing(outcome.value)
  }
  const picks: { readonly [I in PlusItem['id']]: () => void } = { 'new-chat': onNewChat, 'new-group': () => setGrouping(true), 'new-bot': openForm }
  const edited = editing === null ? null : botIn(bots, editing.bot)
  const list = listOf(bots, query)
  const groupRows = (query ?? '').trim() === '' ? groupRowsOf(groups, bots) : []
  const disclosure = nextHidden(hidden, { on: 'render', triggers: hiddenTriggers(list, (query ?? '').trim() !== '', selected === null ? null : botIn(bots, selected)) })
  if (disclosure !== hidden) setHidden(disclosure)
  const view = sidebarOf(list, disclosure.open, selected)
  const drawRow = (row: Row) => (
    <BotRow key={row.bot.id} row={row} current={selected === row.bot.id} busy={opening === row.bot.id} onPick={() => void pick(row.bot.id)} onDetails={() => void describe(row.bot.id)} />
  )
  const drawGroup = (group: RowGroup) => (
    <section key={group.key}>
      <h3>{group.heading}</h3>
      {group.bots.map(bot => drawRow({ bot, place: group.place }))}
    </section>
  )
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
                {head}
                <button ref={searchButton} type="button" aria-label="Search bots" title="Search bots" onClick={() => setQuery('')}><Search /></button>
                <NewMenu items={plusMenuOf({ link, bots, groups, open, mac: MAC })} onPick={id => picks[id]()} />
              </>
            : <>
                <input autoFocus aria-label="Search bots" placeholder="Search bots" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onSearchKey} />
                <button type="button" aria-label="Close search" title="Close search" onClick={closeSearch}><Close /></button>
              </>}
        </div>
        <div className="bots-list" aria-busy={view.show === 'loading' || undefined}>
          {view.show === 'note' && <p className="bots-note" role="status">{view.words}</p>}
          {view.show === 'groups' && (
            <>
              {view.card !== null && drawRow({ bot: view.card, place: 'card' })}
              {view.groups.filter(group => group.place === 'pinned').map(drawGroup)}
              {groupRows.length > 0 && <GroupChats rows={groupRows} />}
              {view.groups.filter(group => group.place !== 'pinned').map(drawGroup)}
              {view.hidden !== null && (
                <section className="bots-hidden">
                  <h3>
                    <button
                      type="button" aria-expanded={view.hidden.open} data-current={(!view.hidden.open && view.hidden.holdsOpenBot) || undefined}
                      onClick={() => setHidden(held => nextHidden(held, { on: 'click' }))}
                    >
                      <Chevron />Hidden ({view.hidden.bots.length})
                    </button>
                  </h3>
                  {view.hidden.open && view.hidden.bots.map(bot => drawRow({ bot, place: 'hidden' }))}
                </section>
              )}
            </>
          )}
        </div>
        {refused !== null && <p className="bots-refused" role="alert">{refused}</p>}
        {made !== null && made.warnings.length > 0 && (
          <p className="bots-refused bots-warned" role="status">
            {made.warnings.map((warning, at) => <span key={at}>Hermes made {made.bot}, with a warning: {warning}</span>)}
          </p>
        )}
      </aside>
      {form !== null && (
        <NewBotForm problemOf={name => nameProblem(name, bots)} models={form.models} looks={looks} onCreate={create} onClose={() => setForm(null)} />
      )}
      {grouping && <GroupForm offered={seatableIn(bots, groups)} listed={groups?.state === 'listed' ? groups.rows.map(row => row.id) : []} onCreate={onCreateGroup} onClose={closeGroupForm} />}
      {editing !== null && (
        <BotEditor
          key={editing.bot} bot={edited ?? { id: editing.bot, name: editing.name, preview: null, description: null, tone: 'slate', picture: false, pinned: false, hidden: false }} details={editing}
          {...editor} onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
