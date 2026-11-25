import type { Command, Outcome, ResultOf } from './command'
import { EFFORTS, type BusyMode, type SessionId } from './session'

export interface SlashEntry {
  readonly kind: 'command' | 'skill'
  /** Without the leading slash, as typed after it. */
  readonly name: string
  readonly description: string
}

/** Commands first, then skills. Empty when Hermes has no catalog or refused it: then there is no menu. */
export type SlashCatalog = readonly SlashEntry[]

export interface SlashLine {
  readonly entry: SlashEntry
  readonly arg: string
}

const LINE = /^\/(\S+)(?:\s+([\s\S]*))?$/

export function slashLineOf(text: string, catalog: SlashCatalog): SlashLine | null {
  const match = LINE.exec(text.trim())
  if (match === null) return null
  const name = (match[1] as string).toLowerCase()
  const entry = catalog.find(held => held.name.toLowerCase() === name)
  return entry === undefined ? null : { entry, arg: (match[2] ?? '').trim() }
}

type OwnCommand = Exclude<Extract<Command, { readonly sessionId: SessionId }>, { readonly do: 'versions' }>

export type RunOwn = <C extends OwnCommand>(command: C) => Promise<Outcome<ResultOf<C>>>

/** `answer`: runs the line's command with `run` and words what it did, for the line under the composer. */
export type Own = OwnCommand | { readonly answer: (run: RunOwn) => Promise<Outcome<string>> } | { readonly usage: string } | null

export const OWN_COMMANDS = {
  title: (sessionId, title) => (title === '' ? null : { do: 'rename', sessionId, title }),
  btw: (sessionId, text) => (text === '' ? { usage: '/btw <question>' } : { do: 'side', sessionId, kind: 'btw', text }),
  bg: (sessionId, text) => (text === '' ? { usage: '/bg <prompt>' } : { do: 'side', sessionId, kind: 'background', text }),
  compress: compressCommand,
  busy: busyCommand,
  fast: fastCommand,
  reasoning: reasoningCommand
} as const satisfies { readonly [name: string]: (sessionId: SessionId, arg: string) => Own }

const COMPRESS_FLAGS: ReadonlySet<string> = new Set(['--preview', '--dry-run', '--dryrun', '--aggressive'])

/**
 * `/compress <arg>` read as Hermes's own parser reads it (hermes_cli/partial_compress.py:21-69, agent/conversation_compression_manual.py:63-64).
 * The partial, preview and aggressive forms are null: Highwing does not send them, so Hermes answers those lines.
 */
function compressCommand(sessionId: SessionId, arg: string): Own {
  const tokens = arg.split(/\s+/).filter(token => token !== '')
  if (tokens.some(token => COMPRESS_FLAGS.has(token.toLowerCase()))) return null
  const joined = tokens.join(' ')
  const focus = joined.toLowerCase().startsWith('up to here') ? joined.slice('up to '.length) : joined
  const [head = '', count] = focus.toLowerCase().split(' ')
  if (head === 'here' || ((head === '--keep' || head === '-k') && count !== undefined) || head.startsWith('--keep=')) return null
  return { do: 'compress', sessionId, focus: focus === '' ? null : focus }
}

const saying = <T>(done: Outcome<T>, words: (value: T) => string): Outcome<string> => (done.ok ? { ok: true, value: words(done.value) } : done)

const tuned = (command: Extract<OwnCommand, { do: 'tune' }>, says: string): Own => ({ answer: async run => saying(await run(command), () => says) })

const BUSY_MODES: readonly BusyMode[] = ['queue', 'steer', 'interrupt']

/** `/busy <mode>` set for this chat, as Hermes's TUI sets it (ui-tui/src/app/slash/commands/session.ts:763-800). A bare `/busy`, `status` and any other word are Hermes's to answer. */
function busyCommand(sessionId: SessionId, arg: string): Own {
  const to = BUSY_MODES.find(mode => mode === arg.toLowerCase())
  return to === undefined ? null : tuned({ do: 'tune', sessionId, set: 'busy', to }, `busy input mode: ${to}`)
}

/** The `/fast` words for the two tiers Highwing sets (gateway/slash_commands_model.py:25-33). `auto`, `cold`, `ultrafast`, `toggle`, `status` and `--global` are Hermes's. */
const FAST_WORDS: ReadonlyMap<string, boolean> = new Map([['fast', true], ['on', true], ['normal', false], ['off', false]])

function fastCommand(sessionId: SessionId, arg: string): Own {
  const on = FAST_WORDS.get(arg.toLowerCase())
  return on === undefined ? null : tuned({ do: 'tune', sessionId, set: 'fast', on }, `fast mode: ${on ? 'fast' : 'normal'}`)
}

const REASONING_SHOWN: ReadonlyMap<string, boolean> = new Map([['show', true], ['on', true], ['hide', false], ['off', false]])

/**
 * `/reasoning` for this chat, read as Hermes reads it (gateway/slash_commands_model.py:933-970), with the TUI's optional `--session`
 * (ui-tui/src/app/slash/commands/session.ts:75-95): a level, `reset`, or a display word. `--global`, `full`, `clamp` and a bare
 * `/reasoning` are Hermes's.
 */
function reasoningCommand(sessionId: SessionId, arg: string): Own {
  const [word, ...rest] = arg.toLowerCase().split(/\s+/).filter(token => token !== '' && token !== '--session')
  if (word === undefined || rest.length > 0) return null
  const effort = EFFORTS.find(level => level === word)
  if (effort !== undefined) return tuned({ do: 'tune', sessionId, set: 'effort', to: effort }, `reasoning: ${effort}`)
  if (word === 'reset') return tuned({ do: 'tune', sessionId, set: 'effort', to: 'default' }, 'Session reasoning override cleared; falling back to global config.')
  const on = REASONING_SHOWN.get(word)
  return on === undefined ? null : tuned({ do: 'tune', sessionId, set: 'reasoning', on }, `reasoning: ${on ? 'show' : 'hide'}`)
}

export function ownCommand({ entry, arg }: SlashLine, sessionId: SessionId): Own {
  if (entry.kind !== 'command' || !Object.hasOwn(OWN_COMMANDS, entry.name)) return null
  return OWN_COMMANDS[entry.name as keyof typeof OWN_COMMANDS](sessionId, arg)
}
