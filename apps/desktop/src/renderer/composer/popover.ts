import { useEffect, useRef, useState } from 'react'

/** A pill's popover. It shows only while `enabled`, and closes on Escape, which hands focus back to the pill, and on a press outside it. */
export function usePopover(enabled: boolean) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const shown = open && enabled

  useEffect(() => {
    if (!shown) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      button.current?.focus()
    }
    const onPress = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress)
    }
  }, [shown])

  return { shown, setOpen, anchor, button }
}
