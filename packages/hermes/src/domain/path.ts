/** A file or folder in a chat's working folder that `@` can name. */
export interface PathMatch {
  /** Relative to the chat's folder, as Hermes spells it. A folder's ends in `/`. */
  readonly path: string
  readonly folder: boolean
}
