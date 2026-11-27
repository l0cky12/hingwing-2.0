export type ShortcutId =
  | 'palette' | 'newChat' | 'find' | 'sheet' | 'bot' | 'previousBot' | 'nextBot' | 'cycleBot' | 'cycleBotBack'
  | 'back' | 'forward' | 'focusComposer' | 'addSelection' | 'newGroup' | 'settings' | 'apps' | 'compactSidebar' | 'send' | 'dictate' | 'zoomIn' | 'zoomOut' | 'zoomReset'

export interface Shortcut {
  readonly id: ShortcutId
  /** The sheet's heading. */
  readonly group: 'Go to' | 'Chat' | 'Window'
  readonly label: string
  /** `command` is Ctrl on Linux and Windows and Cmd on macOS. `ctrl` is Ctrl everywhere. */
  readonly mod: 'command' | 'ctrl' | 'alt'
  readonly shift: boolean | 'any'
  /** The `KeyboardEvent.key` values it matches, letters in lowercase. */
  readonly keys: readonly string[]
  /** The key cap the sheet draws after the modifiers. */
  readonly shown: string
  readonly onlyIn: string | null
}

const row = (id: ShortcutId, group: Shortcut['group'], label: string, mod: Shortcut['mod'], keys: string, shown: string, more: { shift?: boolean | 'any'; onlyIn?: string } = {}): Shortcut =>
  ({ id, group, label, mod, shift: more.shift ?? false, keys: keys.split(' '), shown, onlyIn: more.onlyIn ?? null })

export const SHORTCUTS: readonly Shortcut[] = [
  row('palette', 'Go to', 'Command palette', 'command', 'k', 'K'),
  row('bot', 'Go to', 'Open bot 1 to 9', 'command', '1 2 3 4 5 6 7 8 9', '1–9'),
  row('previousBot', 'Go to', 'Previous bot', 'alt', 'ArrowUp', '↑'),
  row('nextBot', 'Go to', 'Next bot', 'alt', 'ArrowDown', '↓'),
  row('cycleBot', 'Go to', 'Next bot, wrapping', 'ctrl', 'Tab', 'Tab'),
  row('cycleBotBack', 'Go to', 'Previous bot, wrapping', 'ctrl', 'Tab', 'Tab', { shift: true }),
  row('back', 'Go to', 'Back to the chat before', 'command', '[', '['),
  row('forward', 'Go to', 'Forward to the chat after', 'command', ']', ']'),
  row('newChat', 'Chat', 'New chat', 'command', 'n', 'N', { onlyIn: 'In a chat' }),
  row('newGroup', 'Chat', 'New group chat', 'command', 'n', 'N', { shift: true, onlyIn: 'In bot mode' }),
  row('find', 'Chat', 'Find in chat', 'command', 'f', 'F', { onlyIn: 'In a chat' }),
  row('send', 'Chat', 'Send the message, even when Enter adds a line', 'command', 'Enter', 'Enter', { onlyIn: 'In the message box' }),
  row('dictate', 'Chat', 'Start or stop dictation, or hold to talk', 'command', 'd', 'D', { onlyIn: 'In the message box' }),
  row('focusComposer', 'Chat', 'Focus the message box', 'command', 'i', 'I'),
  row('addSelection', 'Chat', 'Quote the selected text in the message box', 'command', 'l', 'L'),
  row('settings', 'Window', 'Settings', 'command', ',', ','),
  row('apps', 'Window', 'Connect apps', 'command', 'm', 'M', { shift: true }),
  row('compactSidebar', 'Window', 'Compact sidebar', 'command', 'b', 'B', { onlyIn: 'In bot mode' }),
  row('zoomIn', 'Window', 'Zoom in', 'command', '= +', '=', { shift: 'any' }),
  row('zoomOut', 'Window', 'Zoom out', 'command', '-', '-'),
  row('zoomReset', 'Window', 'Actual size', 'command', '0', '0'),
  row('sheet', 'Window', 'Keyboard shortcuts', 'command', '/', '/')
]

type Press = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

const LETTER = /^[a-z]$/

function keyMatches({ keys }: Shortcut, { key, code }: Press): boolean {
  const letter = keys.find(held => LETTER.test(held))
  if (letter === undefined) return keys.includes(key)
  const typed = key.toLowerCase()
  // A layout whose key types no Latin letter is read by the key's place.
  return LETTER.test(typed) ? typed === letter : code === `Key${letter.toUpperCase()}`
}

export function matches(shortcut: Shortcut, press: Press, mac: boolean): boolean {
  const { mod, shift } = shortcut
  if (press.altKey !== (mod === 'alt') || (shift !== 'any' && press.shiftKey !== shift)) return false
  const [held, other] = mod === 'command' && mac ? [press.metaKey, press.ctrlKey] : [press.ctrlKey, press.metaKey]
  return (mod === 'alt' ? !held : held) && !other && keyMatches(shortcut, press)
}

/** The shortcut a key press is, with the digit it names for `bot`. */
export function shortcutOf(press: Press, mac: boolean): { readonly id: ShortcutId; readonly digit: number | null } | null {
  const hit = SHORTCUTS.find(shortcut => matches(shortcut, press, mac))
  return hit === undefined ? null : { id: hit.id, digit: hit.id === 'bot' ? Number(press.key) : null }
}

export function capsOf({ mod, shift, shown }: Shortcut, mac: boolean): readonly string[] {
  const modifier = mod === 'alt' ? (mac ? '⌥' : 'Alt') : mod === 'command' && mac ? '⌘' : 'Ctrl'
  return [modifier, ...(shift === true ? [mac ? '⇧' : 'Shift'] : []), shown]
}

/** The item `by` places from `current` in sidebar order. With none current, forward is the first and back the last. */
export function botBeside<T>(order: readonly T[], current: T | null, by: -1 | 1, wrap: boolean): T | null {
  const at = current === null ? -1 : order.indexOf(current)
  if (at === -1) return order.at(by === 1 ? 0 : -1) ?? null
  const next = at + by
  return order[wrap ? (next + order.length) % order.length : next] ?? null
}

/** While a modal dialog is open it owns the keyboard, and Escape is its own. */
export const modalOpen = (): boolean => document.querySelector('dialog:modal') !== null
