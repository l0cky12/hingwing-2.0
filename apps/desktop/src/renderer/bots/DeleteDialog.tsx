import { useId, useLayoutEffect, useRef } from 'react'

interface DeleteDialogProps {
  readonly name: string
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export function DeleteDialog({ name, onCancel, onConfirm }: DeleteDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const heading = useId()
  useLayoutEffect(() => {
    if (dialog.current?.open === false) {
      dialog.current.showModal()
      cancel.current?.focus()
    }
  }, [])
  return (
    <dialog
      ref={dialog} className="confirm-dialog" aria-labelledby={heading}
      onCancel={event => { event.preventDefault(); onCancel() }}
    >
      <h2 id={heading}>Delete {name}?</h2>
      <p>Hermes removes the bot, its chats and its settings. It can't bring them back.</p>
      <div className="actions">
        <button ref={cancel} type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={onConfirm}>Delete</button>
      </div>
    </dialog>
  )
}
