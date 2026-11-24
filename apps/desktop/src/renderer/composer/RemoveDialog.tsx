import { useId, useLayoutEffect, useRef } from 'react'
import { removalWords } from './edit'

interface RemoveDialogProps {
  readonly later: number
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export function RemoveDialog({ later, onCancel, onConfirm }: RemoveDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const detail = useId()
  useLayoutEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])
  return (
    <dialog
      ref={dialog} className="remove" aria-labelledby={title} aria-describedby={detail}
      onCancel={event => { event.preventDefault(); onCancel() }}
    >
      <p id={title} className="remove-count">{removalWords(later)}</p>
      <p id={detail}>Hermes can’t bring them back.</p>
      <div className="remove-choices">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={onConfirm}>Remove and send</button>
      </div>
    </dialog>
  )
}
