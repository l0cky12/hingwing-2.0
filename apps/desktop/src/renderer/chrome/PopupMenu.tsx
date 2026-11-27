import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { keyMove, placeMenu, placeSubmenu, type Anchor } from './popup-menu'

export const ICON = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export interface PopupItem<A extends string> {
  readonly id: A
  readonly label: string
  readonly icon?: ReactNode
  /** Shown at the item's right end, and read as its description rather than its name. */
  readonly hint?: string
  /** Choices that open in a menu beside this item. */
  readonly submenu?: readonly PopupItem<A>[]
  /** Why the item can't be used now, shown as its title and said to a screen reader. It stays focusable. */
  readonly block?: string
}

export interface PopupMenuProps<A extends string> {
  readonly label: string
  readonly groups: readonly (readonly PopupItem<A>[])[]
  readonly className: string
  /** Where the menu opens, read once it is drawn and its size is known. */
  readonly anchor: () => Anchor
  /** An element outside the menu that a press or focus on leaves it open, such as the button that toggles it. */
  readonly owns: (target: Element) => boolean
  readonly onChoose: (id: A) => void
  readonly onClose: (how: 'escape' | 'tab' | 'away') => void
}

const ITEMS = ':scope > [role="menuitem"]'
const itemsIn = (menu: HTMLElement | null) => [...(menu?.querySelectorAll<HTMLElement>(ITEMS) ?? [])]
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })
const Chevron = () => <svg {...ICON} className="popup-more"><path d="m9 6 6 6-6 6" /></svg>

/**
 * A menu drawn over the page at `anchor`, its first item focused. The arrow keys, Home and End move, Escape and Tab
 * close it, and a press or focus anywhere else closes it. An item with a submenu opens it beside the menu on hover,
 * click, Enter or ArrowRight, and ArrowLeft or Escape closes it back onto the item.
 */
export function PopupMenu<A extends string>({ label, groups, className, anchor, owns, onChoose, onClose }: PopupMenuProps<A>) {
  const ids = useId()
  const holder = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const sub = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<{ readonly id: A; readonly focus: boolean } | null>(null)
  const opened = open === null ? undefined : groups.flat().find(item => item.id === open.id)
  const staysFor = (target: EventTarget | null) => target instanceof Element && (holder.current?.contains(target) === true || owns(target))

  useLayoutEffect(() => {
    const drawn = menu.current
    if (drawn === null) return
    const { left, top } = placeMenu(anchor(), drawn.getBoundingClientRect(), viewport())
    drawn.style.left = `${left}px`
    drawn.style.top = `${top}px`
    itemsIn(drawn)[0]?.focus()
  }, [])

  useLayoutEffect(() => {
    const [drawn, item] = [sub.current, menu.current?.querySelector('[aria-expanded="true"]')]
    if (open === null || drawn === null || menu.current === null || item == null) return
    const first = itemsIn(drawn)[0]
    const box = drawn.getBoundingClientRect()
    const inset = (first?.getBoundingClientRect().top ?? box.top) - box.top
    const { left, top } = placeSubmenu(item.getBoundingClientRect(), menu.current.getBoundingClientRect(), box, viewport(), inset)
    drawn.style.left = `${left}px`
    drawn.style.top = `${top}px`
    if (open.focus) first?.focus()
  }, [open])

  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (!staysFor(event.target)) onClose('away')
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  })

  const closeSub = (focus: HTMLElement | null | undefined) => {
    // Focus leaves the submenu before it goes, or it would fall to the page and close the whole menu.
    if (sub.current?.contains(document.activeElement)) focus?.focus({ preventScroll: true })
    setOpen(null)
  }
  const onMenuKey = (event: KeyboardEvent) => {
    const items = itemsIn(menu.current)
    const at = items.indexOf(document.activeElement as HTMLElement)
    const item = groups.flat()[at]
    if (event.key === 'ArrowRight' && item?.submenu !== undefined) {
      event.preventDefault()
      event.stopPropagation()
      setOpen({ id: item.id, focus: true })
      return
    }
    const move = keyMove(event.key, at, items.length)
    if (move === null) return
    if (move.do !== 'tab') {
      event.preventDefault()
      event.stopPropagation()
    }
    if (move.do === 'step') {
      items[move.to]?.focus()
      setOpen(null)
    }
    if (move.do === 'escape' || move.do === 'tab') onClose(move.do)
  }
  const onSubKey = (event: KeyboardEvent) => {
    const parent = menu.current?.querySelector<HTMLElement>('[aria-expanded="true"]')
    if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeSub(parent)
      return
    }
    const choices = itemsIn(sub.current)
    const move = event.key === 'ArrowRight' ? { do: 'swallow' as const } : keyMove(event.key, choices.indexOf(document.activeElement as HTMLElement), choices.length)
    if (move === null) return
    if (move.do !== 'tab') {
      event.preventDefault()
      event.stopPropagation()
    }
    if (move.do === 'step') choices[move.to]?.focus()
    if (move.do === 'tab') onClose('tab')
  }
  const onBlur = (event: FocusEvent) => {
    if (!staysFor(event.relatedTarget)) onClose('away')
  }
  const onHover = (item: PopupItem<A>, element: HTMLElement) => {
    if (item.submenu !== undefined) {
      if (open?.id !== item.id) setOpen({ id: item.id, focus: false })
    } else if (open !== null) {
      closeSub(element)
    }
  }

  const choice = (item: PopupItem<A>, kind: 'item' | 'choice') => {
    const [hint, block] = [`${ids}-${item.id}`, `${ids}-${item.id}-block`]
    const described = [item.hint === undefined ? null : hint, item.block === undefined ? null : block].filter(id => id !== null).join(' ')
    return (
      <button
        key={item.id} type="button" role="menuitem" tabIndex={-1} title={item.block} aria-disabled={item.block !== undefined || undefined}
        aria-describedby={described === '' ? undefined : described}
        aria-haspopup={item.submenu === undefined ? undefined : 'menu'} aria-expanded={item.submenu === undefined ? undefined : open?.id === item.id}
        onClick={() => {
          if (item.block !== undefined) return
          if (item.submenu === undefined) onChoose(item.id)
          else setOpen({ id: item.id, focus: true })
        }}
        onPointerEnter={kind === 'item' ? event => onHover(item, event.currentTarget) : undefined}
      >
        {item.icon}
        {item.label}
        {item.hint !== undefined && <span className="popup-hint" id={hint} aria-hidden="true">{item.hint}</span>}
        {item.block !== undefined && <span className="sr" id={block} aria-hidden="true">{item.block}</span>}
        {item.submenu !== undefined && <Chevron />}
      </button>
    )
  }

  return (
    <div ref={holder} className="popup" onBlur={onBlur} onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}>
      <div ref={menu} className={`file-menu popup-menu ${className}`} role="menu" aria-label={label} onKeyDown={onMenuKey}>
        {groups.map((group, index) => (
          <Fragment key={group.map(item => item.id).join()}>
            {index > 0 && <div role="separator" />}
            {group.map(item => choice(item, 'item'))}
          </Fragment>
        ))}
      </div>
      {opened?.submenu !== undefined && (
        <div ref={sub} className={`file-menu popup-menu ${className}`} role="menu" aria-label={opened.label} onKeyDown={onSubKey}>
          {opened.submenu.map(item => choice(item, 'choice'))}
        </div>
      )}
    </div>
  )
}
