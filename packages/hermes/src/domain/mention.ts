/** How a message names another bot: `@Rae`, or `@"Timothy · CEO"` for a name with a space. Shared by the composer's menu and the hub. */
import type { Bot } from './bots'

type Named = Pick<Bot, 'id' | 'name'>

/** `@` opens a mention only at the start of the text or after whitespace, so `sam@example` never does. */
const MENTIONS = /(?<![^\s])@(?:"([^"]+)"|(\S+))/g
const TYPING = /(?<![^\s])@("[^"]*|[^\s"]*)$/
const TRAILING = /[.,!?;:)]+$/

function named<B extends Named>(bots: readonly B[], word: string): B | undefined {
  const sought = word.toLowerCase()
  return bots.find(bot => bot.name.toLowerCase() === sought) ?? bots.find(bot => bot.id.toLowerCase() === sought)
}

/** The distinct bots a message mentions, by shown name or id in any case, in the order it first names them. */
export function mentionedBots<B extends Named>(text: string, bots: readonly B[]): readonly B[] {
  const found = new Set<B>()
  for (const [, quoted, bare = ''] of text.matchAll(MENTIONS)) {
    const bot = quoted === undefined ? named(bots, bare) ?? named(bots, bare.replace(TRAILING, '')) : named(bots, quoted)
    if (bot !== undefined) found.add(bot)
  }
  return [...found]
}

/** The text a pick puts in the box. A name that holds a quote cannot be quoted, so the id stands in for it. */
export function mentionOf({ id, name }: Named): string {
  const word = name.includes('"') ? id : name
  return /\s/.test(word) ? `@"${word}" ` : `@${word} `
}

/** The mention being typed at the end of `before`, the text left of the caret: where its `@` sits and what follows it, less an opening quote. */
export function typedMention(before: string): { readonly at: number; readonly query: string } | null {
  const match = TYPING.exec(before)
  return match === null ? null : { at: match.index, query: (match[1] as string).replace(/^"/, '') }
}
