import type { Control, Screen } from '@highwing/hermes/domain'
import { useSyncExternalStore } from 'react'

/** Who has the screen, as the view's header says it. */
export const CONTROL_WORDS: { readonly [C in Control]: string } = { agent: 'Hermes has control', you: 'You have control', someone: 'Someone else has control' }

/** What the card in the chat says under the picture. */
export const CARD_WORDS: { readonly [C in Control]: string } = { agent: 'Hermes is using its screen', you: 'You have control', someone: 'Someone else has control' }

/** The view's one button: take the screen from whoever has it, or give it back to Hermes. */
export const pressOf = (control: Control): { readonly label: string; readonly take: boolean } =>
  control === 'you' ? { label: 'Hand back', take: false } : { label: 'Take control', take: true }

/** What fills the view while there is no live screen to show. */
export const NO_SCREEN_WORDS: { readonly [S in Exclude<Screen['state'], 'on'>]: string } = {
  asking: "Checking Hermes's screen",
  unavailable: "This Hermes can't show its screen.",
  off: "Hermes isn't using its screen right now."
}

/** Why a live view closed, by the close code of its socket (hermes_cli/web_routers/display.py). 4000: a person took control, so the view watches again. */
export function closedWords(code: number): { readonly words: string; readonly again: boolean } {
  if (code === 4000) return { words: 'Someone else took control.', again: true }
  if (code === 4001) return { words: 'The screen stopped.', again: false }
  if (code === 1000 || code === 1001) return { words: 'The live view closed.', again: false }
  return { words: "Highwing couldn't reach the screen.", again: false }
}

let shown = false
const listeners = new Set<() => void>()

/** Whether the view is open beside the chat. It stays open across chats and shows each one's screen. */
export function showComputer(next: boolean) {
  if (next === shown) return
  shown = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
export const useComputerShown = (): boolean => useSyncExternalStore(subscribe, () => shown)
