import { botsIn, type Bot, type SidebarRow } from '@highwing/hermes/domain'
import type { WindowCommand } from '../../ipc-contract'
import { DOING, listedRows, named } from '../chats/chat-list'
import { ACTIONS, type Scene } from './actions'

export type PaletteItem =
  | {
      readonly kind: 'chat'; readonly key: string; readonly title: string; readonly command: WindowCommand
      readonly preview: string | null; readonly doing: string | null; readonly badge: SidebarRow['badge']; readonly lastActiveAt: number | null
    }
  | { readonly kind: 'bot'; readonly key: string; readonly title: string; readonly command: WindowCommand; readonly bot: Bot }
  | { readonly kind: 'action'; readonly key: string; readonly title: string; readonly command: WindowCommand; readonly keys: string | null }

export const GRADE = { titleStart: 0, previewStart: 1, titleInside: 2, previewInside: 3 } as const
export type Grade = (typeof GRADE)[keyof typeof GRADE]
const IN_PREVIEW: ReadonlySet<Grade> = new Set([GRADE.previewStart, GRADE.previewInside])

export interface Row {
  readonly item: PaletteItem
  readonly excerpt: string | null
}

export interface Ranked extends Row {
  readonly grade: Grade
}

export type Heading = 'Chats' | 'Bots' | 'Actions'

export interface Section {
  readonly heading: Heading
  readonly rows: readonly Row[]
}

export const NO_MATCHES = 'No matches'

export type PaletteView =
  | { readonly show: 'note'; readonly words: typeof NO_MATCHES }
  | { readonly show: 'rows'; readonly sections: readonly Section[] }

const HEADINGS: { readonly [K in PaletteItem['kind']]: Heading } = { chat: 'Chats', bot: 'Bots', action: 'Actions' }
const KIND_ORDER: { readonly [K in PaletteItem['kind']]: number } = { action: 0, bot: 1, chat: 2 }
const CAPS: { readonly [K in PaletteItem['kind']]: number } = { chat: 8, bot: 6, action: Infinity }

const WORD = /[\p{L}\p{N}]/u
const previewOf = (item: PaletteItem) => (item.kind === 'chat' ? item.preview : null)
const lastActiveOf = (item: PaletteItem) => (item.kind === 'chat' ? item.lastActiveAt : null)

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
  if (inTitle === 'start') return GRADE.titleStart
  if (inPreview === 'start') return GRADE.previewStart
  if (inTitle === 'inside') return GRADE.titleInside
  return inPreview === 'inside' ? GRADE.previewInside : null
}

const newestFirst = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a)

export function rank(query: string, items: readonly PaletteItem[]): readonly Ranked[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(term => term !== '')
  const ranked: Ranked[] = []
  for (const item of items) {
    const title = item.title.toLocaleLowerCase()
    const preview = previewOf(item)?.toLocaleLowerCase() ?? null
    const grades = terms.map(term => gradeOf(term, title, preview))
    if (!grades.every(grade => grade !== null)) continue
    ranked.push({ item, grade: Math.max(GRADE.titleStart, ...grades) as Grade, excerpt: grades.some(grade => IN_PREVIEW.has(grade)) ? previewOf(item) : null })
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

function sectionsOf(rows: readonly Row[]): Section[] {
  const kinds = [...new Set(rows.map(row => row.item.kind))]
  return kinds.map(kind => ({ heading: HEADINGS[kind], rows: rows.filter(row => row.item.kind === kind).slice(0, CAPS[kind]) }))
}

const plain = (item: PaletteItem): Row => ({ item, excerpt: null })
const askingFirst = (a: ChatItem, b: ChatItem) => Number(b.badge === 'asking') - Number(a.badge === 'asking')

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
