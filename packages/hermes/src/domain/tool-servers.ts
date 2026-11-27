export interface Header { readonly name: string; readonly value: string }

/** What the user types to add a tool server: a web address with optional headers, or a command on the Hermes machine with its arguments. */
export type ServerSetup =
  | { readonly kind: 'address'; readonly name: string; readonly url: string; readonly headers: readonly Header[] }
  | { readonly kind: 'command'; readonly name: string; readonly command: string; readonly args: readonly string[] }

/** `idle`: Hermes holds the server and has not connected it, which it does when a chat needs it. `needs-sign-in`: Hermes parked it on a rejected sign-in. */
export type ServerState = 'connected' | 'connecting' | 'failed' | 'needs-sign-in' | 'off' | 'idle'

/** `where`: the server's address without its query, or its command and arguments. Never a header value. `removable`: false for a server a plugin provides. */
export interface ToolServer {
  readonly name: string
  readonly where: string
  readonly state: ServerState
  readonly tools: number
  readonly removable: boolean
}

/** `sign-in`: the server asked for a sign-in, which Highwing cannot do yet. */
export type Tested =
  | { readonly ok: true; readonly tools: readonly string[] }
  | { readonly ok: false; readonly why: 'failed'; readonly reason: string }
  | { readonly ok: false; readonly why: 'sign-in' }

/** `servers`: the bot's tool servers read again after the add. A server whose `tested` failed is not among them. */
export interface Added { readonly tested: Tested; readonly servers: readonly ToolServer[] }
