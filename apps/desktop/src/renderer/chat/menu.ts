import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react'

/** A small menu under a toggle. A press outside `holder` closes it, and so does Escape, which gives focus back to the toggle. */
export function useMenu<H extends HTMLElement, T extends HTMLElement>() {
  const [open, setOpen] = useState(false)
  const holder = useRef<H>(null)
  const toggle = useRef<T>(null)

  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return
    event.stopPropagation()
    setOpen(false)
    toggle.current?.focus()
  }

  return { open, setOpen, holder, toggle, onKeyDown }
}

const STEPS: Readonly<Record<string, (at: number, count: number) => number>> = {
  ArrowDown: (at, count) => (at + 1) % count,
  ArrowUp: (at, count) => (at + count - 1) % count,
  Home: () => 0,
  End: (_at, count) => count - 1
}

export const menuStep = (key: string, at: number, count: number): number | null => STEPS[key]?.(at, count) ?? null

const THREAD_PAGING_KEYS: ReadonlySet<string> = new Set(['PageUp', 'PageDown'])

function useCloseWhenFocusLeaves(open: boolean, holder: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (open && !holder.current?.contains(document.activeElement)) close()
  })
}

/**
 * A menu of `menuitemradio` items under a toggle, one of them checked. It opens on the checked item, the arrow keys, Home and End
 * move, Shift+Tab and Escape close it onto the toggle, and focus leaving the holder closes it.
 */
export function usePickMenu() {
  const { open, setOpen, holder, toggle, onKeyDown } = useMenu<HTMLDivElement, HTMLButtonElement>()
  const items = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
    toggle.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const menu = items.current
    const first = menu?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu?.querySelector<HTMLElement>('[role="menuitemradio"]')
    first?.focus()
  }, [open])

  useCloseWhenFocusLeaves(open, holder, close)

  const onMenuKey = (event: KeyboardEvent) => {
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (THREAD_PAGING_KEYS.has(event.key)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const choices = [...(items.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    const next = menuStep(event.key, choices.indexOf(document.activeElement as HTMLElement), choices.length)
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    choices[next]?.focus()
  }
  const onMenuBlur = (event: FocusEvent) => {
    if (!holder.current?.contains(event.relatedTarget)) setOpen(false)
  }

  const menuProps = { ref: items, role: 'menu', tabIndex: -1, onKeyDown: onMenuKey, onBlur: onMenuBlur } as const

  return { open, setOpen, close, holder, toggle, onKeyDown, menuProps }
}
