import { shortcutOf, type ShortcutId } from './shortcuts'

export const MAC = navigator.userAgent.includes('Mac')

export const isShortcut = (event: KeyboardEvent, id: ShortcutId) => shortcutOf(event, MAC)?.id === id

export const COMMAND_KEY = MAC ? '⌘' : 'Ctrl'

export const appsKeys = () => (MAC ? 'Meta+Shift+M' : 'Control+Shift+M')

/** Ctrl+Comma, or Cmd+Comma on macOS. A letter chord cannot name the comma key. */
export const isSettingsChord = (event: KeyboardEvent) =>
  !event.repeat && !event.isComposing && !event.altKey && !event.shiftKey
  && (event.key === ',' || event.code === 'Comma')
  && (MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
