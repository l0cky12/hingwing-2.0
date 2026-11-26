export const MAC = navigator.userAgent.includes('Mac')

export const COMMAND_KEY = MAC ? '⌘' : 'Ctrl'

/** Ctrl+`letter`, or Cmd+`letter` on macOS. A layout whose key types no Latin letter is read by the key's place. */
export const isCommandKey = (event: KeyboardEvent, letter: string) =>
  (/^[a-z]$/i.test(event.key) ? event.key.toLowerCase() === letter : event.code === `Key${letter.toUpperCase()}`)
  && !event.altKey && !event.shiftKey && (MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)

export const detailsKeys = (mac: boolean) => (mac ? { shown: '⌘⇧I', aria: 'Meta+Shift+I' } : { shown: 'Ctrl+Alt+B', aria: 'Control+Alt+B' })

/** Alt and Shift change `event.key`, so the shortcut is read by the key's place. */
export function isDetailsKey(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, mac = MAC): boolean {
  return mac
    ? event.code === 'KeyI' && event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey
    : event.code === 'KeyB' && event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey
}
