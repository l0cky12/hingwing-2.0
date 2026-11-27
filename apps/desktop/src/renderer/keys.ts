export const MAC = navigator.userAgent.includes('Mac')

export const COMMAND_KEY = MAC ? '⌘' : 'Ctrl'

/** A layout whose key types no Latin letter is read by the key's place. */
const isLetter = (event: KeyboardEvent, letter: string) =>
  /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() === letter : event.code === `Key${letter.toUpperCase()}`

/** Ctrl+`letter`, or Cmd+`letter` on macOS. */
export const isCommandKey = (event: KeyboardEvent, letter: string) =>
  isLetter(event, letter) && !event.altKey && !event.shiftKey && (MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)

/** Ctrl+Alt+B, or Cmd+Shift+I on macOS, where Option+B types a character. */
export const isDetailsKey = (event: KeyboardEvent, mac = MAC) => mac
  ? isLetter(event, 'i') && event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey
  : isLetter(event, 'b') && event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey

export const detailsKeys = (mac: boolean) => (mac ? { shown: '⌘⇧I', aria: 'Meta+Shift+I' } : { shown: 'Ctrl+Alt+B', aria: 'Control+Alt+B' })
