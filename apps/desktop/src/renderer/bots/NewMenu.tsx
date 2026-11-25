import { Fragment, useEffect, useId, useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { menuStep, useMenu } from '../chat/menu'
import type { PlusItem } from './plus-menu'

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true } as const
const Plus = () => <svg {...icon}><path d="M12 5v14M5 12h14" /></svg>
const ICONS: { readonly [I in PlusItem['id']]: ReactNode } = {
  'new-chat': <svg {...icon}><path d="M5 5h14v10H9l-4 4z" /></svg>,
  'new-group': <svg {...icon}><circle cx="9" cy="9" r="3.2" /><circle cx="16.5" cy="10" r="2.6" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6M15 14.6c2.6-.3 4.6 1.2 5.2 4.4" /></svg>,
  'new-bot': <svg {...icon}><rect x="5" y="8" width="14" height="11" rx="3" /><path d="M12 8V5M9.5 13h.01M14.5 13h.01" /></svg>
}

/** The plus in the Bots column's header and its menu. A blocked row stays focusable and says why it does nothing, as New bot did on its own. */
export function NewMenu({ items, onPick }: { readonly items: readonly PlusItem[]; readonly onPick: (id: PlusItem['id']) => void }) {
  const { open, setOpen, holder, toggle, onKeyDown } = useMenu<HTMLDivElement, HTMLButtonElement>()
  const menu = useRef<HTMLDivElement>(null)
  const ids = useId()

  useEffect(() => {
    if (open) menu.current?.querySelector('button')?.focus()
  }, [open])

  const pick = (item: PlusItem) => {
    if (item.block !== null) return
    // A dialog gives focus back on close to what had it when it opened, which must outlive the menu.
    setOpen(false)
    toggle.current?.focus()
    onPick(item.id)
  }
  const onMenuKey = (event: KeyboardEvent) => {
    const rows = [...(menu.current?.querySelectorAll('button') ?? [])]
    const next = menuStep(event.key, rows.indexOf(document.activeElement as HTMLButtonElement), rows.length)
    if (next === null) return
    event.preventDefault()
    rows[next]?.focus()
  }
  const onMenuBlur = (event: FocusEvent) => {
    if (!holder.current?.contains(event.relatedTarget)) setOpen(false)
  }

  return (
    <div className="new-holder" ref={holder} onKeyDown={onKeyDown}>
      <button ref={toggle} type="button" aria-label="New" aria-haspopup="menu" aria-expanded={open} title="New" onClick={() => setOpen(shown => !shown)}><Plus /></button>
      {open && (
        <div ref={menu} className="file-menu new-menu" role="menu" aria-label="New" onKeyDown={onMenuKey} onBlur={onMenuBlur}>
          <PlusItems items={items} idPrefix={ids} onPick={pick} />
        </div>
      )}
    </div>
  )
}

/** The rows of the open menu. A blocked row's reason is its description, kept out of its name. */
export function PlusItems({ items, idPrefix, onPick }: { readonly items: readonly PlusItem[]; readonly idPrefix: string; readonly onPick: (item: PlusItem) => void }) {
  return items.map(item => (
    <Fragment key={item.id}>
      {item.ruled && <hr />}
      <button
        type="button" role="menuitem" aria-keyshortcuts={item.keys?.aria} title={item.block ?? undefined}
        aria-disabled={item.block !== null || undefined} aria-describedby={item.block === null ? undefined : `${idPrefix}-${item.id}`}
        onClick={() => onPick(item)}
      >
        {ICONS[item.id]}{item.label}
        {item.keys !== null && <kbd aria-hidden="true">{item.keys.shown}</kbd>}
        {item.block !== null && <span className="sr" id={`${idPrefix}-${item.id}`} aria-hidden="true">{item.block}</span>}
      </button>
    </Fragment>
  ))
}
