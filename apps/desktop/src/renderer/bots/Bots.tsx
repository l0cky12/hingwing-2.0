import type { Bot, BotCreated, BotDetails, BotDraft, BotId, BotMark, Bots, CommandOutcome, GroupDraft, GroupId, Groups, Link, Marked, ModelMenu, OpenChat } from '@highwing/hermes/domain'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { GroupForm } from '../groups/GroupForm'
import { groupRowsOf, type GroupRowView } from '../groups/group-rows'
import { newChatIn } from '../new-chat'
import { Chevron } from '../chrome/ModeSwitch'
import { run, useTopic } from '../store'
import { Avatar } from './Avatar'
import { BotEditor, type BotEditorProps } from './BotEditor'
import { BOT_EDIT_CALLS } from './BotPanel'
import { nameProblem } from './bot-form'
import type { LookCalls } from './LookPicker'
import { NewBotForm } from './NewBotForm'
import { DeleteDialog } from './DeleteDialog'
import { isMenuKey, type Box, type Opener } from '../chrome/popup-menu'
import { deleteRefusal, type MenuAction, type OpenMenu } from './bot-menu'
import { elementIn, fallbackOf, focusIn, openerTarget, stayedIn, type FocusTarget } from './focus'
import { busyIn, focusAfter, runsAt, SAID, type MarkRun } from './marks'
import { NewMenu } from './NewMenu'
import { plusMenuOf, seatableIn, type PlusItem } from './plus-menu'
import { botIn, listOf, selectedIn } from './roster-view'
import { RowMenu } from './RowMenu'
import { drawnAbove, HIDDEN_CLOSED, hiddenTriggers, nextHidden, rowsIn, sidebarOf, type Row, type RowGroup } from './sidebar-view'

const CARET_KEYS: ReadonlySet<string> = new Set(['PageUp', 'PageDown', 'End'])
const MAC = navigator.userAgent.includes('Mac')
const SAID_MS = 5_000

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
      onNew={bot => run({ do: 'open', ref: { kind: 'new', bot, draftId: crypto.randomUUID() }, upFront: true })}
      onMark={(bot, mark) => run({ do: 'markBot', bot, mark })}
      onCreate={(draft, picture) => run({ do: 'createBot', draft, picture })}
      onCreateGroup={draft => run({ do: 'createGroup', draft })}
      onOpenGroup={group => void run({ do: 'open', ref: { kind: 'group', group } })}
      onModels={() => run({ do: 'botModels', bot: null })}
      {...BOT_EDIT_CALLS}
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
  readonly onNew: (bot: BotId) => Promise<CommandOutcome<unknown>>
  readonly onMark: (bot: BotId, mark: BotMark) => Promise<CommandOutcome<Marked>>
  readonly onCreate: (draft: BotDraft, picture: string) => Promise<CommandOutcome<BotCreated>>
  readonly onCreateGroup: (draft: GroupDraft) => Promise<CommandOutcome>
  readonly onOpenGroup: (group: GroupId) => void
  readonly onModels: () => Promise<CommandOutcome<ModelMenu>>
  readonly looks: LookCalls
}

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 } as const
const Search = () => <svg {...icon}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
const Close = () => <svg {...icon}><path d="M6 6l12 12M18 6 6 18" /></svg>
export const Star = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" /></svg>

function GroupChats({ rows, onOpen }: { readonly rows: readonly GroupRowView[]; readonly onOpen: (group: GroupId) => void }) {
  const ids = useId()
  return (
    <section>
      <h3>Group chats</h3>
      {rows.map((row, at) => (
        <div key={row.id} className="bot-row">
          <button type="button" className="bot" aria-label={row.label} aria-describedby={`${ids}-${at}`} aria-current={row.current || undefined} onClick={() => onOpen(row.id)}>
            <span className="stack" aria-hidden="true">
              {row.faces.map(face => <Avatar key={face.id} bot={face} size={24} />)}
              {row.more > 0 && <span className="stack-more">+{row.more}</span>}
            </span>
            <span className="bot-text">
              <span className="bot-name">{row.name}</span>
              <span className={row.live ? 'bot-preview live' : 'bot-preview'} id={`${ids}-${at}`}>{row.preview}</span>
            </span>
          </button>
        </div>
      ))}
    </section>
  )
}

interface BotRowProps {
  readonly row: Row
  readonly current: boolean
  readonly busy: boolean
  readonly menuBy: Opener['by'] | null
  readonly onPick: () => void
  readonly onMenu: (opener: Opener) => void
}

function BotRow({ row: { bot, place }, current, busy, menuBy, onPick, onMenu }: BotRowProps) {
  const preview = useId()
  // A menu key the row answers may still make the browser send a `contextmenu`, which must not open a second menu.
  const byKeys = useRef(false)
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isMenuKey(event)) return
    event.preventDefault()
    byKeys.current = true
    onMenu((event.target as Element).closest('[data-more]') === null ? { by: 'keys' } : { by: 'more' })
  }
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    if (byKeys.current) byKeys.current = false
    else onMenu({ by: 'pointer', x: event.clientX, y: event.clientY })
  }
  const more = `More for ${bot.name}`
  return (
    <div
      className={place === 'card' ? 'bot-row bot-row-feature' : 'bot-row'} data-place={place} data-menu={menuBy !== null || undefined}
      onKeyDown={onKeyDown} onContextMenu={onContextMenu} onPointerDown={() => { byKeys.current = false }}
    >
      {place === 'card'
        ? <button type="button" className="bot-feature" data-bot={bot.id} aria-label={`${bot.name}, default bot`} aria-current={current || undefined} aria-busy={busy || undefined} onClick={onPick}>
            <span className="bot-badged"><Avatar bot={bot} size={48} /><span className="bot-badge" title="Default bot"><Star /></span></span>
            <span className="bot-name">{bot.name}</span>
          </button>
        : <button type="button" className="bot" data-bot={bot.id} aria-label={bot.name} aria-describedby={preview} aria-current={current || undefined} aria-busy={busy || undefined} onClick={onPick}>
            <Avatar bot={bot} size={32} />
            <span className="bot-text">
              <span className="bot-name">{bot.name}</span>
              <span className="bot-preview" id={preview}>{bot.preview ?? 'No messages yet'}</span>
            </span>
          </button>}
      <button
        type="button" className="bot-more" data-more={bot.id} data-opener={menuBy === 'more' || undefined} aria-label={more} title={more}
        aria-haspopup="menu" aria-expanded={menuBy !== null} onClick={() => onMenu({ by: 'more' })}
      >
        ⋯
      </button>
    </div>
  )
}

interface MarkCalls {
  readonly bots: Bots | undefined
  readonly onMark: BotsPanelProps['onMark']
  readonly onRefused: (words: string | null) => void
  readonly onLanded: (run: MarkRun, newest: boolean) => void
}

function useMarks({ bots, onMark, onRefused, onLanded }: MarkCalls) {
  const [runs, setRuns] = useState<readonly MarkRun[]>([])
  const newest = useRef(0)
  const start = (bot: Bot, mark: BotMark, rows: readonly BotId[], since: number) => {
    const id = ++newest.current
    setRuns(held => [...held, { id, bot: bot.id, name: bot.name, mark, rows, since, edition: null }])
    onRefused(null)
    void onMark(bot.id, mark).then(outcome => {
      if (outcome.ok) setRuns(held => held.map(run => (run.id === id ? { ...run, edition: outcome.value.edition } : run)))
      else {
        setRuns(held => held.filter(run => run.id !== id))
        onRefused(outcome.refusal.message)
      }
    })
  }
  useLayoutEffect(() => {
    const { landed, waiting } = runsAt(runs, bots)
    if (waiting.length === runs.length) return
    for (const run of landed) onLanded(run, run.id === newest.current)
    setRuns(waiting)
  }, [runs, bots])
  return { busy: busyIn(runs), start }
}

const NO_BOX: Box = { left: 0, top: 0, right: 0, bottom: 0 }

export function BotsPanel({ head = <h2>Bots</h2>, bots, open, link, groups, onOpen, onNewChat, onNew, onMark, onCreate, onCreateGroup, onOpenGroup, onModels, looks, ...editor }: BotsPanelProps) {
  const [refused, setRefused] = useState<string | null>(null)
  const [form, setForm] = useState<{ readonly models: ModelMenu | 'loading' } | null>(null)
  const [grouping, setGrouping] = useState(false)
  const closeGroupForm = () => setGrouping(false)
  const [made, setMade] = useState<BotCreated | null>(null)
  const [editing, setEditing] = useState<BotDetails | null>(null)
  const [deleting, setDeleting] = useState<Bot | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [hidden, setHidden] = useState(HIDDEN_CLOSED)
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [said, setSaid] = useState<{ readonly words: string } | null>(null)
  const sidebar = useRef<HTMLElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const searchButton = useRef<HTMLButtonElement>(null)
  const selected = selectedIn(bots, open)
  const opening = open?.opening?.kind === 'bot' ? open.opening.bot : null
  useEffect(() => {
    if (said === null) return
    const id = setTimeout(() => setSaid(null), SAID_MS)
    return () => clearTimeout(id)
  }, [said])

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
  const groupRows = (query ?? '').trim() === '' ? groupRowsOf(groups, bots, open) : []
  const disclosure = nextHidden(hidden, { on: 'render', triggers: hiddenTriggers(list, (query ?? '').trim() !== '', selected === null ? null : botIn(bots, selected)) })
  if (disclosure !== hidden) setHidden(disclosure)
  const view = sidebarOf(list, disclosure.open, selected)
  const rows = rowsIn(view)

  const focus = (targets: readonly FocusTarget[], how: 'scroll' | 'in-view') => {
    if (sidebar.current !== null) focusIn(sidebar.current, targets, how)
  }
  const stayed = () => sidebar.current !== null && stayedIn(sidebar.current, document.activeElement)

  const marks = useMarks({
    bots, onMark, onRefused: setRefused,
    onLanded: (landed, newest) => {
      setSaid({ words: SAID[landed.mark](landed.name) })
      if (newest && stayed()) focus(focusAfter(landed, view), 'scroll')
    }
  })

  const closeMenu = (how: 'escape' | 'tab' | 'away' | 'moved') => {
    if (menu === null) return
    setMenu(null)
    if (how === 'escape' || how === 'tab') focus([openerTarget(menu)], 'scroll')
    if (how === 'moved' && stayed()) focus(fallbackOf(openerTarget(menu), view), 'in-view')
  }
  // Group chats are drawn between Pinned and the sections, so a change there moves the rows below them too.
  const placeOf = (bot: BotId) => {
    const above = drawnAbove(view, bot)
    return above === null ? null : `${groupRows.map(row => row.id).join(' ')}\n${above}`
  }
  const openMenu = (bot: BotId, opener: Opener) => {
    if (menu?.bot === bot && menu.opener.by === 'more' && opener.by === 'more') return closeMenu('escape')
    const above = placeOf(bot)
    if (above !== null) setMenu({ bot, opener, above, scrolled: scroller.current?.scrollTop ?? 0 })
  }
  useLayoutEffect(() => {
    if (menu !== null && placeOf(menu.bot) !== menu.above) closeMenu('moved')
  })
  const boxOf = (target: FocusTarget): Box => (sidebar.current === null ? undefined : elementIn(sidebar.current, target))?.getBoundingClientRect() ?? NO_BOX

  const mark = (bot: Bot, chosen: BotMark) =>
    marks.start(bot, chosen, rows.filter(row => row.place !== 'hidden').map(row => row.bot.id), bots?.state === 'listed' ? bots.edition : 0)
  const ACTIONS: { readonly [A in MenuAction]: (bot: Bot) => void } = {
    open: bot => void pick(bot.id),
    new: bot => void onNew(bot.id).then(outcome => setRefused(outcome.ok ? null : outcome.refusal.message)),
    edit: bot => void describe(bot.id),
    pin: bot => mark(bot, 'pin'),
    unpin: bot => mark(bot, 'unpin'),
    hide: bot => mark(bot, 'hide'),
    show: bot => mark(bot, 'show'),
    // Hermes never deletes its default bot, so its Delete… refuses at once, with no dialog to confirm.
    delete: bot => (bots?.state === 'listed' && bots.roster.featured?.id === bot.id ? setRefused(deleteRefusal(bot, true)) : setDeleting(bot))
  }
  const choose = (bot: Bot, action: MenuAction) => {
    setMenu(null)
    focus([{ to: 'row', bot: bot.id }], 'scroll')
    ACTIONS[action](bot)
  }
  const closeDelete = (bot: Bot) => {
    // The dialog closes here, and the browser gives focus back to the bot's row, if it is still there.
    flushSync(() => setDeleting(null))
    if (document.activeElement === document.body) focus(fallbackOf({ to: 'row', bot: bot.id }, view), 'in-view')
  }
  const menuRow = menu === null ? undefined : rows.find(row => row.bot.id === menu.bot)

  const drawRow = (row: Row) => (
    <BotRow
      key={row.bot.id} row={row} current={selected === row.bot.id} busy={opening === row.bot.id || marks.busy.has(row.bot.id)}
      menuBy={menu?.bot === row.bot.id ? menu.opener.by : null} onPick={() => void pick(row.bot.id)} onMenu={opener => openMenu(row.bot.id, opener)}
    />
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
      <aside ref={sidebar} className="bots" aria-label="Bots" data-state={bots?.state ?? 'loading'}>
        <div className="bots-head" onBlur={event => { if (query === '' && !event.currentTarget.contains(event.relatedTarget)) setQuery(null) }}>
          {query === null
            ? <>
                {head}
                <button ref={searchButton} type="button" data-bots-search aria-label="Search bots" title="Search bots" onClick={() => setQuery('')}><Search /></button>
                <NewMenu items={plusMenuOf({ link, bots, groups, open, mac: MAC })} onPick={id => picks[id]()} />
              </>
            : <>
                <input autoFocus data-bots-search aria-label="Search bots" placeholder="Search bots" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onSearchKey} />
                <button type="button" aria-label="Close search" title="Close search" onClick={closeSearch}><Close /></button>
              </>}
        </div>
        <div
          ref={scroller} className="bots-list" aria-busy={view.show === 'loading' || undefined}
          onScroll={event => { if (menu !== null && event.currentTarget.scrollTop !== menu.scrolled) closeMenu('moved') }}
        >
          {view.show === 'note' && <p className="bots-note" role="status">{view.words}</p>}
          {view.show === 'groups' && (
            <>
              {view.card !== null && drawRow({ bot: view.card, place: 'card' })}
              {view.groups.filter(group => group.place === 'pinned').map(drawGroup)}
              {groupRows.length > 0 && <GroupChats rows={groupRows} onOpen={onOpenGroup} />}
              {view.groups.filter(group => group.place !== 'pinned').map(drawGroup)}
              {view.hidden !== null && (
                <section className="bots-hidden">
                  <h3>
                    <button
                      type="button" data-hidden-toggle aria-expanded={view.hidden.open} data-current={(!view.hidden.open && view.hidden.holdsOpenBot) || undefined}
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
        {menu !== null && menuRow !== undefined && (
          <RowMenu
            key={JSON.stringify([menu.bot, menu.opener])} bot={menu.bot} name={menuRow.bot.name} place={menuRow.place} opener={menu.opener}
            measure={() => ({ row: boxOf({ to: 'row', bot: menu.bot }), more: boxOf({ to: 'more', bot: menu.bot }) })}
            onChoose={action => choose(menuRow.bot, action)} onClose={closeMenu}
          />
        )}
        <p className="bots-note bots-said" role="status">{said?.words ?? ''}</p>
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
          {...editor}
          onClose={() => {
            // The dialog closes here, and the browser gives focus back to the bot's row, which Edit… focused, if it is still there.
            flushSync(() => setEditing(null))
            if (document.activeElement === document.body) focus(fallbackOf({ to: 'row', bot: editing.bot }, view), 'in-view')
          }}
        />
      )}
      {deleting !== null && (
        <DeleteDialog
          name={deleting.name}
          onCancel={() => closeDelete(deleting)}
          onConfirm={() => {
            closeDelete(deleting)
            setRefused(deleteRefusal(deleting, false))
          }}
        />
      )}
    </>
  )
}
