import type { CommandOutcome, Header, ServerSetup, ServerState, Tested, ToolServer } from '@highwing/hermes/domain'

export type Read =
  | { readonly at: 'reading' }
  | { readonly at: 'read'; readonly servers: readonly ToolServer[] }
  | { readonly at: 'refused'; readonly words: string; readonly unsupported: boolean }

export const readOf = (outcome: CommandOutcome<readonly ToolServer[]>): Read =>
  outcome.ok ? { at: 'read', servers: outcome.value } : { at: 'refused', words: outcome.refusal.message, unsupported: outcome.refusal.kind === 'unsupported' }

const count = (tools: number) => `${tools} ${tools === 1 ? 'tool' : 'tools'}`

export const STATES: { readonly [S in ServerState]: (tools: number) => string } = {
  connected: tools => `Connected · ${count(tools)}`,
  connecting: () => 'Connecting',
  failed: () => "Couldn't connect",
  'needs-sign-in': () => 'Needs sign-in',
  off: () => 'Off',
  idle: () => 'Starts when a chat needs it'
}

const LISTED_TOOLS = 5

function toolList(tools: readonly string[]): string {
  if (tools.length === 0) return ''
  const shown = tools.slice(0, LISTED_TOOLS).join(', ')
  return tools.length > LISTED_TOOLS ? `: ${shown} and ${tools.length - LISTED_TOOLS} more` : `: ${shown}`
}

export function testedWords(name: string, tested: Tested): string {
  if (tested.ok) return `Connected. ${name} has ${count(tested.tools.length)}${toolList(tested.tools)}.`
  if (tested.why === 'sign-in') return `${name} needs a sign-in, which Highwing can't do yet. Nothing was saved.`
  return `Couldn't connect to ${name}: ${tested.reason.replace(/\.$/, '')}. Nothing was saved.`
}

export interface Draft {
  readonly name: string
  readonly kind: ServerSetup['kind']
  readonly url: string
  readonly headers: readonly Header[]
  readonly command: string
  readonly args: string
}
export const EMPTY: Draft = { name: '', kind: 'address', url: '', headers: [], command: '', args: '' }

/** Each line of `args` is one argument as typed. A final newline ends the list, and adds no empty argument. */
export function setupOf(draft: Draft): ServerSetup {
  const name = draft.name.trim()
  if (draft.kind === 'address') {
    const headers = draft.headers.map(header => ({ name: header.name.trim(), value: header.value })).filter(header => header.name !== '' && header.value !== '')
    return { kind: 'address', name, url: draft.url.trim(), headers }
  }
  return { kind: 'command', name, command: draft.command.trim(), args: draft.args === '' ? [] : draft.args.replace(/\n$/, '').split('\n') }
}

export const ready = (draft: Draft) => draft.name.trim() !== '' && (draft.kind === 'address' ? draft.url.trim() !== '' : draft.command.trim() !== '')
