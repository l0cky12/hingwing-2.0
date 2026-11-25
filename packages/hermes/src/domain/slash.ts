import type { Command } from './command'
import type { SessionId } from './session'

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

export type Own = OwnCommand | { readonly usage: string } | null

export const OWN_COMMANDS = {
  title: (sessionId, title) => (title === '' ? null : { do: 'rename', sessionId, title }),
  btw: (sessionId, text) => (text === '' ? { usage: '/btw <question>' } : { do: 'side', sessionId, kind: 'btw', text }),
  bg: (sessionId, text) => (text === '' ? { usage: '/bg <prompt>' } : { do: 'side', sessionId, kind: 'background', text }),
  /** `here [N]` and `--preview`, anywhere in the line, are Hermes's own forms (hermes_cli/partial_compress.py:51-63), which Highwing does not send, so Hermes answers those lines. */
  compress: (sessionId, focus) => (/^(-|here\b)|(^|\s)--preview(\s|$)/.test(focus) ? null : { do: 'compress', sessionId, focus: focus === '' ? null : focus })
} as const satisfies { readonly [name: string]: (sessionId: SessionId, arg: string) => Own }

export function ownCommand({ entry, arg }: SlashLine, sessionId: SessionId): Own {
  if (entry.kind !== 'command' || !Object.hasOwn(OWN_COMMANDS, entry.name)) return null
  return OWN_COMMANDS[entry.name as keyof typeof OWN_COMMANDS](sessionId, arg)
}
