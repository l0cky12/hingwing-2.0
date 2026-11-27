import type { SendKey } from '../ipc-contract'
import { shortcutOf, type ShortcutId } from './shortcuts'

export const MAC = navigator.userAgent.includes('Mac')

export const isShortcut = (event: KeyboardEvent, id: ShortcutId) => shortcutOf(event, MAC)?.id === id

export const COMMAND_KEY = MAC ? '⌘' : 'Ctrl'

export const appsKeys = () => (MAC ? 'Meta+Shift+M' : 'Control+Shift+M')

/** Ctrl+Alt+B, or Cmd+Shift+I on macOS, where Option+B types a character. */
export const detailsKeys = (mac: boolean) => (mac ? { shown: '⌘⇧I', aria: 'Meta+Shift+I' } : { shown: 'Ctrl+Alt+B', aria: 'Control+Alt+B' })

/** Ctrl+Comma, or Cmd+Comma on macOS. A letter chord cannot name the comma key. */
export const isSettingsChord = (event: KeyboardEvent) =>
  !event.repeat && !event.isComposing && !event.altKey && !event.shiftKey
  && (event.key === ',' || event.code === 'Comma')
  && (MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)

/** Whether this keydown sends the message. Ctrl+Enter, or Cmd+Enter on macOS, always sends. Plain Enter sends unless `sendKey` leaves it to add a line. */
export const sendsMessage = (event: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>, sendKey: SendKey) =>
  event.key === 'Enter' && (sendKey === 'enter' ? !event.shiftKey : shortcutOf(event, MAC)?.id === 'send')

export const SEND_KEY_LABEL: { readonly [K in SendKey]: string } = { enter: 'Enter', modEnter: `${COMMAND_KEY}+Enter` }
