import { useId, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { isShortcut, MAC } from '../keys'
import { capsOf, SHORTCUTS } from '../shortcuts'

const GROUPS = [...new Set(SHORTCUTS.map(shortcut => shortcut.group))]

/** `back` is what had focus when the sheet opened. */
export function ShortcutSheet({ back, onClose }: { readonly back: Element | null; readonly onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const leaving = useRef(false)
  const heading = useId()
  useLayoutEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  // The dialog closes first: while it is modal, nothing outside it can take focus.
  const dismiss = () => {
    leaving.current = true
    dialog.current?.close()
    if (back instanceof HTMLElement && back.isConnected) back.focus()
    onClose()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.nativeEvent.isComposing || !isShortcut(event.nativeEvent, 'sheet')) return
    event.preventDefault()
    if (!event.repeat) dismiss()
  }
  const closeOnBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) dismiss()
  }
  return (
    <dialog
      ref={dialog} className="shortcut-sheet" aria-labelledby={heading}
      onCancel={event => { event.preventDefault(); dismiss() }}
      // The browser closes it outright, with no cancel, when no click or key came since its last cancel.
      onClose={() => { if (!leaving.current) dismiss() }}
      onKeyDown={onKeyDown} onClick={closeOnBackdrop}
    >
      <div className="shortcut-body">
        <h2 id={heading}>Keyboard shortcuts</h2>
        {GROUPS.map(group => (
          <section key={group} aria-label={group}>
            <h3>{group}</h3>
            <ul>
              {SHORTCUTS.filter(shortcut => shortcut.group === group).map(shortcut => (
                <li key={shortcut.id}>
                  <span>{shortcut.label}{shortcut.onlyIn !== null && <span className="where">{shortcut.onlyIn}</span>}</span>
                  <span className="keys">{capsOf(shortcut, MAC).map(cap => <kbd key={cap}>{cap}</kbd>)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </dialog>
  )
}
