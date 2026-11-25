import { showsSettings, type Live, type Setup } from '../../ipc-contract'

type At<A extends Setup['at']> = Extract<Setup, { at: A }>

export type CardSetup = At<'form' | 'checking' | 'failed' | 'saved'>

export type Screen =
  | { readonly show: 'chat' }
  | { readonly show: 'first-run'; readonly setup: At<'form' | 'checking' | 'failed'> }
  | { readonly show: 'saved'; readonly live: Live }
  | { readonly show: 'settings'; readonly setup: CardSetup }

export function screenOf(setup: Setup): Screen {
  if (setup.at === 'chat' || setup.at === 'pinned') return { show: 'chat' }
  if (showsSettings(setup)) return { show: 'settings', setup }
  return setup.at === 'saved' ? { show: 'saved', live: setup.live } : { show: 'first-run', setup }
}
