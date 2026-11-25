import { botsIn, mentionOf, typedMention, type Bot, type BotId, type Bots, type PathMatch, type RelayDesk, type SlashCatalog, type SlashEntry } from '@highwing/hermes/domain'

export type MenuItem =
  | { readonly kind: SlashEntry['kind']; readonly entry: SlashEntry }
  | { readonly kind: 'bot'; readonly bot: Bot; readonly mention: string }
  /** `current`: the row answers the word now typed. A row left from an older word shows until the new answer comes, and can't be picked. */
  | { readonly kind: 'file'; readonly match: PathMatch; readonly current: boolean }

export interface MenuSection {
  readonly label: string
  /** Never empty. */
  readonly items: readonly MenuItem[]
}

export interface MenuSources {
  readonly catalog: SlashCatalog
  /** The bots a message from this chat can be handed to. */
  readonly bots: readonly Bot[]
  readonly files: PathFiles
}

/** The files and folders of the chat's working folder that Hermes listed for `word`. */
export interface PathFiles {
  readonly word: string | null
  readonly matches: readonly PathMatch[]
}

export interface MenuState {
  readonly active: number
  /** The text Escape closed the list on. It stays closed until the text changes. */
  readonly dismissed: string | null
}

export type Menu =
  | { readonly open: false }
  | {
      readonly open: true
      /** The listbox's name. */
      readonly label: string
      readonly sections: readonly MenuSection[]
      /** Every section's items in order. `active` counts through them. */
      readonly items: readonly MenuItem[]
      readonly active: number
      /** The text a pick replaces. */
      readonly range: Range
    }

interface Range { readonly from: number; readonly to: number }

interface Trigger {
  readonly label: string
  typed(text: string, caret: number): (Range & { readonly query: string }) | null
  readonly sections: readonly { readonly label: string; items(query: string, sources: MenuSources): readonly MenuItem[] }[]
}

const CLOSED: Menu = { open: false }
const TYPING_A_NAME = /^\/(\S*)$/

const starts = (word: string, query: string) => word.toLowerCase().startsWith(query.toLowerCase())
const entries = (kind: SlashEntry['kind']) => (query: string, { catalog }: MenuSources): MenuItem[] =>
  catalog.filter(entry => entry.kind === kind && starts(entry.name, query)).map(entry => ({ kind, entry }))

const COMMANDS: Trigger = {
  label: 'Commands and skills',
  typed: text => {
    const query = TYPING_A_NAME.exec(text)?.[1]
    return query === undefined ? null : { from: 0, to: text.length, query }
  },
  sections: [{ label: 'Commands', items: entries('command') }, { label: 'Skills', items: entries('skill') }]
}

const MENTIONS: Trigger = {
  label: 'Mentions',
  typed: (text, caret) => {
    const typed = typedMention(text.slice(0, caret))
    if (typed === null) return null
    const close = text[typed.at + 1] === '"' ? text.indexOf('"', typed.at + 2) : -1
    const to = close >= caret ? close + 1 : caret + (/^\S*/.exec(text.slice(caret))?.[0].length ?? 0)
    return { from: typed.at, to, query: typed.query }
  },
  sections: [
    { label: 'Bots', items: (query, { bots }) => bots.filter(bot => starts(bot.name, query) || starts(bot.id, query)).map(bot => ({ kind: 'bot', bot, mention: mentionOf(bot, bots) })) },
    { label: 'Files', items: (query, { files }) => files.matches.map(match => ({ kind: 'file', match, current: files.word === `@${query}` })) }
  ]
}

const TRIGGERS: readonly Trigger[] = [COMMANDS, MENTIONS]

/** The mention being typed at the caret as Hermes completes it: its `@` and what follows, less an opening quote. null: none is being typed. */
export function mentionWord(text: string, caret: number): string | null {
  const typed = MENTIONS.typed(text, caret)
  return typed === null ? null : `@${typed.query}`
}

export function menuOf(text: string, caret: number, sources: MenuSources, { active, dismissed }: MenuState): Menu {
  if (text === dismissed) return CLOSED
  for (const trigger of TRIGGERS) {
    const typed = trigger.typed(text, caret)
    if (typed === null) continue
    const sections = trigger.sections.map(({ label, items }) => ({ label, items: items(typed.query, sources) })).filter(section => section.items.length > 0)
    const items = sections.flatMap(section => section.items)
    if (items.length === 0) return CLOSED
    return { open: true, label: trigger.label, sections, items, active: ((active % items.length) + items.length) % items.length, range: { from: typed.from, to: typed.to } }
  }
  return CLOSED
}

/**
 * A file is its plain path and a space. A folder stays a mention with no space, its quote left open, so the
 * caret is still in the word and the list goes on into the folder. A quoted mention can't hold a double quote, so a
 * folder whose path holds both a space and a quote goes in as a file does.
 */
export function completionOf(item: MenuItem): string {
  switch (item.kind) {
    case 'bot': return item.mention
    case 'file': {
      const { path, folder } = item.match
      const spaced = /\s/.test(path)
      if (folder && !spaced) return `@${path}`
      if (folder && !path.includes('"')) return `@"${path}`
      return spaced ? `"${path}" ` : `${path} `
    }
    default: return `/${item.entry.name} `
  }
}

/** The box after a pick: the typed text replaced by the item, and the caret after it. A space the item ends with is kept once, not doubled. */
export function picked(text: string, { from, to }: Range, item: MenuItem): { readonly text: string; readonly caret: number } {
  const word = completionOf(item)
  const rest = text.slice(to)
  return { text: text.slice(0, from) + word + (word.endsWith(' ') ? rest.replace(/^\s/, '') : rest), caret: from + word.length }
}

/**
 * The bots the `@` list offers: every listed bot but the open chat's own, and none on a Hermes that
 * cannot hand a message to another bot. `undefined`: Electron main has not pushed the topic yet.
 */
export function mentionable(bots: Bots | undefined, relay: RelayDesk | undefined, own: BotId | null): readonly Bot[] {
  return relay?.supported === true && bots?.state === 'listed' ? botsIn(bots.roster).filter(bot => bot.id !== own) : []
}
