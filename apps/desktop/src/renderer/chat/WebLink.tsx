import type { ReactNode } from 'react'
import type { PreviewCommand } from '../../ipc-contract'
import { run } from '../store'
import { useMenu } from './menu'

/** A web link in a reply. A press asks where to open it: in the pane beside the chat, or in the user's browser. */
export function WebLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  const { open, setOpen, holder, toggle, onKeyDown } = useMenu<HTMLSpanElement, HTMLAnchorElement>()
  const act = (command: PreviewCommand) => {
    setOpen(false)
    void run(command)
  }
  return (
    <span className="web-link" ref={holder} onKeyDown={onKeyDown}>
      <a
        ref={toggle} href={href} target="_blank" rel="noreferrer" aria-expanded={open}
        onClick={event => {
          event.preventDefault()
          setOpen(shown => !shown)
        }}
      >
        {children}
      </a>
      {open && (
        <span className="link-menu">
          <button type="button" onClick={() => act({ do: 'preview', url: href })}>Preview</button>
          <button type="button" onClick={() => act({ do: 'browse', url: href })}>Open in browser</button>
        </span>
      )}
    </span>
  )
}
