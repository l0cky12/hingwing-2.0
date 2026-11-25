import type { OpenChat } from '@highwing/hermes/domain'
import type { WindowCommand } from '../ipc-contract'

/** The one way a window starts a new chat: with the bot of the open chat. The top bar, Ctrl+N, the palette and the plus menu all send this. */
export const newChatIn = (open: OpenChat | undefined, draftId: string): Extract<WindowCommand, { readonly do: 'open' }> =>
  ({ do: 'open', ref: { kind: 'new', bot: open?.shown?.bot ?? null, draftId } })

/** The top bar's New chat shortcut: as the palette and the plus menu print it, and as `aria-keyshortcuts` names it. */
export const newChatKeys = (mac: boolean) => (mac ? { shown: '⌘N', aria: 'Meta+N' } : { shown: 'Ctrl+N', aria: 'Control+N' })
