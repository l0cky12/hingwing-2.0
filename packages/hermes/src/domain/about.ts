/** The Hermes this socket is talking to, as About shows it. */
export type HermesRelease =
  | { readonly state: 'offline' }
  | { readonly state: 'unreported' }
  | { readonly state: 'known'; readonly version: string }

/** `app` is the Highwing version sent as the client. `hermes` is the connected gateway, or why it is not shown. */
export interface About {
  readonly app: string
  readonly hermes: HermesRelease
}

/** A non-empty `info.version`. Anything else is not a version. */
export function hermesVersionOf(version: unknown): string | null {
  if (typeof version !== 'string') return null
  const trimmed = version.trim()
  return trimmed === '' ? null : trimmed
}
