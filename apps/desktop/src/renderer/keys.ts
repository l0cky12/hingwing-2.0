/** Ctrl+`letter`, or Cmd+`letter` on macOS. A layout whose key types no Latin letter is read by the key's place. */
export const isCommandKey = (event: KeyboardEvent, letter: string) =>
  (/^[a-z]$/i.test(event.key) ? event.key.toLowerCase() === letter : event.code === `Key${letter.toUpperCase()}`)
  && !event.altKey && !event.shiftKey && (navigator.userAgent.includes('Mac') ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
