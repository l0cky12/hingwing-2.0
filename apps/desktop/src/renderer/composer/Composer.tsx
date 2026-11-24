import type { CommandOutcome, SlashCatalog, SlashEntry } from '@highwing/hermes/domain'
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { useTopic } from '../store'
import type { Editing } from './edit'
import { RemoveDialog } from './RemoveDialog'
import { completionOf, menuOf, type Menu } from './slash-menu'

interface ComposerProps {
  readonly inputRef?: RefObject<HTMLTextAreaElement | null>
  readonly autoFocus?: boolean
  readonly canSend: boolean
  readonly showStop: boolean
  readonly onSend: (text: string) => Promise<CommandOutcome<string | null>>
  readonly onStop: () => void
  readonly onInput: () => void
  readonly editing?: Editing | null
  readonly onCancelEdit?: () => void
  readonly children?: ReactNode
}

const NO_CATALOG: SlashCatalog = []
const MENU_ID = 'slash-menu'
const optionId = (index: number) => `slash-option-${index}`
const GROUPS = [
  { kind: 'command', label: 'Commands' },
  { kind: 'skill', label: 'Skills' }
] as const

export function Composer({ inputRef, autoFocus, canSend, showStop, onSend, onStop, onInput, editing = null, onCancelEdit, children }: ComposerProps) {
  const catalog = useTopic('slash') ?? NO_CATALOG
  const [draft, setDraft] = useState('')
  const [active, setActive] = useState(0)
  const [dismissedDraft, setDismissedDraft] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [focused, setFocused] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const press = editing?.press ?? null
  const sending = useRef(false)
  const ownBox = useRef<HTMLTextAreaElement>(null)
  const box = inputRef ?? ownBox
  const caretToEnd = useRef(false)
  const typed = menuOf(draft, catalog, { active, dismissedDraft })
  const menu = focused ? typed : { open: false as const }

  const shownActive = menu.open ? menu.active : null
  useLayoutEffect(() => {
    if (shownActive !== null) document.getElementById(optionId(shownActive))?.scrollIntoView({ block: 'nearest' })
  }, [shownActive])

  useLayoutEffect(() => {
    const element = box.current
    if (!caretToEnd.current || element === null) return
    caretToEnd.current = false
    element.setSelectionRange(element.value.length, element.value.length)
  }, [draft, press])

  const wasConfirming = useRef(false)
  useLayoutEffect(() => {
    if (wasConfirming.current && !confirming) box.current?.focus()
    wasConfirming.current = confirming
  }, [confirming, box])

  useLayoutEffect(() => {
    if (editing === null) return
    caretToEnd.current = true
    setDraft(editing.text)
    setRefusal(null)
    setConfirming(false)
    box.current?.focus()
  }, [press, box])

  const edit = (next: string) => {
    setDraft(next)
    setActive(0)
    setDismissedDraft(null)
    onInput()
  }
  const pick = (entry: SlashEntry) => {
    caretToEnd.current = true
    edit(completionOf(entry))
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSend || sending.current || draft.trim() === '') return
    if (editing !== null && editing.later > 0) setConfirming(true)
    else void deliver()
  }

  const cancelEdit = () => {
    setDraft('')
    setConfirming(false)
    onCancelEdit?.()
    box.current?.focus()
  }

  const deliver = async () => {
    setConfirming(false)
    const text = draft.trim()
    if (!canSend || sending.current || text === '') return
    sending.current = true
    setPending(true)
    setOutput(null)
    const outcome = await onSend(text).finally(() => {
      sending.current = false
      setPending(false)
    })
    setRefusal(outcome.ok ? null : outcome.refusal.message)
    if (!outcome.ok) return
    setOutput(outcome.value)
    setDraft(held => (held.trim() === text ? '' : held))
  }

  const onMenuKey = (event: KeyboardEvent<HTMLTextAreaElement>, open: Extract<Menu, { open: true }>): boolean => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (step !== undefined) setActive(open.active + step)
    else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) pick(open.matches[open.active] as SlashEntry)
    else if (event.key === 'Escape') setDismissedDraft(draft)
    else return false
    event.preventDefault()
    return true
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (menu.open && onMenuKey(event, menu)) return
    if (event.key === 'Escape' && editing !== null) {
      event.preventDefault()
      cancelEdit()
      return
    }
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
      {editing !== null && (
        <div className="editing">
          <span>Editing a sent message</span>
          <button type="button" onClick={cancelEdit}>Cancel</button>
        </div>
      )}
      <form onSubmit={submit}>
        <textarea
          ref={box} autoFocus={autoFocus} rows={1} placeholder="Ask Hermes to do something" aria-label="Message Hermes" value={draft}
          aria-autocomplete="list" aria-controls={menu.open ? MENU_ID : undefined}
          aria-activedescendant={menu.open ? optionId(menu.active) : undefined}
          onChange={event => edit(event.target.value)} onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        />
        {showStop && <button type="button" className="stop" disabled={!canSend} onClick={onStop}>Stop</button>}
        <button type="submit" disabled={!canSend || pending}>Send</button>
      </form>
      {children}
      {refusal !== null && <p className="err refusal">{refusal}</p>}
      {confirming && editing !== null && (
        <RemoveDialog
          later={editing.later}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void deliver()}
        />
      )}
      <pre className="slash-output" role="status" aria-label="Command output" aria-busy={pending}>{output}</pre>
    </footer>
  )
}
