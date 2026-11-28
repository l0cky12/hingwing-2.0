import { fileNameOf, type ChatMade, type LibraryItem, type LibraryItemId, type OnHermes } from '@highwing/hermes/domain'
import { leafText, parseMarkdown, proseLeaves, type Inline } from './prose'

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp)$/i

type Chat = LibraryItem['chat']

function fileItem(path: string, at: number | null, chat: Chat): LibraryItem {
  const where: OnHermes = { on: 'hermes', path }
  const listed = { id: `hermes:${path}` as LibraryItemId, name: fileNameOf(path), at, chat }
  return IMAGE_FILE.test(path) ? { ...listed, kind: 'image', where } : { ...listed, kind: 'file', where }
}

/** The links and images of a reply, in reading order. A link in a code block is code, not a link. */
function webItems(markdown: string, at: number | null, chat: Chat, shows: (url: string) => boolean): LibraryItem[] {
  const web = (url: string) => ({ on: 'web' as const, url })
  const walk = (nodes: readonly Inline[]): LibraryItem[] => nodes.flatMap((node): LibraryItem[] => {
    if (node.t === 'image') {
      if (!shows(node.src)) return []
      const url = URL.parse(node.src)
      const name = node.alt.trim() || fileNameOf(url?.pathname ?? '') || node.src
      return [{ id: `web:${url?.href ?? node.src}` as LibraryItemId, kind: 'image', name, at, chat, where: web(node.src) }]
    }
    if (node.t === 'link') {
      const inner = walk(node.children)
      if (!shows(node.href)) return inner
      const name = leafText(node.children).trim() || node.href
      return [{ id: `web:${URL.parse(node.href)?.href ?? node.href}` as LibraryItemId, kind: 'link', name, at, chat, where: web(node.href) }, ...inner]
    }
    return 'children' in node ? walk(node.children) : []
  })
  return proseLeaves(parseMarkdown(markdown)).flatMap(leaf => ('kind' in leaf ? [] : walk(leaf)))
}

const newer = (a: LibraryItem, b: LibraryItem): boolean => (a.at ?? -Infinity) > (b.at ?? -Infinity)

/**
 * Two lists as one: one item per id, the newer mention kept (the first on a tie), newest first. Items with the same time
 * keep their order, and items with no time go last.
 */
export function joinLibrary(held: readonly LibraryItem[], more: readonly LibraryItem[]): readonly LibraryItem[] {
  const kept = new Map<LibraryItemId, LibraryItem>()
  for (const item of [...held, ...more]) {
    const seen = kept.get(item.id)
    if (seen === undefined || newer(item, seen)) kept.set(item.id, item)
  }
  return [...kept.values()].sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity))
}

/**
 * The files, images and links the chats made, newest first. `chats` come newest chat first, as Hermes lists them, so on a tie a
 * newer chat comes first, and in one chat a later row. `shows`: whether an address is one the pane takes.
 */
export function libraryOf(chats: readonly ChatMade[], shows: (url: string) => boolean): readonly LibraryItem[] {
  const mentions = chats.flatMap(({ sessionId, title, rows }) => {
    const chat = { sessionId, title }
    return rows.toReversed().flatMap(row => ('wrote' in row ? row.wrote.map(path => fileItem(path, row.at, chat)) : webItems(row.said, row.at, chat, shows)))
  })
  return joinLibrary([], mentions)
}
