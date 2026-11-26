import { useId, useLayoutEffect, useRef } from 'react'

interface RemoveDialogProps {
  /** What goes, which names the dialog. */
  readonly title: string
  /** What can't be undone, which describes it. */
  readonly detail: string
  readonly confirm: string
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export function RemoveDialog({ title, detail, confirm, onCancel, onConfirm }: RemoveDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const detailId = useId()
  useLayoutEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])
  return (
    <dialog
      ref={dialog} className="remove" aria-labelledby={titleId} aria-describedby={detailId}
      onCancel={event => { event.preventDefault(); onCancel() }}
    >
      <p id={titleId} className="remove-count">{title}</p>
      <p id={detailId}>{detail}</p>
      <div className="remove-choices">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={onConfirm}>{confirm}</button>
      </div>
    </dialog>
  )
}
