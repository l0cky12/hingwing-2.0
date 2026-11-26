import type { BotId } from '@highwing/hermes/domain'
import { Fragment, useEffect, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { anchorOf, keyMove, LABELS, MENUS, placeMenu, type Box, type MenuAction, type Opener } from './bot-menu'
import type { BotPlace } from './sidebar-view'

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
const BUBBLE = 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'
const PIN = 'M9 4h6l-1 6 3 3v2H7v-2l3-3z'

const ICONS: { readonly [A in MenuAction]: ReactNode } = {
  open: <svg {...icon}><path d={BUBBLE} /></svg>,
  new: <svg {...icon}><path d={BUBBLE} /><path d="M12 7v6M9 10h6" /></svg>,
  edit: <svg {...icon}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>,
  pin: <svg {...icon}><path d={PIN} /><path d="M12 15v6" /></svg>,
  unpin: <svg {...icon}><path d={PIN} /><path d="M12 15v6M3 3l18 18" /></svg>,
  hide: <svg {...icon}><path d="M10.7 5.1A10 10 0 0 1 12 5c7 0 10 7 10 7a13 13 0 0 1-1.7 2.7M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2M3 3l18 18" /></svg>,
  show: <svg {...icon}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  delete: <svg {...icon}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
}

export interface RowMenuProps {
  readonly bot: BotId
  readonly name: string
  readonly place: BotPlace
  readonly opener: Opener
  readonly measure: () => { readonly row: Box; readonly more: Box }
  readonly onChoose: (action: MenuAction) => void
  readonly onClose: (how: 'escape' | 'tab' | 'away') => void
}

export function RowMenu({ bot, name, place, opener, measure, onChoose, onClose }: RowMenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  const staysFor = (target: EventTarget | null) =>
    target instanceof Element && (menu.current?.contains(target) === true || target.closest('[data-more]')?.getAttribute('data-more') === bot)

  useLayoutEffect(() => {
    const drawn = menu.current
    if (drawn === null) return
    const { width, height } = drawn.getBoundingClientRect()
    const { left, top } = placeMenu(anchorOf(opener, place, measure()), { width, height }, { width: window.innerWidth, height: window.innerHeight })
    drawn.style.left = `${left}px`
    drawn.style.top = `${top}px`
    drawn.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [])

  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (!staysFor(event.target)) onClose('away')
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  })

  const onKeyDown = (event: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const move = keyMove(event.key, items.indexOf(document.activeElement as HTMLElement), items.length)
    if (move === null) return
    if (move.do !== 'tab') {
      event.preventDefault()
      event.stopPropagation()
    }
    if (move.do === 'step') items[move.to]?.focus()
    if (move.do === 'escape' || move.do === 'tab') onClose(move.do)
  }
  const onBlur = (event: FocusEvent) => {
    if (!staysFor(event.relatedTarget)) onClose('away')
  }

  return (
    <div ref={menu} className="file-menu bot-menu" role="menu" aria-label={`More for ${name}`} onKeyDown={onKeyDown} onBlur={onBlur} onContextMenu={event => event.preventDefault()}>
      {MENUS[place].map((group, at) => (
        <Fragment key={group.join()}>
          {at > 0 && <div role="separator" />}
          {group.map(action => (
            <button key={action} type="button" role="menuitem" tabIndex={-1} onClick={() => onChoose(action)}>{ICONS[action]}{LABELS[action]}</button>
          ))}
        </Fragment>
      ))}
    </div>
  )
}
