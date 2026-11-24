import type { CommandOutcome, SlashCatalog } from '@highwing/hermes/domain'
import { useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Avatar } from '../bots/Bots'
import { useTopic } from '../store'
import { draftSent, seedDraft, useDraft, writeDraft, type DraftSlot } from './drafts'
import type { Editing } from './edit'
import { RemoveDialog } from './RemoveDialog'
import { mentionable, menuOf, picked, type Menu, type MenuItem } from './menu'

interface ComposerProps {
  readonly slot: DraftSlot
  readonly inputRef?: RefObject<HTMLTextAreaElement | null>
  readonly autoFocus?: boolean
  /** What the box starts with. Read once, when the pane is made. */
  readonly seed?: string
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
const MENU_ID = 'composer-menu'
const optionId = (index: number) => `composer-option-${index}`
const keyOf = (item: MenuItem) => (item.kind === 'bot' ? item.bot.id : item.entry.name)

interface OptionProps {
  readonly item: MenuItem
  readonly index: number
  readonly active: boolean
  readonly onPick: (item: MenuItem) => void
}

function Option({ item, index, active, onPick }: OptionProps) {
  const id = optionId(index)
  const row = { id, role: 'option', 'aria-selected': active, onMouseDown: (event: { preventDefault(): void }) => event.preventDefault(), onClick: () => onPick(item) } as const
  if (item.kind !== 'bot') {
    return (
      <div {...row} className={active ? 'slash-row active' : 'slash-row'}>
        <span className="slash-name">/{item.entry.name}</span>
        <span className="slash-description">{item.entry.description}</span>
      </div>
    )
  }
  const { name, description } = item.bot
  return (
    <div {...row} className={active ? 'slash-row bot active' : 'slash-row bot'} aria-label={name} aria-describedby={description === null ? undefined : `${id}-about`}>
      <Avatar bot={item.bot} size={22} />
      <span className="slash-bot">{name}</span>
      {description !== null && <span className="slash-description" id={`${id}-about`}>{description}</span>}
    </div>
  )
}

export function Composer({ slot, inputRef, autoFocus, seed = '', canSend, showStop, onSend, onStop, onInput, editing = null, onCancelEdit, children }: ComposerProps) {
  const catalog = useTopic('slash') ?? NO_CATALOG
  const roster = useTopic('bots')
  const relay = useTopic('relay')
  const own = useTopic('open')?.shown?.bot ?? null
  const sources = useMemo(() => ({ catalog, bots: mentionable(roster, relay, own) }), [catalog, roster, relay, own])
  const draft = useDraft(slot)
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [focused, setFocused] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const press = editing?.press ?? null
  const sending = useRef(false)
  const ownBox = useRef<HTMLTextAreaElement>(null)
  const box = inputRef ?? ownBox
  const caretTo = useRef<number | null>(null)
  const typed = menuOf(draft, caret, sources, { active, dismissed })
  const menu = focused ? typed : { open: false as const }

  const shownActive = menu.open ? menu.active : null
  useLayoutEffect(() => {
    if (shownActive !== null) document.getElementById(optionId(shownActive))?.scrollIntoView({ block: 'nearest' })
  }, [shownActive])

  useLayoutEffect(() => {
    const element = box.current
    if (caretTo.current === null || element === null) return
    element.setSelectionRange(caretTo.current, caretTo.current)
    caretTo.current = null
  }, [draft, caret, press])

  useLayoutEffect(() => {
    if (seed === '' || slot === null) return
    caretTo.current = seed.length
    setCaret(seed.length)
    seedDraft(slot, seed)
  }, [])

  const wasConfirming = useRef(false)
  useLayoutEffect(() => {
    if (wasConfirming.current && !confirming) box.current?.focus()
    wasConfirming.current = confirming
  }, [confirming, box])

  useLayoutEffect(() => {
    if (editing === null) return
    caretTo.current = editing.text.length
    writeDraft(slot, editing.text)
    setCaret(editing.text.length)
    setRefusal(null)
    setConfirming(false)
    box.current?.focus()
  }, [press, box])

  const edit = (next: string, at: number) => {
    writeDraft(slot, next)
    setCaret(at)
    setActive(0)
    setDismissed(null)
    onInput()
  }
  const pick = (open: Extract<Menu, { open: true }>, item: MenuItem) => {
    const next = picked(draft, open.range, item)
    caretTo.current = next.caret
    edit(next.text, next.caret)
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSend || sending.current || draft.trim() === '') return
    if (editing !== null && editing.later > 0) setConfirming(true)
    else void deliver()
  }

  const cancelEdit = () => {
    writeDraft(slot, '')
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
    draftSent(slot, text)
  }

  const onMenuKey = (event: KeyboardEvent<HTMLTextAreaElement>, open: Extract<Menu, { open: true }>): boolean => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (step !== undefined) setActive(open.active + step)
    else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) pick(open, open.items[open.active] as MenuItem)
    else if (event.key === 'Escape') setDismissed(draft)
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
          <div className="slash-menu" role="listbox" id={MENU_ID} aria-label={menu.label}>
            {menu.sections.map(({ label, items }) => (
              <div key={label} role="group" aria-label={label}>
                <p className="slash-group" aria-hidden="true">{label}</p>
                {items.map(item => {
                  const index = menu.items.indexOf(item)
                  return <Option key={keyOf(item)} item={item} index={index} active={index === menu.active} onPick={chosen => pick(menu, chosen)} />
                })}
              </div>
            ))}
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
          onChange={event => edit(event.target.value, event.target.selectionStart)} onKeyDown={onKeyDown}
          onSelect={event => setCaret(event.currentTarget.selectionStart)}
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
