import { shortcutOf, type ShortcutId } from './shortcuts'

export const MAC = navigator.userAgent.includes('Mac')

export const isShortcut = (event: KeyboardEvent, id: ShortcutId) => shortcutOf(event, MAC)?.id === id
