import { botsIn, type Bot, type SidebarRow } from '@highwing/hermes/domain'
import type { WindowCommand } from '../../ipc-contract'
import { DOING, listedRows, named } from '../chats/chat-list'
import { ACTIONS, type Scene } from './actions'

/** One thing the palette can land on. `key` is unique across kinds, and `command` is what Enter sends. */
export type PaletteItem =
  | {
      readonly kind: 'chat'; readonly key: string; readonly title: string; readonly command: WindowCommand
      readonly preview: string | null; readonly doing: string | null; readonly badge: SidebarRow['badge']; readonly lastActiveAt: number | null
    }
  | { readonly kind: 'bot'; readonly key: string; readonly title: string; readonly command: WindowCommand; readonly bot: Bot }
  | { readonly kind: 'action'; readonly key: string; readonly title: string; readonly command: WindowCommand; readonly keys: string | null }

/** 0 word start in the title, 1 word start in the preview, 2 inside a word in the title, 3 inside a word in the preview. */
export type Grade = 0 | 1 | 2 | 3

export interface Row {
  readonly item: PaletteItem
  /** The chat's preview, shown under its title. null unless the preview carried a typed word. */
  readonly excerpt: string | null
}

export interface Ranked extends Row {
  readonly grade: Grade
}

export type Heading = 'Chats' | 'Bots' | 'Actions'

export interface Section {
  readonly heading: Heading
  /** Never empty. */
  readonly rows: readonly Row[]
}

export const NO_MATCHES = 'No matches'

export type PaletteView =
  | { readonly show: 'note'; readonly words: typeof NO_MATCHES }
  /** Never empty. */
  | { readonly show: 'rows'; readonly sections: readonly Section[] }

const HEADINGS: { readonly [K in PaletteItem['kind']]: Heading } = { chat: 'Chats', bot: 'Bots', action: 'Actions' }
/** An action, then a bot, then a chat, among matches of one grade: what a word names most exactly comes first. */
const KIND_ORDER: { readonly [K in PaletteItem['kind']]: number } = { action: 0, bot: 1, chat: 2 }
const CAPS: { readonly [K in PaletteItem['kind']]: number } = { chat: 8, bot: 6, action: Infinity }

const WORD = /[\p{L}\p{N}]/u
const previewOf = (item: PaletteItem) => (item.kind === 'chat' ? item.preview : null)
const lastActiveOf = (item: PaletteItem) => (item.kind === 'chat' ? item.lastActiveAt : null)

/** The best place `term` occurs in `text`. null: nowhere. */
function placeIn(text: string, term: string): 'start' | 'inside' | null {
  let best: 'inside' | null = null
  for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + 1)) {
    if (at === 0 || !WORD.test(text[at - 1] as string)) return 'start'
    best = 'inside'
  }
  return best
}

function gradeOf(term: string, title: string, preview: string | null): Grade | null {
  const inTitle = placeIn(title, term)
  const inPreview = preview === null ? null : placeIn(preview, term)
  if (inTitle === 'start') return 0
  if (inPreview === 'start') return 1
  if (inTitle === 'inside') return 2
  return inPreview === 'inside' ? 3 : null
}

const newestFirst = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a)

/**
 * The items every typed word occurs in, best first. An item's grade is its worst word's, and a word's
 * grade is its best occurrence in the title or the preview. Ties go to the kind, then the newest,
 * then the order the items came in.
 */
export function rank(query: string, items: readonly PaletteItem[]): readonly Ranked[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(term => term !== '')
  const ranked: Ranked[] = []
  for (const item of items) {
    const title = item.title.toLocaleLowerCase()
    const preview = previewOf(item)?.toLocaleLowerCase() ?? null
    const grades = terms.map(term => gradeOf(term, title, preview))
    if (!grades.every(grade => grade !== null)) continue
    ranked.push({ item, grade: Math.max(0, ...grades) as Grade, excerpt: grades.some(grade => grade % 2 === 1) ? previewOf(item) : null })
  }
  return ranked.sort((a, b) => a.grade - b.grade || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || newestFirst(lastActiveOf(a.item), lastActiveOf(b.item)))
}

type ChatItem = Extract<PaletteItem, { kind: 'chat' }>
const chatKey = (id: string) => `chat:${id}`

function itemsOf(scene: Scene): { readonly chats: readonly ChatItem[]; readonly bots: readonly PaletteItem[]; readonly actions: readonly PaletteItem[] } {
  const chats = (listedRows(scene.sidebar, scene.open) ?? []).map((row): ChatItem => ({
    kind: 'chat', key: chatKey(row.id), title: named(row.title), command: { do: 'open', ref: { kind: 'chat', sessionId: row.id } },
    preview: row.preview, doing: DOING[row.badge], badge: row.badge, lastActiveAt: row.lastActiveAt
  }))
  const bots = (scene.bots?.state === 'listed' ? botsIn(scene.bots.roster) : []).map((bot): PaletteItem => ({
    kind: 'bot', key: `bot:${bot.id}`, title: bot.name, command: { do: 'open', ref: { kind: 'bot', bot: bot.id } }, bot
  }))
  const actions = ACTIONS.flatMap((action): PaletteItem[] => {
    const command = action.offer(scene)
    return command === null ? [] : [{ kind: 'action', key: `action:${action.id}`, title: action.label, command, keys: action.keys }]
  })
  return { chats, bots, actions }
}

/** One section per kind, in the order of each kind's first row. */
function sectionsOf(rows: readonly Row[]): Section[] {
  const kinds = [...new Set(rows.map(row => row.item.kind))]
  return kinds.map(kind => ({ heading: HEADINGS[kind], rows: rows.filter(row => row.item.kind === kind).slice(0, CAPS[kind]) }))
}

const plain = (item: PaletteItem): Row => ({ item, excerpt: null })
const askingFirst = (a: ChatItem, b: ChatItem) => Number(b.badge === 'asking') - Number(a.badge === 'asking')

/**
 * With nothing typed: the chats that need you, then the newest, leaving out the open one, then the
 * bots, then the actions. With a query, the sections follow their best row, so the first row is the
 * best match.
 */
export function paletteOf(scene: Scene, query: string): PaletteView {
  const { chats, bots, actions } = itemsOf(scene)
  if (query.trim() === '') {
    const shown = scene.open?.shown?.sessionId ?? null
    const recent = chats
      .filter(item => shown === null || item.key !== chatKey(shown))
      .sort((a, b) => askingFirst(a, b) || newestFirst(a.lastActiveAt, b.lastActiveAt))
    return { show: 'rows', sections: sectionsOf([...recent, ...bots, ...actions].map(plain)) }
  }
  const sections = sectionsOf(rank(query, [...actions, ...bots, ...chats]))
  return sections.length === 0 ? { show: 'note', words: NO_MATCHES } : { show: 'rows', sections }
}

const rowsOf = (view: PaletteView): readonly Row[] => (view.show === 'note' ? [] : view.sections.flatMap(section => section.rows))

/** The row Enter opens: the one picked while it is listed, else the first. null: nothing is listed. */
export function activeIn(view: PaletteView, picked: string | null): Row | null {
  const rows = rowsOf(view)
  return rows.find(row => row.item.key === picked) ?? rows[0] ?? null
}

/** The key of the row `by` rows on from the active one, wrapping at both ends. null: nothing is listed. */
export function step(view: PaletteView, picked: string | null, by: 1 | -1): string | null {
  const rows = rowsOf(view)
  if (rows.length === 0) return null
  const at = Math.max(0, rows.findIndex(row => row.item.key === picked))
  return (rows[(at + by + rows.length) % rows.length] as Row).item.key
}
