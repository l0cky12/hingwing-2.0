import type { Mode } from '../../ipc-contract'
import { usePickMenu } from '../chat/menu'

const LABELS: { readonly [M in Mode]: string } = { bots: 'Bots', chats: 'Chats' }
const MODES: readonly Mode[] = ['bots', 'chats']
const OTHER: { readonly [M in Mode]: Mode } = { bots: 'chats', chats: 'bots' }

export const Chevron = () => <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="m6 9 6 6 6-6" /></svg>
export const Check = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>

export function ModeSwitch({ mode, onPick }: { readonly mode: Mode; readonly onPick: (mode: Mode) => void }) {
  const { open, setOpen, close, holder, toggle, onKeyDown, menuProps } = usePickMenu()
  const pick = (next: Mode) => {
    close()
    if (next !== mode) onPick(next)
  }
  return (
    <div className="mode" ref={holder} onKeyDown={onKeyDown}>
      <h2>
        <button ref={toggle} type="button" className="mode-switch" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(shown => !shown)}>
          {LABELS[mode]}<Chevron />
        </button>
      </h2>
      {open && (
        <div {...menuProps} className="file-menu mode-menu" aria-label="Show">
          {MODES.map(item => (
            <button key={item} type="button" role="menuitemradio" aria-checked={item === mode} tabIndex={-1} onClick={() => pick(item)}>
              <span className="mode-check" aria-hidden="true">{item === mode && <Check />}</span>
              {LABELS[item]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ModeToggle({ mode, onPick }: { readonly mode: Mode; readonly onPick: (mode: Mode) => void }) {
  const next = OTHER[mode]
  const name = `Switch to ${LABELS[next]}`
  return (
    <button type="button" className="mode-toggle" aria-label={name} title={name} onClick={() => onPick(next)}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 7-5 5 5 5M15 7l5 5-5 5" /></svg>
    </button>
  )
}
