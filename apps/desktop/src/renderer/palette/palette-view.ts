import { botsIn, shownChat, shownUnasked, type Bot, type CommandOutcome, type FoundMessage, type SidebarRow, type Version } from '@highwing/hermes/domain'
import { NOT_NOW, OTHER_CONNECTION, type WindowCommand } from '../../ipc-contract'
import { DOING, listedRows, named } from '../chats/chat-list'
import { ACTIONS, type Scene } from './actions'
import { foundIn, NOT_SEARCHED, statusOf, type MessageSearch, type SearchStatus } from './messages'

export type PaletteItem =
  | {
      readonly kind: 'chat'; readonly key: string; readonly title: string; readonly command: WindowCommand
      readonly preview: string | null; readonly doing: string | null; readonly badge: SidebarRow['badge']; readonly lastActiveAt: number | null
    }
  | { readonly kind: 'bot'; readonly key: string; readonly title: string; readonly command: WindowCommand; readonly bot: Bot }
  | { readonly kind: 'action'; readonly key: string; readonly title: string; readonly command: WindowCommand; readonly keys: string | null }
  | {
      readonly kind: 'message'; readonly key: string; readonly title: string; readonly command: WindowCommand
      readonly bot: string | null; readonly landing: Version | null
    }
  | { readonly kind: 'status'; readonly key: string; readonly title: string; readonly detail: string | null; readonly reads: number | null }

export const GRADE = { wordStart: 0, inside: 1 } as const
export type Grade = (typeof GRADE)[keyof typeof GRADE]

export interface Row {
  readonly item: PaletteItem
  readonly excerpt: string | null
}

export interface Ranked extends Row {
  readonly grade: Grade
}

export type Heading = 'Chats' | 'Bots' | 'Actions' | 'Messages'

export interface Section {
  readonly heading: Heading
  readonly rows: readonly Row[]
}

export const NO_MATCHES = 'No matches'

export type PaletteView =
  | { readonly show: 'note'; readonly words: string }
  | { readonly show: 'rows'; readonly sections: readonly Section[] }

const HEADINGS: { readonly [K in PaletteItem['kind']]: Heading } = { chat: 'Chats', bot: 'Bots', action: 'Actions', message: 'Messages', status: 'Messages' }
const KIND_ORDER: { readonly [K in PaletteItem['kind']]: number } = { action: 0, bot: 1, chat: 2, message: 3, status: 4 }
const SHOWN_UNTYPED = { chats: 8, bots: 6 } as const
const SHOWN_MESSAGES = 12
const CHARS_BEFORE_MATCH = 40
const EXCERPT_CHARS = 160

const WORD = /[\p{L}\p{N}]/u
const previewOf = (item: PaletteItem) => (item.kind === 'chat' ? item.preview : null)
const lastActiveOf = (item: PaletteItem) => (item.kind === 'chat' ? item.lastActiveAt : null)

function gradeIn(text: string, term: string): Grade | null {
  let best: Grade | null = null
  for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + 1)) {
    if (at === 0 || !WORD.test(text[at - 1] as string)) return GRADE.wordStart
    best = GRADE.inside
  }
  return best
}

const better = (a: Grade | null, b: Grade | null) => a !== null && (b === null || a < b)

function matchOf(term: string, title: string, preview: string | null): { readonly grade: Grade; readonly byPreview: boolean } | null {
  const inTitle = gradeIn(title, term)
  const inPreview = preview === null ? null : gradeIn(preview, term)
  if (better(inPreview, inTitle)) return { grade: inPreview as Grade, byPreview: true }
  return inTitle === null ? null : { grade: inTitle, byPreview: false }
}

const newestFirst = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a)

export const termsOf = (query: string): readonly string[] => query.trim().toLocaleLowerCase().split(/\s+/).filter(term => term !== '')

export function rank(query: string, items: readonly PaletteItem[]): readonly Ranked[] {
  const terms = termsOf(query)
  const ranked: Ranked[] = []
  for (const item of items) {
    const title = item.title.toLocaleLowerCase()
    const preview = previewOf(item)?.toLocaleLowerCase() ?? null
    const matches = terms.map(term => matchOf(term, title, preview))
    if (!matches.every(match => match !== null)) continue
    const grade = Math.max(GRADE.wordStart, ...matches.map(match => match.grade)) as Grade
    ranked.push({ item, grade, excerpt: matches.some(match => match.byPreview) ? previewOf(item) : null })
  }
  return ranked.sort((a, b) => a.grade - b.grade || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || newestFirst(lastActiveOf(a.item), lastActiveOf(b.item)))
}

type ChatItem = Extract<PaletteItem, { kind: 'chat' }>
type BotItem = Extract<PaletteItem, { kind: 'bot' }>
const chatKey = (id: string) => `chat:${id}`

function itemsOf(scene: Scene): { readonly chats: readonly ChatItem[]; readonly bots: readonly BotItem[]; readonly actions: readonly PaletteItem[] } {
  const chats = (listedRows(scene.sidebar, scene.open) ?? []).map((row): ChatItem => ({
    kind: 'chat', key: chatKey(row.id), title: named(row.title), command: { do: 'open', ref: { kind: 'chat', sessionId: row.id } },
    preview: row.preview, doing: DOING[row.badge], badge: row.badge, lastActiveAt: row.lastActiveAt
  }))
  const bots = (scene.bots?.state === 'listed' ? botsIn(scene.bots.roster) : []).map((bot): BotItem => ({
    kind: 'bot', key: `bot:${bot.id}`, title: bot.name, command: { do: 'open', ref: { kind: 'bot', bot: bot.id } }, bot
  }))
  const actions = ACTIONS.flatMap((action): PaletteItem[] => {
    const command = action.offer(scene)
    return command === null ? [] : [{ kind: 'action', key: `action:${action.id}`, title: action.label, command, keys: action.keys }]
  })
  return { chats, bots, actions }
}

function sectionsOf(rows: readonly Row[]): Section[] {
  const headings = [...new Set(rows.map(row => HEADINGS[row.item.kind]))]
  return headings.map(heading => ({ heading, rows: rows.filter(row => HEADINGS[row.item.kind] === heading) }))
}

function excerptOf(text: string, at: number): string {
  const space = at <= CHARS_BEFORE_MATCH ? -1 : text.indexOf(' ', at - CHARS_BEFORE_MATCH)
  const from = at <= CHARS_BEFORE_MATCH ? 0 : space === -1 || space >= at ? at - CHARS_BEFORE_MATCH : space + 1
  const shown = text.slice(from, from + EXCERPT_CHARS)
  return `${from === 0 ? '' : '…'}${shown}${from + EXCERPT_CHARS < text.length ? '…' : ''}`
}

function rankMessages(query: string, found: readonly FoundMessage[], botName: (message: FoundMessage) => string | null): readonly Ranked[] {
  const terms = termsOf(query)
  const ranked: (Ranked & { readonly at: number | null })[] = []
  for (const message of found) {
    const text = message.text.replace(/\s+/g, ' ').trim()
    const lower = text.toLocaleLowerCase()
    const grades = terms.map(term => gradeIn(lower, term))
    if (!grades.every(grade => grade !== null)) continue
    const item: PaletteItem = {
      kind: 'message', key: `message:${message.sessionId}:${message.rowId}`, title: named(message.chat ?? ''), bot: botName(message),
      command: { do: 'open', ref: { kind: 'chat', sessionId: message.sessionId } },
      landing: message.landing === null ? null : { sessionId: message.sessionId, landing: message.landing }
    }
    const at = Math.min(...terms.map(term => lower.indexOf(term)))
    ranked.push({ item, grade: Math.max(GRADE.wordStart, ...grades) as Grade, excerpt: excerptOf(text, at), at: message.at })
  }
  return ranked.sort((a, b) => a.grade - b.grade || newestFirst(a.at, b.at)).slice(0, SHOWN_MESSAGES)
}

const worthSaying = (status: SearchStatus, search: MessageSearch, matched: boolean) => matched || status.reads !== null || search.state === 'reading'

function messageRowsOf(scene: Scene, query: string, search: MessageSearch): readonly Row[] {
  const roster = scene.bots?.state === 'listed' ? botsIn(scene.bots.roster) : []
  const hits = rankMessages(query, foundIn(search), message => roster.find(bot => bot.id === message.bot)?.name ?? null)
  const status = statusOf(search)
  return status !== null && worthSaying(status, search, hits.length > 0) ? [...hits, plain({ kind: 'status', key: 'status', ...status })] : hits
}

const plain = (item: PaletteItem): Row => ({ item, excerpt: null })
const askingFirst = (a: ChatItem, b: ChatItem) => Number(b.badge === 'asking') - Number(a.badge === 'asking')

export function paletteOf(scene: Scene, query: string, search: MessageSearch = NOT_SEARCHED): PaletteView {
  const { chats, bots, actions } = itemsOf(scene)
  if (query.trim() === '') {
    const shown = shownChat(scene.open)?.sessionId ?? null
    const recent = chats
      .filter(item => shown === null || item.key !== chatKey(shown))
      .sort((a, b) => askingFirst(a, b) || newestFirst(a.lastActiveAt, b.lastActiveAt))
      .slice(0, SHOWN_UNTYPED.chats)
    return { show: 'rows', sections: sectionsOf([...recent, ...bots.filter(item => shownUnasked(item.bot)).slice(0, SHOWN_UNTYPED.bots), ...actions].map(plain)) }
  }
  const sections = sectionsOf([...rank(query, [...actions, ...bots, ...chats]), ...messageRowsOf(scene, query, search)])
  return sections.length === 0 ? { show: 'note', words: NO_MATCHES } : { show: 'rows', sections }
}

const rowsOf = (view: PaletteView): readonly Row[] => (view.show === 'note' ? [] : view.sections.flatMap(section => section.rows))

export function activeIn(view: PaletteView, picked: string | null): Row | null {
  const rows = rowsOf(view)
  return rows.find(row => row.item.key === picked) ?? rows[0] ?? null
}

export function step(view: PaletteView, picked: string | null, by: 1 | -1): string | null {
  const rows = rowsOf(view)
  if (rows.length === 0) return null
  const at = Math.max(0, rows.findIndex(row => row.item.key === picked))
  return (rows[(at + by + rows.length) % rows.length] as Row).item.key
}

const REFUSED_BY_MAIN: readonly CommandOutcome<never>[] = [NOT_NOW, OTHER_CONNECTION]

/**
 * The words a refused pick brings the sheet back with. Only main's own refusals do: nothing of the pick happened. One that Hermes
 * refused answers after the sheet has gone, and coming back then would land over whatever the user did next.
 */
export function comebackOf(outcome: CommandOutcome<unknown>): string | null {
  if (outcome.ok) return null
  const { kind, message } = outcome.refusal
  return REFUSED_BY_MAIN.some(main => !main.ok && main.refusal.kind === kind && main.refusal.message === message) ? message : null
}
