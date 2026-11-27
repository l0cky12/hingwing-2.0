import type { BotId } from './bots'

/** Who drives a bot's screen. `you`: this Highwing took control. `someone`: a person in another window or app did. */
export type Control = 'agent' | 'you' | 'someone'

/**
 * A bot's screen, as the window draws it. `asking`: Hermes has not answered yet. `unavailable`: this Hermes can't show
 * its screen. `off`: the agent is not using a screen. `on`: it is. `thumbnail` is its latest frame as a JPEG data URL,
 * null before the first and while a person has control, since the frame may show what they type.
 */
export type Screen =
  | { readonly state: 'asking' }
  | { readonly state: 'unavailable' }
  | { readonly state: 'off' }
  | { readonly state: 'on'; readonly control: Control; readonly thumbnail: string | null }

/** The screen of the open chat's bot. `bot` null: the profile the connection itself uses. */
export interface ScreenView { readonly bot: BotId | null; readonly screen: Screen }

/** Hermes's takeover lease. `viewerHash` names the person who holds it, so the holder can tell it is them. A higher `epoch` is newer. */
export interface Lease { readonly holder: 'agent' | 'human'; readonly viewerHash: string | null; readonly epoch: number }

/** What Hermes says of a profile's screen. `key` is the profile's home, the name its events give it. */
export interface ScreenFacts { readonly key: string; readonly running: boolean; readonly lease: Lease }

/** A reply can be overtaken by an event about a newer lease, so the lease with the higher epoch wins, and a tie keeps the newest word. */
export const newerLease = (held: Lease | null, next: Lease): Lease => (held !== null && held.epoch > next.epoch ? held : next)

/** `mine`: the hashes of the viewer ids Hermes minted for this Highwing. */
export const controlOf = (lease: Lease, mine: { has(hash: string): boolean }): Control =>
  lease.holder === 'agent' ? 'agent' : lease.viewerHash !== null && mine.has(lease.viewerHash) ? 'you' : 'someone'
