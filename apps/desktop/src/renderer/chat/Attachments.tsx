import type { Attachment, AttachmentId } from '@highwing/hermes/domain'
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { ThreadImage, useImage } from './Image'

/** The type mark a file shows in place of a picture: its extension, or FILE for a name with none. */
export function markOf(name: string): string {
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1) : ''
  return extension === '' || extension.length > 4 ? 'FILE' : extension.toUpperCase()
}

function Thumb({ id }: { readonly id: AttachmentId }) {
  const state = useImage({ kind: 'attachment', id })
  if (state.s === 'ready') return <img className="thumb" alt="" src={state.url} />
  return <span className={state.s === 'loading' ? 'thumb' : 'mark'} aria-hidden="true">{state.s === 'loading' ? null : 'IMG'}</span>
}

const STEPS: Readonly<Record<string, -1 | 1>> = { ArrowLeft: -1, ArrowRight: 1 }

interface ChipsProps {
  readonly attachments: readonly Attachment[]
  readonly onRemove: (id: AttachmentId) => void
  readonly onMove: (id: AttachmentId, by: -1 | 1) => void
}

/** The files staged for the next message, in the order they will go. Alt+Left and Alt+Right move a focused chip. */
export function Chips({ attachments, onRemove, onMove }: ChipsProps) {
  const row = useRef<HTMLUListElement>(null)
  const moved = useRef<AttachmentId | null>(null)

  useLayoutEffect(() => {
    // React moves a chip by taking its node out and putting it back, which drops focus.
    const id = moved.current
    moved.current = null
    if (id !== null) row.current?.querySelector<HTMLElement>(`[data-attachment="${CSS.escape(id)}"]`)?.focus()
  }, [attachments])

  if (attachments.length === 0) return null
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, id: AttachmentId) => {
    const by = STEPS[event.key]
    if (by === undefined || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    event.preventDefault()
    moved.current = id
    onMove(id, by)
  }
  return (
    <ul className="chips" aria-label="Attachments" ref={row}>
      {attachments.map(({ id, name, kind }) => (
        <li
          key={id} className={kind === 'image' ? 'chip image' : 'chip'} title={kind === 'image' ? name : undefined} tabIndex={0} data-attachment={id} aria-label={name} aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
          onKeyDown={event => onKeyDown(event, id)}
        >
          {kind === 'image' ? <Thumb id={id} /> : <><span className="mark" aria-hidden="true">{markOf(name)}</span><span className="name">{name}</span></>}
          <button type="button" className="unchip" aria-label={`Remove ${name}`} onClick={() => onRemove(id)}>
            <svg aria-hidden="true" viewBox="0 0 10 10" width="10" height="10"><path d="M2 2l6 6M8 2 2 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** What was sent with a request, above it in the thread. An image opens larger on a press. */
export function SentAttachments({ attachments }: { readonly attachments: readonly Attachment[] }) {
  if (attachments.length === 0) return null
  return (
    <ul className="sent" aria-label="Attachments">
      {attachments.map(({ id, name, kind }) => (
        <li key={id} className={kind}>
          {kind === 'image'
            ? <ThreadImage request={{ kind: 'attachment', id }} alt={name} />
            : <><span className="mark" aria-hidden="true">{markOf(name)}</span><span className="name">{name}</span></>}
        </li>
      ))}
    </ul>
  )
}
