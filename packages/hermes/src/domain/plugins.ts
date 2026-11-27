/** One plugin Hermes lists for a bot. `source`: where Hermes found it, as `bundled`, `user` or `entrypoint`. `version`: empty when the plugin gives none. */
export interface Plugin {
  readonly name: string
  readonly version: string
  readonly description: string
  readonly source: string
  readonly enabled: boolean
}
