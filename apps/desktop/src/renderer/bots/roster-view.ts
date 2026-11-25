import type { Bot, BotId, Bots, BotSection, Link, OpenChat } from '@highwing/hermes/domain'

/** What the list under the header shows. */
export type ListView =
  | { readonly show: 'loading' }
  | { readonly show: 'note'; readonly words: string }
  /** `sections` holds no empty section, and `featured` and `sections` are not both empty. */
  | { readonly show: 'roster'; readonly featured: Bot | null; readonly sections: readonly BotSection[] }

/** One line for every state with nothing to draw. */
export const NOTES: { readonly [S in Exclude<Bots['state'], 'loading' | 'listed'>]: string } = {
  offline: "Can't reach Hermes.",
  unsupported: "This Hermes can't list its bots.",
  refused: "Hermes wouldn't list its bots."
}
export const NEW_BOT_BLOCKS: { readonly [S in Exclude<Bots['state'], 'listed'>]: string } = {
  offline: "Highwing isn't connected to Hermes right now.",
  loading: "Highwing is still reading this Hermes's bots.",
  unsupported: "This Hermes can't create bots.",
  refused: "Highwing can't check names until Hermes lists its bots."
}
export const NO_BOTS = 'No bots yet.'
export const UNASSIGNED = 'Unassigned'

const LOADING: ListView = { show: 'loading' }

/** `bots` undefined: Electron main has not pushed the topic yet. `query` null: search is closed. */
export function listOf(bots: Bots | undefined, query: string | null): ListView {
  if (bots === undefined || bots.state === 'loading') return LOADING
  if (bots.state !== 'listed') return { show: 'note', words: NOTES[bots.state] }
  const { roster } = bots
  if (roster.featured === null && roster.sections.length === 0) return { show: 'note', words: NO_BOTS }
  const sought = (query ?? '').trim().toLowerCase()
  const kept = (bot: Bot) => bot.name.toLowerCase().includes(sought)
  const featured = roster.featured !== null && kept(roster.featured) ? roster.featured : null
  const sections = roster.sections.map(section => ({ ...section, bots: section.bots.filter(kept) })).filter(section => section.bots.length > 0)
  return featured === null && sections.length === 0 ? { show: 'note', words: `No bots match “${query}”` } : { show: 'roster', featured, sections }
}

export function newBotBlock(link: Link | undefined, bots: Bots | undefined): string | null {
  if (link === undefined || bots === undefined) return NEW_BOT_BLOCKS.loading
  if (link.state !== 'online') return NEW_BOT_BLOCKS.offline
  return bots.state === 'listed' ? null : NEW_BOT_BLOCKS[bots.state]
}

/** The highlighted bot: the bot of the open chat while the roster lists it, else none. */
export function selectedIn(bots: Bots | undefined, open: OpenChat | undefined): BotId | null {
  const bot = open?.shown?.bot ?? null
  return bot !== null && botIn(bots, bot) !== null ? bot : null
}

export function botIn(bots: Bots | undefined, bot: BotId): Bot | null {
  if (bots?.state !== 'listed') return null
  const { featured, sections } = bots.roster
  return [featured, ...sections.flatMap(section => section.bots)].find(held => held?.id === bot) ?? null
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The avatar's letter: the first grapheme of the name, so a flag or a joined emoji stays whole. */
export function initialOf(name: string): string {
  const [first] = graphemes.segment(name)
  return (first?.segment ?? '').toUpperCase()
}
