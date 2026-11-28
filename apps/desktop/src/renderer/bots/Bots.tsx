import type { Bot, BotActivities, BotActivity, BotCreated, BotDetails, BotDraft, BotId, BotMark, Bots, CommandOutcome, GroupDraft, GroupId, Groups, Link, Marked, ModelMenu, OpenChat } from '@highwing/hermes/domain'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { activityIn } from '@highwing/hermes/domain'
import { GroupEditor } from '../groups/GroupEditor'
import { GroupForm } from '../groups/GroupForm'
import { groupRowsOf, type GroupRowView } from '../groups/group-rows'
import { newChatIn } from '../new-chat'
import { Chevron } from '../chrome/ModeSwitch'
import { SearchIcon } from '../chrome/SidebarHead'
import { COMMAND_KEY, isShortcut } from '../keys'
import { modalOpen } from '../shortcuts'
import { run, useTopic } from '../store'
import { useBotDrafts } from '../composer/drafts'
import { Avatar } from './Avatar'
import { BotEditor, type BotEditorProps } from './BotEditor'
import { BOT_EDIT_CALLS } from './BotPanel'
import { nameProblem } from './bot-form'
import type { LookCalls } from './LookPicker'
import { NewBotForm } from './NewBotForm'
import { DeleteDialog } from './DeleteDialog'
import { MemoryDialog } from './MemoryDialog'
import { isMenuKey, type Box, type Opener } from '../chrome/popup-menu'
import { anchorOf, botMenuOf, DELETE_WORDS, groupMenuOf, sameOwner, type GroupAction, type MenuAction, type MenuOwner, type OpenMenu } from './bot-menu'
import { afterGroupOf, elementIn, fallbackOf, focusIn, moreOf, openerTarget, rowOf, stayedIn, type FocusTarget } from './focus'
import { busyIn, focusAfter, runsAt, SAID, type MarkRun } from './marks'
import { NewMenu } from './NewMenu'
import { newGroupBlock, plusMenuOf, seatableIn, type PlusItem } from './plus-menu'
import { botIn, listOf, selectedIn } from './roster-view'
import { RowMenu } from './RowMenu'
import { drawnAbove, drawnAboveGroups, HIDDEN_CLOSED, hiddenTriggers, lineOf, nextHidden, rowsIn, sidebarOf, type BotLine, type Row, type RowGroup } from './sidebar-view'

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

export function BotsSidebar({ head, compact, foot = null }: { readonly head: ReactNode; readonly compact: boolean; readonly foot?: ReactNode }) {
  const open = useTopic('open')
  return (
    <BotsPanel
      head={head} bots={useTopic('bots')} open={open} link={useTopic('link')} groups={useTopic('groups')} activity={useTopic('activity')} drafts={useBotDrafts()}
      compact={compact} onCompact={next => void run({ do: 'setSidebarWidth', width: next ? 'compact' : 'full' })}
      onOpen={bot => run({ do: 'open', ref: { kind: 'bot', bot } })}
      onNewChat={() => void run(newChatIn(open, crypto.randomUUID()))}
      onNew={bot => run({ do: 'open', ref: { kind: 'new', bot, draftId: crypto.randomUUID() }, upFront: true })}
      onMark={(bot, mark) => run({ do: 'markBot', bot, mark })}
      onCreate={(draft, picture) => run({ do: 'createBot', draft, picture })}
      onCreateGroup={draft => run({ do: 'createGroup', draft })}
      onOpenGroup={group => void run({ do: 'open', ref: { kind: 'group', group } })}
      onRenameGroup={(group, name) => run({ do: 'renameGroup', group, name })}
      onDeleteGroup={group => run({ do: 'deleteGroup', group })}
      onModels={() => run({ do: 'botModels', bot: null })}
      {...BOT_EDIT_CALLS}
      looks={LOOKS}
      foot={foot}
    />
  )
}

type EditorCalls = Pick<BotEditorProps, 'onDescribe' | 'onEdit' | 'onPickPicture' | 'onRemovePicture'>

interface BotsPanelProps extends EditorCalls {
  readonly head?: ReactNode
  readonly compact: boolean
  readonly onCompact: (compact: boolean) => void
  readonly bots: Bots | undefined
  readonly open: OpenChat | undefined
  readonly link: Link | undefined
  readonly groups: Groups | undefined
  readonly activity: BotActivities | undefined
  readonly drafts: ReadonlyMap<BotId, string>
  readonly onOpen: (bot: BotId) => Promise<CommandOutcome<unknown>>
  readonly onNewChat: () => void
  readonly onNew: (bot: BotId) => Promise<CommandOutcome<unknown>>
  readonly onMark: (bot: BotId, mark: BotMark) => Promise<CommandOutcome<Marked>>
  readonly onCreate: (draft: BotDraft, picture: string) => Promise<CommandOutcome<BotCreated>>
  readonly onCreateGroup: (draft: GroupDraft) => Promise<CommandOutcome>
  readonly onOpenGroup: (group: GroupId) => void
  readonly onRenameGroup: (group: GroupId, name: string) => Promise<CommandOutcome>
  readonly onDeleteGroup: (group: GroupId) => Promise<CommandOutcome>
  readonly onModels: () => Promise<CommandOutcome<ModelMenu>>
  readonly looks: LookCalls
  readonly foot?: ReactNode
}

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 } as const
const Close = () => <svg {...icon}><path d="M6 6l12 12M18 6 6 18" /></svg>
const Panel = () => <svg {...icon}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
export const Star = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" /></svg>

/** The right-click and the menu keys that open a row's menu. `more`: the attribute of the row's ⋯ button. */
function useMenuOpeners(more: string, onMenu: (opener: Opener) => void) {
  // A menu key the row answers may still make the browser send a `contextmenu`, which must not open a second menu.
  const byKeys = useRef(false)
  return {
    onKeyDown: (event: KeyboardEvent) => {
      if (!isMenuKey(event)) return
      event.preventDefault()
      byKeys.current = true
      onMenu((event.target as Element).closest(`[${more}]`) === null ? { by: 'keys' } : { by: 'more' })
    },
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault()
      if (byKeys.current) byKeys.current = false
      else onMenu({ by: 'pointer', x: event.clientX, y: event.clientY })
    },
    onPointerDown: () => { byKeys.current = false }
  }
}

interface GroupRowProps {
  readonly row: GroupRowView
  readonly compact: boolean
  readonly busy: boolean
  readonly menuBy: Opener['by'] | null
  readonly onOpen: () => void
  readonly onMenu: (opener: Opener) => void
}

function GroupRow({ row, compact, busy, menuBy, onOpen, onMenu }: GroupRowProps) {
  const preview = useId()
  const openers = useMenuOpeners('data-group-more', onMenu)
  const more = `More for ${row.name}`
  return (
    <div className="bot-row" data-menu={menuBy !== null || undefined} {...openers}>
      <button
        type="button" className="bot" data-group={row.id} aria-label={row.label} aria-describedby={preview} aria-current={row.current || undefined}
        aria-busy={busy || undefined} title={compact ? row.name : undefined} onClick={onOpen}
      >
        <span className="stack" aria-hidden="true">
          {row.faces.map(face => <Avatar key={face.id} bot={face} size={24} />)}
          {row.more > 0 && <span className="stack-more">+{row.more}</span>}
        </span>
        <span className="bot-text">
          <span className="bot-name">{row.name}</span>
          <span className={row.live ? 'bot-preview live' : 'bot-preview'} id={preview}>{row.preview}</span>
        </span>
      </button>
      <button
        type="button" className="bot-more" data-group-more={row.id} data-opener={menuBy === 'more' || undefined} aria-label={more} title={more}
        aria-haspopup="menu" aria-expanded={menuBy !== null} onClick={() => onMenu({ by: 'more' })}
      >
        ⋯
      </button>
    </div>
  )
}

const ACTIVITY_WORDS: { readonly [A in BotActivity]: string } = { working: 'Working', waiting: 'Waiting for you', unread: 'New reply' }
const Exclaim = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"><path d="M12 4v10M12 20v.01" /></svg>
const ACTIVITY_MARKS: { readonly [A in BotActivity]: ReactNode } = { working: <><span /><span /><span /></>, waiting: <Exclaim />, unread: null }

function ActivityMark({ activity }: { readonly activity: BotActivity | null }) {
  return activity === null ? null : <span className="bot-activity" data-activity={activity} aria-hidden="true">{ACTIVITY_MARKS[activity]}</span>
}

interface BotRowProps {
  readonly row: Row
  readonly compact: boolean
  readonly line: BotLine
  readonly current: boolean
  readonly busy: boolean
  readonly activity: BotActivity | null
  readonly menuBy: Opener['by'] | null
  readonly onPick: () => void
  readonly onMenu: (opener: Opener) => void
}

function BotRow({ row: { bot, place }, compact, line, current, busy, activity, menuBy, onPick, onMenu }: BotRowProps) {
  const tip = compact ? bot.name : undefined
  const preview = useId()
  const status = useId()
  const said = activity === null ? null : <span className="sr" id={status}>{ACTIVITY_WORDS[activity]}</span>
  const openers = useMenuOpeners('data-more', onMenu)
  const more = `More for ${bot.name}`
  return (
    <div
      className={place === 'card' ? 'bot-row bot-row-feature' : 'bot-row'} data-place={place} data-menu={menuBy !== null || undefined} data-activity={activity ?? undefined}
      {...openers}
    >
      {place === 'card'
        ? <button
            type="button" className="bot-feature" data-bot={bot.id} aria-label={`${bot.name}, default bot`} aria-describedby={said === null ? undefined : status}
            aria-current={current || undefined} aria-busy={busy || undefined} title={tip} onClick={onPick}
          >
            <span className="bot-badged"><Avatar bot={bot} size={48} /><ActivityMark activity={activity} /><span className="bot-badge" title="Default bot"><Star /></span></span>
            {said}
            <span className="bot-name">{bot.name}</span>
          </button>
        : <button
            type="button" className="bot" data-bot={bot.id} aria-label={bot.name} aria-describedby={said === null ? preview : `${status} ${preview}`}
            aria-current={current || undefined} aria-busy={busy || undefined} title={tip} onClick={onPick}
          >
            <span className="bot-face"><Avatar bot={bot} size={32} /><ActivityMark activity={activity} /></span>
            {said}
            <span className="bot-text">
              <span className="bot-name">{bot.name}</span>
              <span className="bot-preview" id={preview}>{line.kind === 'draft' ? <><span className="bot-draft">Draft:</span> {line.text}</> : line.text}</span>
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

export function BotsPanel({
  head = <h2>Bots</h2>, compact, onCompact, bots, open, link, groups, activity, drafts, onOpen, onNewChat, onNew, onMark, onCreate, onCreateGroup, onOpenGroup, onRenameGroup, onDeleteGroup, onModels, looks, foot = null, ...editor
}: BotsPanelProps) {
  const [refused, setRefused] = useState<string | null>(null)
  const [form, setForm] = useState<{ readonly models: ModelMenu | 'loading' } | null>(null)
  const [grouping, setGrouping] = useState(false)
  const closeGroupForm = () => setGrouping(false)
  const [made, setMade] = useState<BotCreated | null>(null)
  const [editing, setEditing] = useState<BotDetails | null>(null)
  const [memory, setMemory] = useState(false)
  const [editingGroup, setEditingGroup] = useState<GroupRowView | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<GroupRowView | null>(null)
  /** A group whose delete Hermes has not answered yet, and where focus goes once its row leaves. */
  const [leaving, setLeaving] = useState<{ readonly group: GroupId; readonly focus: readonly FocusTarget[] } | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [hidden, setHidden] = useState(HIDDEN_CLOSED)
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [said, setSaid] = useState<{ readonly words: string } | null>(null)
  const sidebar = useRef<HTMLElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const searchButton = useRef<HTMLButtonElement>(null)
  const compactButton = useRef<HTMLButtonElement>(null)
  const selected = selectedIn(bots, open)
  const opening = open?.opening?.kind === 'bot' ? open.opening.bot : null
  useEffect(() => {
    if (said === null) return
    const id = setTimeout(() => setSaid(null), SAID_MS)
    return () => clearTimeout(id)
  }, [said])
  // A compact sidebar has no room for the search, so compacting ends it rather than leave the list filtered by words nobody can see.
  const toggleCompact = () => {
    if (!compact) flushSync(() => setQuery(null))
    if (document.activeElement === document.body) compactButton.current?.focus()
    onCompact(!compact)
  }
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isShortcut(event, 'compactSidebar') || event.defaultPrevented || event.isComposing || modalOpen() || sidebar.current?.checkVisibility() !== true) return
      event.preventDefault()
      if (!event.repeat) toggleCompact()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [compact, onCompact])

  const groupBlocked = newGroupBlock(link, bots, groups) !== null
  useEffect(() => {
    if (groupBlocked) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isShortcut(event, 'newGroup') || event.defaultPrevented || event.isComposing || modalOpen() || sidebar.current?.checkVisibility() !== true) return
      event.preventDefault()
      if (!event.repeat) setGrouping(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [groupBlocked])

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
  const refuseFromMenu = (why: string) => {
    closeMenu('escape')
    setRefused(why)
  }
  // Group chats are drawn between Pinned and the sections, so a change there moves the rows below them too.
  const placeOf = (owner: MenuOwner) => {
    if (owner.kind === 'bot') {
      const above = drawnAbove(view, owner.bot)
      return above === null ? null : `${groupRows.map(row => row.id).join(' ')}\n${above}`
    }
    const at = groupRows.findIndex(row => row.id === owner.group)
    const above = drawnAboveGroups(view)
    return at === -1 || above === null ? null : `${groupRows.slice(0, at).map(row => row.id).join(' ')}\n${above}`
  }
  const openMenu = (owner: MenuOwner, opener: Opener) => {
    if (menu !== null && sameOwner(menu.owner, owner) && menu.opener.by === 'more' && opener.by === 'more') return closeMenu('escape')
    const above = placeOf(owner)
    if (above !== null) setMenu({ owner, opener, above, scrolled: scroller.current?.scrollTop ?? 0 })
  }
  useLayoutEffect(() => {
    if (menu !== null && placeOf(menu.owner) !== menu.above) closeMenu('moved')
  })
  const menuBy = (owner: MenuOwner) => (menu !== null && sameOwner(menu.owner, owner) ? menu.opener.by : null)
  const boxOf = (target: FocusTarget): Box => (sidebar.current === null ? undefined : elementIn(sidebar.current, target))?.getBoundingClientRect() ?? NO_BOX
  const measure = (owner: MenuOwner) => ({ row: boxOf(rowOf(owner)), more: compact ? null : boxOf(moreOf(owner)) })

  const mark = (bot: Bot, chosen: BotMark) =>
    marks.start(bot, chosen, rows.filter(row => row.place !== 'hidden').map(row => row.bot.id), bots?.state === 'listed' ? bots.edition : 0)
  const ACTIONS: { readonly [A in MenuAction]: (bot: Bot) => void } = {
    open: bot => void pick(bot.id),
    new: bot => void onNew(bot.id).then(outcome => setRefused(outcome.ok ? null : outcome.refusal.message)),
    edit: bot => void describe(bot.id),
    memory: () => setMemory(true),
    pin: bot => mark(bot, 'pin'),
    unpin: bot => mark(bot, 'unpin'),
    hide: bot => mark(bot, 'hide'),
    show: bot => mark(bot, 'show'),
    // botMenuOf blocks Delete… on every bot until DELETES_BOTS is true.
    delete: () => {}
  }
  const choose = (bot: Bot, action: MenuAction) => {
    setMenu(null)
    focus([{ to: 'row', bot: bot.id }], 'scroll')
    ACTIONS[action](bot)
  }
  /** A dialog closes here, and the browser gives focus back to the row Edit… or Delete… focused, if it is still there. */
  const closeDialog = (close: () => void, row: FocusTarget) => {
    flushSync(close)
    if (document.activeElement === document.body) focus(fallbackOf(row, view), 'in-view')
  }

  const GROUP_ACTIONS: { readonly [A in GroupAction]: (row: GroupRowView) => void } = {
    open: row => onOpenGroup(row.id),
    edit: setEditingGroup,
    delete: setDeletingGroup
  }
  const chooseForGroup = (row: GroupRowView, action: GroupAction) => {
    setMenu(null)
    focus([{ to: 'group', group: row.id }], 'scroll')
    GROUP_ACTIONS[action](row)
  }
  const deleteGroup = async (row: GroupRowView) => {
    closeDialog(() => setDeletingGroup(null), { to: 'group', group: row.id })
    setRefused(null)
    setLeaving({ group: row.id, focus: afterGroupOf(row.id, groupRows.map(held => held.id), view) })
    const outcome = await onDeleteGroup(row.id)
    if (outcome.ok) return
    setLeaving(held => (held?.group === row.id ? null : held))
    setRefused(outcome.refusal.message)
  }
  useLayoutEffect(() => {
    if (leaving === null || groupRows.some(row => row.id === leaving.group)) return
    setLeaving(null)
    if (document.activeElement === document.body) focus(leaving.focus, 'in-view')
  })

  const drawMenu = ({ owner, opener }: OpenMenu) => {
    const key = JSON.stringify([owner, opener])
    if (owner.kind === 'group') {
      const row = groupRows.find(held => held.id === owner.group)
      return row && (
        <RowMenu
          key={key} name={row.name} items={groupMenuOf(link)} more={moreOf(owner)} anchor={() => anchorOf(opener, 'section', measure(owner))}
          onChoose={action => chooseForGroup(row, action)} onBlocked={refuseFromMenu} onClose={closeMenu}
        />
      )
    }
    const row = rows.find(held => held.bot.id === owner.bot)
    return row && (
      <RowMenu
        key={key} name={row.bot.name} items={botMenuOf(row.bot, row.place, bots?.state === 'listed' && bots.roster.featured?.id === row.bot.id)} more={moreOf(owner)} anchor={() => anchorOf(opener, row.place, measure(owner))}
        onChoose={action => choose(row.bot, action)} onBlocked={refuseFromMenu} onClose={closeMenu}
      />
    )
  }

  const drawRow = (row: Row) => {
    const owner: MenuOwner = { kind: 'bot', bot: row.bot.id }
    return (
      <BotRow
        key={row.bot.id} row={row} compact={compact} line={lineOf(row.bot, drafts, selected)} current={selected === row.bot.id} busy={opening === row.bot.id || marks.busy.has(row.bot.id)} activity={activityIn(activity, row.bot.id)}
        menuBy={menuBy(owner)} onPick={() => void pick(row.bot.id)} onMenu={opener => openMenu(owner, opener)}
      />
    )
  }
  const drawGroupRow = (row: GroupRowView) => {
    const owner: MenuOwner = { kind: 'group', group: row.id }
    return (
      <GroupRow
        key={row.id} row={row} compact={compact} busy={leaving?.group === row.id} menuBy={menuBy(owner)} onOpen={() => onOpenGroup(row.id)} onMenu={opener => openMenu(owner, opener)}
      />
    )
  }
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
                <button ref={searchButton} type="button" className="side-search" data-bots-search aria-label="Search bots" title="Search bots" onClick={() => setQuery('')}><SearchIcon /><span>Search</span></button>
                {head}
                <NewMenu items={plusMenuOf({ link, bots, groups, open, mac: MAC })} onPick={id => picks[id]()} />
              </>
            : <>
                <input autoFocus data-bots-search aria-label="Search bots" placeholder="Search bots" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onSearchKey} />
                <button type="button" aria-label="Close search" title="Close search" onClick={closeSearch}><Close /></button>
              </>}
          <button
            ref={compactButton} type="button" data-compact-toggle aria-label="Compact sidebar" title={`Compact sidebar (${COMMAND_KEY}+B)`} aria-pressed={compact}
            aria-keyshortcuts={MAC ? 'Meta+B' : 'Control+B'} onClick={toggleCompact}
          >
            <Panel />
          </button>
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
              {groupRows.length > 0 && (
                <section>
                  <h3>Group chats</h3>
                  {groupRows.map(drawGroupRow)}
                </section>
              )}
              {view.groups.filter(group => group.place !== 'pinned').map(drawGroup)}
              {view.hidden !== null && (
                <section className="bots-hidden">
                  <h3>
                    <button
                      type="button" data-hidden-toggle aria-expanded={view.hidden.open} data-current={(!view.hidden.open && view.hidden.holdsOpenBot) || undefined}
                      title={compact ? `Hidden (${view.hidden.bots.length})` : undefined}
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
        {menu !== null && drawMenu(menu)}
        <p className="bots-note bots-said" role="status">{said?.words ?? ''}</p>
        {refused !== null && <p className="bots-refused" role="alert">{refused}</p>}
        {made !== null && made.warnings.length > 0 && (
          <p className="bots-refused bots-warned" role="status">
            {made.warnings.map((warning, at) => <span key={at}>Hermes made {made.bot}, with a warning: {warning}</span>)}
          </p>
        )}
        {foot}
      </aside>
      {form !== null && (
        <NewBotForm problemOf={name => nameProblem(name, bots)} models={form.models} looks={looks} onCreate={create} onClose={() => setForm(null)} />
      )}
      {grouping && <GroupForm offered={seatableIn(bots, groups)} listed={groups?.state === 'listed' ? groups.rows.map(row => row.id) : []} onCreate={onCreateGroup} onClose={closeGroupForm} />}
      {editing !== null && (
        <BotEditor
          key={editing.bot} bot={edited ?? { id: editing.bot, name: editing.name, preview: null, description: null, tone: 'slate', picture: false, pinned: false, hidden: false }} details={editing}
          {...editor}
          onClose={() => closeDialog(() => setEditing(null), { to: 'row', bot: editing.bot })}
        />
      )}
      {memory && (
        <MemoryDialog onClose={() => {
          const bot = bots?.state === 'listed' ? bots.roster.featured?.id : undefined
          if (bot === undefined) setMemory(false)
          else closeDialog(() => setMemory(false), { to: 'row', bot })
        }} />
      )}
      {editingGroup !== null && (
        <GroupEditor group={editingGroup} onRename={onRenameGroup} onClose={() => closeDialog(() => setEditingGroup(null), { to: 'group', group: editingGroup.id })} />
      )}
      {deletingGroup !== null && (
        <DeleteDialog
          name={deletingGroup.name} words={DELETE_WORDS.group}
          onCancel={() => closeDialog(() => setDeletingGroup(null), { to: 'group', group: deletingGroup.id })}
          onConfirm={() => void deleteGroup(deletingGroup)}
        />
      )}
    </>
  )
}
