import type { FindMatch, ThreadView } from '@highwing/thread'
import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react'

export interface FindState {
  readonly query: string
  /** `asked`: the rows find has opened, or left to you, for this match. A row it needs later, such as a new group, opens then. */
  readonly current: { readonly field: string; readonly start: number; readonly asked: ReadonlySet<string> } | null
  readonly openedByFind: ReadonlySet<string>
}

export const FIND_OPEN: FindState = { query: '', current: null, openedByFind: new Set() }

function countWords(query: string, total: number, current: number | null): string {
  if (query === '') return ''
  if (total === 0) return 'No matches'
  if (current === null) return total === 1 ? '1 match' : `${total} matches`
  return `${current + 1} of ${total}`
}

interface FindBarProps {
  readonly query: string
  readonly total: number
  readonly current: number | null
  readonly earlier: ThreadView['earlier']
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly onQuery: (query: string) => void
  readonly onStep: (direction: 1 | -1) => void
  readonly onClose: () => void
  readonly onLoadEarlier: () => void
}

export function FindBar({ query, total, current, earlier, inputRef, onQuery, onStep, onClose, onLoadEarlier }: FindBarProps) {
  useLayoutEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [inputRef])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && event.target === inputRef.current && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onStep(event.shiftKey ? -1 : 1)
    }
  }

  return (
    <div className="find-anchor">
      <form className="find" role="search" aria-label="Search this chat" onKeyDown={onKeyDown} onSubmit={event => event.preventDefault()}>
        <input ref={inputRef} aria-label="Find in chat" value={query} spellCheck={false} autoComplete="off" onChange={event => onQuery(event.target.value)} />
        <span className="count" role="status">{countWords(query, total, current)}</span>
        <button type="button" aria-label="Previous match" disabled={total === 0} onClick={() => onStep(-1)}><span aria-hidden="true">↑</span></button>
        <button type="button" aria-label="Next match" disabled={total === 0} onClick={() => onStep(1)}><span aria-hidden="true">↓</span></button>
        <button type="button" aria-label="Close find" onClick={onClose}><span aria-hidden="true">×</span></button>
        {earlier === 'more' && (
          <p className="note">Searching the loaded part of this chat. <button type="button" onClick={() => { onLoadEarlier(); inputRef.current?.focus() }}>Load earlier turns</button></p>
        )}
        {earlier === 'loading' && <p className="note">Loading earlier turns</p>}
      </form>
    </div>
  )
}

const insideFormula = (node: Node) => node.parentElement?.closest('[data-find-text]') != null
const insideFailedImage = (node: Node) => node.parentElement?.closest('[data-no-find]') != null

function lengthIn(node: Node): number | null {
  if (insideFormula(node)) return null
  if (node instanceof Text) return insideFailedImage(node) ? null : node.length
  if (node instanceof HTMLBRElement) return 1
  return node instanceof Element ? node.getAttribute('data-find-text')?.length ?? null : null
}

function rangeIn(element: Element, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ALL, {
    acceptNode: node => (lengthIn(node) === null ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT)
  })
  const range = document.createRange()
  let began = false
  let at = 0
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = lengthIn(node)!
    if (!began && start < at + length) {
      if (node instanceof Text) range.setStart(node, start - at)
      else range.setStartBefore(node)
      began = true
    }
    if (began && end <= at + length) {
      if (node instanceof Text) range.setEnd(node, end - at)
      else range.setEndAfter(node)
      return range
    }
    at += length
  }
  return null
}

function rangesOf(root: Element, matches: readonly FindMatch[]): (Range | null)[] {
  if (matches.length === 0) return []
  const elements = new Map<string, Element>()
  for (const element of root.querySelectorAll('[data-find]')) elements.set(element.getAttribute('data-find') ?? '', element)
  return matches.map(match => {
    const element = elements.get(match.field)
    return element === undefined ? null : rangeIn(element, match.start, match.end)
  })
}

function paint(name: string, ranges: readonly Range[]) {
  if (ranges.length === 0) CSS.highlights.delete(name)
  else {
    const highlight = new Highlight()
    for (const range of ranges) highlight.add(range)
    CSS.highlights.set(name, highlight)
  }
}

export function useFindMarks(root: RefObject<HTMLElement | null>, matches: readonly FindMatch[], current: number | null) {
  const currentRange = useRef<Range | null>(null)
  useLayoutEffect(() => {
    const element = root.current
    const mark = () => {
      const ranges = element === null ? [] : rangesOf(element, matches)
      const here = current === null ? null : ranges[current] ?? null
      currentRange.current = here
      paint('find', ranges.filter((range): range is Range => range !== null && range !== here))
      paint('find-current', here === null ? [] : [here])
    }
    mark()
    if (element === null || matches.length === 0) return
    // A code block that colors in replaces the text nodes its ranges sit in, which collapses them.
    const observer = new MutationObserver(mark)
    observer.observe(element, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [root, matches, current])
  useLayoutEffect(() => () => {
    CSS.highlights.delete('find')
    CSS.highlights.delete('find-current')
  }, [])
  return currentRange
}

const SCROLLS = new Set(['auto', 'scroll'])

/** A match in a drawn diagram's hidden source has no box of its own, so find scrolls to the block that holds it. */
function boxOf(range: Range): DOMRect {
  const hidden = range.startContainer.parentElement?.closest('[hidden]')
  return (hidden?.parentElement ?? range).getBoundingClientRect()
}

export function reveal(range: Range, scroller: HTMLElement) {
  const centre = (box: DOMRect) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
  for (let element = range.startContainer.parentElement; element !== null && element !== scroller; element = element.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(element)
    if (!SCROLLS.has(overflowX) && !SCROLLS.has(overflowY)) continue
    const target = centre(boxOf(range))
    const view = centre(element.getBoundingClientRect())
    if (SCROLLS.has(overflowY)) element.scrollTop += target.y - view.y
    if (SCROLLS.has(overflowX)) element.scrollLeft += target.x - view.x
  }
  scroller.scrollTop += centre(boxOf(range)).y - centre(scroller.getBoundingClientRect()).y
}
