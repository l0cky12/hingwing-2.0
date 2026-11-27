import { useId, useLayoutEffect, useRef } from 'react'

interface DeleteDialogProps {
  readonly name: string
  /** What deleting it takes with it, and that Hermes cannot bring it back. */
  readonly words: string
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export function DeleteDialog({ name, words, onCancel, onConfirm }: DeleteDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const heading = useId()
  useLayoutEffect(() => {
    const shown = dialog.current
    if (shown?.open === false) {
      shown.showModal()
      cancel.current?.focus()
    }
    return () => shown?.close()
  }, [])
  return (
    <dialog
      ref={dialog} className="confirm-dialog" aria-labelledby={heading}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); onCancel() }}
    >
      <h2 id={heading}>Delete {name}?</h2>
      <p>{words}</p>
      <div className="actions">
        <button ref={cancel} type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={onConfirm}>Delete</button>
      </div>
    </dialog>
  )
}
