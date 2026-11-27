/**
 * One plugin Hermes lists for a bot. `key`: the canonical name Hermes switches it by, which a bare `name` can share with a plugin of
 * another category. `source`: where Hermes found it, as `bundled`, `user` or `entrypoint`. `version`: empty when the plugin gives none.
 */
export interface Plugin {
  readonly name: string
  readonly key: string
  readonly version: string
  readonly description: string
  readonly source: string
  readonly enabled: boolean
}

/** The plugins as Hermes lists them after one was turned on or off. `restart`: the change takes effect only once Hermes restarts. */
export interface PluginSwitched {
  readonly plugins: readonly Plugin[]
  readonly restart: boolean
}
