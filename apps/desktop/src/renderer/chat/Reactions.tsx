import type { Reaction } from '@highwing/hermes/domain'
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { ICON } from '../chrome/PopupMenu'
import { usePopover } from '../composer/popover'

export const QUICK_REACTIONS = [
  { emoji: '❤️', name: 'Heart' },
  { emoji: '👍', name: 'Thumbs up' },
  { emoji: '👎', name: 'Thumbs down' },
  { emoji: '😂', name: 'Laughing' },
  { emoji: '‼️', name: 'Exclamation' },
  { emoji: '❓', name: 'Question' }
] as const

const next = (at: number, count: number) => (at + 1) % count
const previous = (at: number, count: number) => (at - 1 + count) % count
const MOVES: Readonly<Record<string, (at: number, count: number) => number>> = {
  ArrowRight: next, ArrowDown: next, ArrowLeft: previous, ArrowUp: previous, Home: () => 0, End: (_at, count) => count - 1
}

interface ReactionsProps {
  readonly given: readonly Reaction[]
  readonly disabled: boolean
  /** `null` takes your reaction off. Each author has one at most, so a new emoji replaces yours. */
  readonly onReact: (emoji: string | null) => void
}

export function Given({ given, disabled, onReact }: ReactionsProps) {
  return given.map(({ emoji, by }) => (by === 'user'
    ? <button key={`${by}${emoji}`} type="button" className="reaction" aria-label={`Remove your ${emoji}`} disabled={disabled} onClick={() => onReact(null)}>{emoji}</button>
    : <span key={`${by}${emoji}`} className="reaction" role="img" aria-label={`Hermes reacted ${emoji}`}>{emoji}</span>))
}

export function Reactions({ given, disabled, onReact }: ReactionsProps) {
  const { shown, setOpen, anchor, button } = usePopover(!disabled)
  const picker = useRef<HTMLDivElement>(null)
  const mine = given.find(reaction => reaction.by === 'user')?.emoji ?? null

  useLayoutEffect(() => {
    const held = picker.current
    if (held !== null) (held.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? held.querySelector('button'))?.focus()
  }, [shown])

  const pick = (emoji: string) => {
    setOpen(false)
    button.current?.focus()
    onReact(emoji === mine ? null : emoji)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = MOVES[event.key]
    if (move === undefined) return
    event.preventDefault()
    const buttons = [...event.currentTarget.querySelectorAll('button')]
    buttons[move(Math.max(buttons.indexOf(document.activeElement as HTMLButtonElement), 0), buttons.length)]?.focus()
  }

  return (
    <div className="react" ref={anchor}>
      <button ref={button} type="button" className="copy icon" aria-label="React" title="React" aria-haspopup="dialog" aria-expanded={shown} disabled={disabled} onClick={() => setOpen(!shown)}>
        <svg {...ICON}><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01M15 9h.01" /></svg>
      </button>
      {shown && (
        <div ref={picker} className="react-pick" role="dialog" aria-label="Reactions" onKeyDown={onKeyDown}>
          {QUICK_REACTIONS.map(({ emoji, name }) => (
            <button key={emoji} type="button" aria-label={name} aria-pressed={emoji === mine} onClick={() => pick(emoji)}>{emoji}</button>
          ))}
        </div>
      )}
    </div>
  )
}
