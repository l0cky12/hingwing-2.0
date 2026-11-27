export type ShortcutId =
  | 'palette' | 'newChat' | 'details' | 'find' | 'sheet' | 'bot' | 'previousBot' | 'nextBot' | 'cycleBot' | 'cycleBotBack'
  | 'back' | 'forward' | 'focusComposer' | 'addSelection' | 'newGroup' | 'settings' | 'apps' | 'compactSidebar' | 'send' | 'dictate' | 'zoomIn' | 'zoomOut' | 'zoomReset'

export interface Shortcut {
  readonly id: ShortcutId
  /** The sheet's heading. */
  readonly group: 'Go to' | 'Chat' | 'Window'
  readonly label: string
  /** `command` is Ctrl on Linux and Windows and Cmd on macOS. `ctrl` is Ctrl everywhere. `ctrlAlt` is Ctrl and Alt together. */
  readonly mod: 'command' | 'ctrl' | 'alt' | 'ctrlAlt'
  readonly shift: boolean | 'any'
  /** The `KeyboardEvent.key` values it matches, letters in lowercase. */
  readonly keys: readonly string[]
  /** The key cap the sheet draws after the modifiers. */
  readonly shown: string
  readonly onlyIn: string | null
  /** The keys on macOS when they differ, as where Option+letter types a character. */
  readonly mac: Pick<Shortcut, 'mod' | 'shift' | 'keys' | 'shown'> | null
}

const row = (id: ShortcutId, group: Shortcut['group'], label: string, mod: Shortcut['mod'], keys: string, shown: string, more: { shift?: boolean | 'any'; onlyIn?: string; mac?: Shortcut['mac'] } = {}): Shortcut =>
  ({ id, group, label, mod, shift: more.shift ?? false, keys: keys.split(' '), shown, onlyIn: more.onlyIn ?? null, mac: more.mac ?? null })

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
  row('details', 'Chat', 'Bot details', 'ctrlAlt', 'b', 'B', { onlyIn: 'In a bot chat', mac: { mod: 'command', shift: true, keys: ['i'], shown: 'I' } }),
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

/** The shortcut as it is pressed on this platform. */
export const onPlatform = (shortcut: Shortcut, mac: boolean): Shortcut => (mac && shortcut.mac !== null ? { ...shortcut, ...shortcut.mac } : shortcut)

export function matches(row: Shortcut, press: Press, mac: boolean): boolean {
  const shortcut = onPlatform(row, mac)
  const { mod, shift } = shortcut
  if (press.altKey !== (mod === 'alt' || mod === 'ctrlAlt') || (shift !== 'any' && press.shiftKey !== shift)) return false
  const [held, other] = mod === 'command' && mac ? [press.metaKey, press.ctrlKey] : [press.ctrlKey, press.metaKey]
  return (mod === 'alt' ? !held : held) && !other && keyMatches(shortcut, press)
}

/** The shortcut a key press is, with the digit it names for `bot`. */
export function shortcutOf(press: Press, mac: boolean): { readonly id: ShortcutId; readonly digit: number | null } | null {
  const hit = SHORTCUTS.find(shortcut => matches(shortcut, press, mac))
  return hit === undefined ? null : { id: hit.id, digit: hit.id === 'bot' ? Number(press.key) : null }
}

export function capsOf(row: Shortcut, mac: boolean): readonly string[] {
  const { mod, shift, shown } = onPlatform(row, mac)
  const alt = mac ? '⌥' : 'Alt'
  const modifiers = mod === 'alt' ? [alt] : mod === 'ctrlAlt' ? ['Ctrl', alt] : [mod === 'command' && mac ? '⌘' : 'Ctrl']
  return [...modifiers, ...(shift === true ? [mac ? '⇧' : 'Shift'] : []), shown]
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
