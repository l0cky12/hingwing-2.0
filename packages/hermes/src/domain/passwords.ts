import type { BotId } from './bots'

export const MANAGER_NAMES = ['onepassword', 'bitwarden'] as const
export type ManagerName = typeof MANAGER_NAMES[number]

/** `locked` covers both a manager never unlocked and one Hermes locked again after 30 idle minutes (agent/vault_backends/unlock.py:29). */
export type ManagerState =
  | { readonly at: 'missing' }
  | { readonly at: 'off' }
  | { readonly at: 'locked' }
  /** `logins` is null when Hermes could not list them, as for a 1Password service account whose token was revoked. */
  | { readonly at: 'ready'; readonly logins: number | null }

export interface Manager { readonly name: ManagerName; readonly label: string; readonly state: ManagerState }

export interface BotManagers { readonly bot: BotId; readonly managers: readonly Manager[] }

/** A one-time step done in a terminal on the Hermes machine, since Hermes has no call for it. `command` is shown as code. */
export interface FirstTime { readonly lead: string; readonly command: string; readonly after: string }

export interface ManagerFacts {
  readonly label: string
  readonly install: string
  readonly firstTime: (bot: BotId) => FirstTime
}

export const MANAGERS: { readonly [N in ManagerName]: ManagerFacts } = {
  onepassword: {
    label: '1Password',
    install: 'https://developer.1password.com/docs/cli/get-started/',
    firstTime: bot => ({ lead: 'Using a service account token? Run', command: `hermes -p ${bot} secrets onepassword token`, after: 'on the Hermes machine and it unlocks on its own.' })
  },
  bitwarden: {
    label: 'Bitwarden',
    install: 'https://bitwarden.com/help/cli/',
    firstTime: () => ({ lead: 'First time? Run', command: 'bw login --apikey', after: 'once on the Hermes machine.' })
  }
}

export const isManagerName = (value: unknown): value is ManagerName => MANAGER_NAMES.some(name => name === value)
