import type { Live, Setup } from '../../ipc-contract'

type At<A extends Setup['at']> = Extract<Setup, { at: A }>

/** The setup states the connection card draws. */
export type CardSetup = At<'form' | 'checking' | 'failed' | 'saved'>

/** What the window shows. Settings sits in the chat column, beside the sidebar. First run and its saved screen fill the window. */
export type Screen =
  | { readonly show: 'chat' }
  | { readonly show: 'first-run'; readonly setup: At<'form' | 'checking' | 'failed'> }
  | { readonly show: 'saved'; readonly live: Live }
  | { readonly show: 'settings'; readonly setup: CardSetup }

const CHAT: Screen = { show: 'chat' }
const editing = (setup: At<'form' | 'checking' | 'failed'>): Screen => (setup.live === null ? { show: 'first-run', setup } : { show: 'settings', setup })

/** Each setup state names its screen. */
const SCREENS: { readonly [A in Setup['at']]: (setup: At<A>) => Screen } = {
  chat: () => CHAT,
  pinned: () => CHAT,
  form: editing,
  checking: editing,
  failed: editing,
  saved: setup => (setup.from === 'first-run' ? { show: 'saved', live: setup.live } : { show: 'settings', setup })
}

export const screenOf = (setup: Setup): Screen => (SCREENS[setup.at] as (setup: Setup) => Screen)(setup)
