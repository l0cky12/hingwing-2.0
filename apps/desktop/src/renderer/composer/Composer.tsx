import type { CommandOutcome, SlashCatalog, SlashEntry } from '@highwing/hermes/domain'
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTopic } from '../store'
import { completionOf, menuOf, type Menu } from './slash-menu'

interface ComposerProps {
  readonly canSend: boolean
  readonly showStop: boolean
  readonly onSend: (text: string) => Promise<CommandOutcome<string | null>>
  readonly onStop: () => void
}

const NO_CATALOG: SlashCatalog = []
const MENU_ID = 'slash-menu'
const optionId = (index: number) => `slash-option-${index}`
const GROUPS = [
  { kind: 'command', label: 'Commands' },
  { kind: 'skill', label: 'Skills' }
] as const

export function Composer({ canSend, showStop, onSend, onStop }: ComposerProps) {
  const catalog = useTopic('slash') ?? NO_CATALOG
  const [draft, setDraft] = useState('')
  const [active, setActive] = useState(0)
  const [dismissedDraft, setDismissedDraft] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const caretToEnd = useRef(false)
  const menu = menuOf(draft, catalog, { active, dismissedDraft })

  const shownActive = menu.open ? menu.active : null
  useLayoutEffect(() => {
    if (shownActive !== null) document.getElementById(optionId(shownActive))?.scrollIntoView({ block: 'nearest' })
  }, [shownActive])

  useLayoutEffect(() => {
    const element = box.current
    if (!caretToEnd.current || element === null) return
    caretToEnd.current = false
    element.setSelectionRange(element.value.length, element.value.length)
  }, [draft])

  const edit = (next: string) => {
    setDraft(next)
    setActive(0)
    setDismissedDraft(null)
  }
  const pick = (entry: SlashEntry) => {
    caretToEnd.current = true
    edit(completionOf(entry))
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = draft.trim()
    if (!canSend || text === '') return
    setOutput(null)
    const outcome = await onSend(text)
    setRefusal(outcome.ok ? null : outcome.refusal.message)
    if (!outcome.ok) return
    setOutput(outcome.value)
    setDraft(held => (held.trim() === text ? '' : held))
  }

  const onMenuKey = (event: KeyboardEvent<HTMLTextAreaElement>, open: Extract<Menu, { open: true }>): boolean => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (step !== undefined) setActive(open.active + step)
    else if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') pick(open.matches[open.active] as SlashEntry)
    else if (event.key === 'Escape') setDismissedDraft(draft)
    else return false
    event.preventDefault()
    return true
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (menu.open && onMenuKey(event, menu)) return
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    void submit()
  }

  return (
    <footer className="composer">
      {menu.open && (
        <div className="slash-anchor">
          <div className="slash-menu" role="listbox" id={MENU_ID} aria-label="Commands and skills">
            {GROUPS.map(({ kind, label }) => {
              const rows = menu.matches.flatMap((entry, index) => (entry.kind === kind ? [{ entry, index }] : []))
              return rows.length === 0 ? null : (
                <div key={kind} role="group" aria-label={label}>
                  <p className="slash-group" aria-hidden="true">{label}</p>
                  {rows.map(({ entry, index }) => (
                    <div
                      key={entry.name} id={optionId(index)} role="option" aria-selected={index === menu.active}
                      className={index === menu.active ? 'slash-row active' : 'slash-row'}
                      onMouseDown={event => event.preventDefault()} onClick={() => pick(entry)}
                    >
                      <span className="slash-name">/{entry.name}</span>
                      <span className="slash-description">{entry.description}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
      <form onSubmit={submit}>
        <textarea
          ref={box} rows={2} placeholder="Ask Hermes to do something" aria-label="Message Hermes" value={draft}
          aria-autocomplete="list" aria-controls={menu.open ? MENU_ID : undefined}
          aria-activedescendant={menu.open ? optionId(menu.active) : undefined}
          onChange={event => edit(event.target.value)} onKeyDown={onKeyDown}
        />
        {showStop && <button type="button" className="stop" disabled={!canSend} onClick={onStop}>Stop</button>}
        <button type="submit" disabled={!canSend}>Send</button>
      </form>
      {refusal !== null && <p className="err refusal">{refusal}</p>}
      {output !== null && <pre className="slash-output" role="status" aria-label="Command output">{output}</pre>}
    </footer>
  )
}
