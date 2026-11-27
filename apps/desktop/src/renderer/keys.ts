export const MAC = navigator.userAgent.includes('Mac')

export const COMMAND_KEY = MAC ? '⌘' : 'Ctrl'

/** Ctrl+`letter`, or Cmd+`letter` on macOS. A layout whose key types no Latin letter is read by the key's place. */
export const isCommandKey = (event: KeyboardEvent, letter: string) =>
  (/^[a-z]$/i.test(event.key) ? event.key.toLowerCase() === letter : event.code === `Key${letter.toUpperCase()}`)
  && !event.altKey && !event.shiftKey && (MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)

/** Ctrl+Comma, or Cmd+Comma on macOS. A letter chord cannot name the comma key. */
export const isSettingsChord = (event: KeyboardEvent) =>
  !event.repeat && !event.isComposing && !event.altKey && !event.shiftKey
  && (event.key === ',' || event.code === 'Comma')
  && (MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
