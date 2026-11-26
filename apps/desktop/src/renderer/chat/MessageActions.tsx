import type { Reaction } from '@highwing/hermes/domain'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ICON, PopupMenu, type PopupItem } from '../chrome/PopupMenu'
import { anchorAt } from '../chrome/popup-menu'
import { useCopy } from './Copy'
import { Reactions } from './Reactions'

export interface Act { readonly disabled: boolean; readonly run: () => void }

/** The actions a message has. `MessageActions` owns their order and which sit in the More menu. */
export interface MessageActs {
  readonly copy?: { readonly text: string; readonly name: string }
  readonly edit?: Act
  readonly regenerate?: Act
  readonly react?: { readonly given: readonly Reaction[]; readonly disabled: boolean; readonly onReact: (emoji: string | null) => void }
  readonly branch?: Act
}

const Svg = ({ children }: { readonly children: ReactNode }) => <svg {...ICON}>{children}</svg>

function ActButton({ name, icon, act }: { readonly name: string; readonly icon: ReactNode; readonly act: Act }) {
  return <button type="button" className="copy icon" aria-label={name} title={name} disabled={act.disabled} onClick={act.run}>{icon}</button>
}

function CopyIcon({ text, name }: { readonly text: string; readonly name: string }) {
  const { said, copy } = useCopy()
  return (
    <>
      <button type="button" className={said === null ? 'copy icon' : 'copy icon shown'} aria-label={name} title={name} onClick={() => copy(text)}>
        {said === null
          ? <Svg><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></Svg>
          : <><Svg><path d="M20 6 9 17l-5-5" /></Svg>{said}</>}
      </button>
      <span className="sr" aria-live="polite">{said ?? ''}</span>
    </>
  )
}

const ICON_ROW: readonly ((acts: MessageActs) => ReactNode)[] = [
  ({ copy }) => copy && <CopyIcon key="copy" {...copy} />,
  ({ edit }) => edit && <ActButton key="edit" name="Edit message" act={edit} icon={<Svg><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></Svg>} />,
  ({ regenerate }) => regenerate && <ActButton key="regenerate" name="Regenerate" act={regenerate} icon={<Svg><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></Svg>} />,
  ({ react }) => react && <Reactions key="react" {...react} />
]

const MORE_ROW = [{ id: 'branch', label: 'Branch from here' }] as const

export function hasActs(acts: MessageActs): boolean {
  return Object.values(acts).some(act => act !== undefined)
}

function More({ items }: { readonly items: readonly { readonly label: string; readonly act: Act }[] }) {
  const [open, setOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const top = toggle.current?.getBoundingClientRect().top
    // A scroll event lands a frame after the scroll, so one from before the menu opened arrives after it.
    const close = () => { if (toggle.current?.getBoundingClientRect().top !== top) setOpen(false) }
    document.addEventListener('scroll', close, true)
    return () => document.removeEventListener('scroll', close, true)
  }, [open])
  const enabled = items.filter(item => !item.act.disabled)
  const groups: readonly (readonly PopupItem<string>[])[] = [enabled.map(item => ({ id: item.label, label: item.label }))]
  return (
    <>
      <button
        ref={toggle} type="button" className="copy icon" aria-label="More actions" title="More actions" aria-haspopup="menu" aria-expanded={open}
        disabled={enabled.length === 0} onClick={() => setOpen(!open)}
      >
        <Svg><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></Svg>
      </button>
      {open && (
        <PopupMenu
          label="More actions" className="message-menu" groups={groups}
          anchor={() => {
            const box = toggle.current?.getBoundingClientRect() ?? { left: 0, top: 0, right: 0, bottom: 0 }
            return anchorAt({ by: 'more' }, box, box.right)
          }}
          owns={target => toggle.current?.contains(target) === true}
          onChoose={label => { setOpen(false); items.find(item => item.label === label)?.act.run() }}
          onClose={how => { if (how !== 'away') toggle.current?.focus({ preventScroll: true }); setOpen(false) }}
        />
      )}
    </>
  )
}

export function MessageActions({ acts }: { readonly acts: MessageActs }) {
  if (!hasActs(acts)) return null
  const more = MORE_ROW.flatMap(({ id, label }) => { const act = acts[id]; return act === undefined ? [] : [{ label, act }] })
  return (
    <span className="acts">
      {ICON_ROW.map(draw => draw(acts))}
      {more.length > 0 && <More items={more} />}
    </span>
  )
}
