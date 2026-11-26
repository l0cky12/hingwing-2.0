import type { OpenChat } from '@highwing/hermes/domain'
import type { WindowCommand } from '../ipc-contract'

export const newChatIn = (open: OpenChat | undefined, draftId: string): Extract<WindowCommand, { readonly do: 'open' }> =>
  ({ do: 'open', ref: { kind: 'new', bot: open?.shown?.bot ?? null, draftId } })

export const newChatKeys = (mac: boolean) => (mac ? { shown: '⌘N', aria: 'Meta+N' } : { shown: 'Ctrl+N', aria: 'Control+N' })
