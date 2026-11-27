import type { SendKey } from '../ipc-contract'

export const MAC = navigator.userAgent.includes('Mac')

export const COMMAND_KEY = MAC ? '⌘' : 'Ctrl'

/** Ctrl+`letter`, or Cmd+`letter` on macOS. A layout whose key types no Latin letter is read by the key's place. */
export const isCommandKey = (event: KeyboardEvent, letter: string) =>
  (/^[a-z]$/i.test(event.key) ? event.key.toLowerCase() === letter : event.code === `Key${letter.toUpperCase()}`)
  && !event.altKey && !event.shiftKey && (MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)

/** Whether this keydown sends the message. Where Enter does not send, it is left alone so the textarea adds its line. */
export const sendsMessage = (event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>, sendKey: SendKey) =>
  event.key === 'Enter' && (sendKey === 'enter'
    ? !event.shiftKey
    : !event.altKey && !event.shiftKey && (MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey))

export const SEND_KEY_LABEL: { readonly [K in SendKey]: string } = { enter: 'Enter', modEnter: `${COMMAND_KEY}+Enter` }
