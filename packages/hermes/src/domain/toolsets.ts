/** One of Hermes's toolsets: a named group of tools a chat can use. `toolCount` is Hermes's count, which `tools` may not reach. */
export interface Toolset {
  readonly name: string
  readonly description: string
  readonly tools: readonly string[]
  readonly toolCount: number
  readonly enabled: boolean
}
