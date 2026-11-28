import type { Hermes } from '@highwing/hermes'
import { fileNameOf, type BotId, type CommandOutcome, type FarFile, type LibraryItem, type LibraryItemId, type LibraryRead } from '@highwing/hermes/domain'
import { libraryOf } from '@highwing/thread'
import { copyFile, stat, writeFile } from 'node:fs/promises'
import { isLocal, isWebPage, OTHER_CONNECTION, type AppResult, type LibraryCommand } from '../ipc-contract'
import type { ConnectionOwner } from './connection'
import type { PreviewPane } from './preview'
import type { Source } from './preview-page'
import { savedAs, type Saver } from './saves'

export interface LibraryOwner {
  /** `live`: whether the connection the window sent this for is still the live one. Asked again after every wait. */
  run<C extends LibraryCommand>(command: C, live: () => boolean): Promise<CommandOutcome<AppResult<C>>>
}

export interface LibraryDeps {
  readonly owner: Pick<ConnectionOwner, 'hermes' | 'setup' | 'run' | 'download'>
  readonly pane: Pick<PreviewPane, 'show'>
  readonly saver: Saver
}

const DONE: CommandOutcome<void> = { ok: true, value: undefined }
const refused = (kind: 'stale' | 'rejected', message: string): CommandOutcome<never> => ({ ok: false, refusal: { kind, message } })
const STALE_LIST = refused('stale', 'This list is out of date. Open the Library tab again.')
const MISSING = new Set(['ENOENT', 'ENOTDIR'])

type Write = (to: string) => Promise<void>

/** A file of this computer, copied. One that is gone or no file is refused before anyone is asked where to put it. */
async function copyOf(path: string): Promise<CommandOutcome<Write>> {
  const name = fileNameOf(path)
  const found = await stat(path).then(
    held => (held.isFile() ? 'file' as const : 'other' as const),
    (error: NodeJS.ErrnoException) => (MISSING.has(error.code ?? '') ? 'missing' as const : 'unreadable' as const)
  )
  const WORDS = { missing: refused('stale', `${name} isn't there any more.`), other: refused('rejected', `${name} isn't a file Highwing can save.`), unreadable: refused('rejected', `Highwing couldn't read ${name}.`) }
  return found === 'file' ? { ok: true, value: to => copyFile(path, to) } : WORDS[found]
}

/**
 * The one owner of what a window may do with a bot's Library. Main reads the Library for the window, and keeps every item a read
 * named, per connection and bot. A preview or a save acts only on an item the live connection's read named, by the id the window
 * hands back, so no path or address a window makes up goes anywhere, and a new connection starts with nothing. Whether a file is on
 * this computer is asked of the connection at the moment of the act. A file of a Hermes elsewhere is never opened here, whatever
 * this computer holds at its path.
 */
export function ownLibrary({ owner, pane, saver }: LibraryDeps): LibraryOwner {
  const named = new WeakMap<Hermes, Map<BotId, Map<LibraryItemId, LibraryItem>>>()

  const keep = (hermes: Hermes, bot: BotId, items: readonly LibraryItem[]) => {
    const bots = named.get(hermes) ?? new Map<BotId, Map<LibraryItemId, LibraryItem>>()
    named.set(hermes, bots)
    const held = bots.get(bot) ?? new Map<LibraryItemId, LibraryItem>()
    bots.set(bot, held)
    for (const item of items) {
      const seen = held.get(item.id)
      if (seen === undefined || (item.at ?? -Infinity) > (seen.at ?? -Infinity)) held.set(item.id, item)
    }
  }
  const itemOf = (bot: BotId, id: LibraryItemId): LibraryItem | undefined => (owner.hermes === null ? undefined : named.get(owner.hermes)?.get(bot)?.get(id))

  const read = async (bot: BotId, step: number, live: () => boolean): Promise<CommandOutcome<LibraryRead>> => {
    const hermes = owner.hermes
    const made = await owner.run({ do: 'readMade', bot, step })
    if (!made.ok) return made
    if (hermes === null || owner.hermes !== hermes || !live()) return OTHER_CONNECTION
    const items = libraryOf(made.value.chats, isWebPage)
    keep(hermes, bot, items)
    const { chats, reach, unread } = made.value
    return { ok: true, value: { items, chats: chats.length + unread, reach, unread } }
  }

  const preview = async (bot: BotId, id: LibraryItemId): Promise<CommandOutcome<void>> => {
    const item = itemOf(bot, id)
    if (item === undefined) return STALE_LIST
    const { where } = item
    const source: Source | undefined = where.on === 'web' ? undefined : { named: path => (path === where.path ? path : null), elsewhere: 'Save it to open it on this computer.', session: item.chat.sessionId }
    return pane.show(where.on === 'web' ? where.url : where.path, null, source) ? DONE : refused('rejected', "Highwing can't show that.")
  }

  const downloaded = async (file: FarFile): Promise<CommandOutcome<Write>> => {
    const got = await owner.download(file)
    return got.ok ? { ok: true, value: to => writeFile(to, got.value) } : got
  }

  const save = async (bot: BotId, id: LibraryItemId, live: () => boolean): Promise<CommandOutcome<string | null>> => {
    const item = itemOf(bot, id)
    if (item === undefined) return STALE_LIST
    if (item.where.on !== 'hermes') return refused('rejected', 'Only a file of the Hermes machine can be saved.')
    const { path } = item.where
    const write = isLocal(owner.setup.get()) ? await copyOf(path) : await downloaded({ bot, sessionId: item.chat.sessionId, path })
    if (!write.ok) return write
    if (!live()) return OTHER_CONNECTION
    return savedAs(saver.save(fileNameOf(path), write.value))
  }

  type Run<K extends LibraryCommand['do']> = (command: Extract<LibraryCommand, { do: K }>, live: () => boolean) => Promise<CommandOutcome<AppResult<Extract<LibraryCommand, { do: K }>>>>
  const COMMANDS: { readonly [K in LibraryCommand['do']]: Run<K> } = {
    readLibrary: ({ bot, step }, live) => read(bot, step, live),
    previewLibraryItem: ({ bot, id }) => preview(bot, id),
    saveLibraryItem: ({ bot, id }, live) => save(bot, id, live)
  }

  return {
    run: async <C extends LibraryCommand>(command: C, live: () => boolean) =>
      (await (COMMANDS[command.do] as (command: C, live: () => boolean) => Promise<CommandOutcome<unknown>>)(command, live)) as CommandOutcome<AppResult<C>>
  }
}
