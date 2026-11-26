import { useEffect, useRef, useState, type RefObject } from 'react'

/** Settings hides the chat and keeps it mounted, so a popover left open there leaves Escape to Settings. */
export const isEscapeFor = (event: KeyboardEvent, anchor: RefObject<HTMLElement | null>): boolean =>
  event.key === 'Escape' && anchor.current?.checkVisibility() === true

export function usePopover(enabled: boolean) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const shown = open && enabled

  useEffect(() => {
    if (!shown) return
    const onKey = (event: KeyboardEvent) => {
      if (!isEscapeFor(event, anchor)) return
      event.preventDefault()
      setOpen(false)
      button.current?.focus()
    }
    const onPress = (event: PointerEvent) => {
      if (anchor.current?.contains(event.target as Node)) return
      setOpen(false)
      // A press on something that takes no focus would leave it on the page once the popover is gone.
      setTimeout(() => { if (document.activeElement === document.body) button.current?.focus() })
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress)
    }
  }, [shown])

  return { shown, setOpen, anchor, button }
}
