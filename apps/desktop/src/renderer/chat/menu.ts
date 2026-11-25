import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

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
