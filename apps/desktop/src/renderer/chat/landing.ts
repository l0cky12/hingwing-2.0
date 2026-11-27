import type { Landing, SessionId, Version } from '@highwing/hermes/domain'

export interface Press extends Version { readonly terms: readonly string[] }

let asked: Press | null = null
const listeners = new Set<() => void>()

/** Each press is held as its own object, so a late answer to an earlier press can clear only that press. */
export const landAt = (version: Version, terms: readonly string[] = []): void => {
  asked = { ...version, terms }
  for (const listener of listeners) listener()
}

export const onPress = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const pressFor = (sessionId: SessionId): Press | null => (asked?.sessionId === sessionId ? asked : null)

export const landingFor = (sessionId: SessionId): Landing | null => pressFor(sessionId)?.landing ?? null

export const landed = (sessionId: SessionId): void => {
  if (asked?.sessionId === sessionId) asked = null
}

export const forget = (press: Version): void => {
  if (asked === press) asked = null
}

const LANDED = 'landed'
const TURN_CONTROLS = '.actions, .when, button'
let marked: MutationObserver | null = null

export const unmarkLanded = (): void => {
  if (marked === null) return
  marked.disconnect()
  CSS.highlights.delete(LANDED)
  marked = null
}

function rangesIn(turn: Element, terms: readonly string[]): Range[] {
  const ranges: Range[] = []
  const walker = document.createTreeWalker(turn, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
    const text = node.data.toLocaleLowerCase()
    if (node.parentElement?.closest(TURN_CONTROLS) != null || text.length !== node.data.length) continue
    for (const term of terms) {
      for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + term.length)) {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + term.length)
        ranges.push(range)
      }
    }
  }
  return ranges
}

/** Answers the element of the first mark, to scroll to, or null when the turn holds none of the terms. */
export function markLanded(turn: Element | null, terms: readonly string[]): Element | null {
  unmarkLanded()
  if (turn === null || terms.length === 0) return null
  const paint = () => {
    const ranges = rangesIn(turn, terms)
    CSS.highlights.set(LANDED, new Highlight(...ranges))
    return ranges
  }
  const [first] = paint()
  if (first === undefined) {
    CSS.highlights.delete(LANDED)
    return null
  }
  // A code block that colors in replaces the text nodes its ranges sit in, which collapses them.
  marked = new MutationObserver(paint)
  marked.observe(turn, { childList: true, subtree: true })
  return first.startContainer.parentElement
}
