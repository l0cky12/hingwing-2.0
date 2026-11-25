/** How a message names another bot: `@Rae`, or `@"Timothy · CEO"` for a name with a space. */
import type { Bot } from './bots'

type Named = Pick<Bot, 'id' | 'name'>

const MENTIONS = /(?<![^\s])@(?:"([^"]+)"|(\S+))/g
const TYPING = /(?<![^\s])@("[^"]*|(?:[^\s"]\S*)?)$/
const TRAILING = /[.,!?;:)]+$/

function named<B extends Named>(bots: readonly B[], word: string): B | undefined {
  const sought = word.toLowerCase()
  return bots.find(bot => bot.id.toLowerCase() === sought) ?? bots.find(bot => bot.name.toLowerCase() === sought)
}

/** The distinct bots a message mentions, by id or else shown name, in any case, in the order it first names them. */
export function mentionedBots<B extends Named>(text: string, bots: readonly B[]): readonly B[] {
  const found = new Set<B>()
  for (const [, quoted, bare = ''] of text.matchAll(MENTIONS)) {
    const bot = quoted === undefined ? named(bots, bare) ?? named(bots, bare.replace(TRAILING, '')) : named(bots, quoted)
    if (bot !== undefined) found.add(bot)
  }
  return [...found]
}

/** The text a pick puts in the box. The id stands in for a name that holds a quote or names another of `bots`. */
export function mentionOf<B extends Named>(bot: B, bots: readonly B[]): string {
  const word = !bot.name.includes('"') && named(bots, bot.name) === bot ? bot.name : bot.id
  return /\s/.test(word) ? `@"${word}" ` : `@${word} `
}

/** The mention being typed at the end of `before`, the text left of the caret: where its `@` sits and what follows it, less an opening quote. */
export function typedMention(before: string): { readonly at: number; readonly query: string } | null {
  const match = TYPING.exec(before)
  return match === null ? null : { at: match.index, query: (match[1] as string).replace(/^"/, '') }
}
