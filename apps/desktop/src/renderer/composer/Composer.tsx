import type { Attachment, AttachmentId, CommandOutcome, PathMatch, SendPlan, SessionId, SlashCatalog } from '@highwing/hermes/domain'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { MAX_ATTACHMENTS, type StageResult } from '../../ipc-contract'
import { Avatar } from '../bots/Avatar'
import { Chips } from '../chat/Attachments'
import { useTopic } from '../store'
import { busyHint } from './busy'
import { attachTo, detach, draftSent, moveAttachment, moveDraft, seedDraft, stagingFor, useAttachments, useDraft, useStaging, writeDraft, type DraftSlot } from './drafts'
import { EDITING_WORDS, type Editing } from './edit'
import { RemoveDialog } from './RemoveDialog'
import { mentionable, mentionWord, menuOf, picked, type Menu, type MenuItem } from './menu'
import { usePathFiles } from './paths'

interface ComposerProps {
  readonly slot: DraftSlot
  readonly inputRef?: RefObject<HTMLTextAreaElement | null>
  readonly autoFocus?: boolean
  readonly seed?: string
  /** The chat's session, once it has one. `@` completes paths in its working folder. */
  readonly sessionId?: SessionId | null
  /** The chat's working folder, as Hermes names it. */
  readonly cwd?: string | null
  readonly canSend: boolean
  /** Whether files can be added now. False while the link is down. */
  readonly canAttach: boolean
  readonly showStop: boolean
  /** `attachments` go with the message, in order. */
  readonly onSend: (text: string, attachments: readonly AttachmentId[]) => Promise<CommandOutcome<string | null>>
  readonly onStop: () => void
  readonly onInput: () => void
  readonly plan?: SendPlan['by']
  readonly editing?: Editing | null
  readonly onCancelEdit?: () => void
  readonly above?: ReactNode
  readonly onEscape?: () => boolean
  readonly children?: ReactNode
}

const NO_CATALOG: SlashCatalog = []
const HINT_ID = 'composer-busy'
const MENU_ID = 'composer-menu'
const optionId = (index: number) => `composer-option-${index}`
const keyOf = (item: MenuItem) => {
  switch (item.kind) {
    case 'bot': return item.bot.id
    case 'file': return `file:${item.match.path}`
    default: return item.entry.name
  }
}

function placeOf({ path }: PathMatch): { readonly name: string; readonly where: string } {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const cut = trimmed.lastIndexOf('/') + 1
  return { name: path.slice(cut), where: `./${path.slice(0, cut)}` }
}

interface OptionProps {
  readonly item: MenuItem
  readonly index: number
  readonly active: boolean
  readonly onPick: (item: MenuItem) => void
}

function Option({ item, index, active, onPick }: OptionProps) {
  const id = optionId(index)
  const row = { id, role: 'option', 'aria-selected': active, onMouseDown: (event: { preventDefault(): void }) => event.preventDefault(), onClick: () => onPick(item) } as const
  if (item.kind === 'file') {
    const { name, where } = placeOf(item.match)
    return (
      <div {...row} className={`slash-row${active ? ' active' : ''}${item.current ? '' : ' stale'}`} aria-label={item.match.path} aria-disabled={!item.current}>
        <span className="slash-name">{name}</span>
        <span className="slash-description">{where}</span>
      </div>
    )
  }
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

/** Hermes takes at most 10 attachments on a submit, and only images go there: a file goes as a reference in the text. */
const IMAGES_PER_MESSAGE = 10

/** What a batch of staged files adds to the attachments already held, and the words for each one left out. */
export function admitted(results: readonly StageResult[], held: readonly Attachment[]): { readonly added: readonly Attachment[]; readonly refused: readonly string[] } {
  let images = held.filter(attachment => attachment.kind === 'image').length
  const added: Attachment[] = []
  const refused: string[] = []
  for (const result of results) {
    if (!result.ok) refused.push(result.reason)
    else if (held.length + added.length >= MAX_ATTACHMENTS) refused.push(`A message holds up to ${MAX_ATTACHMENTS} attachments, so ${result.attachment.name} wasn't attached.`)
    else if (result.attachment.kind === 'image' && images >= IMAGES_PER_MESSAGE) refused.push(`Hermes takes up to ${IMAGES_PER_MESSAGE} images in one message, so ${result.attachment.name} wasn't attached.`)
    else {
      if (result.attachment.kind === 'image') images++
      added.push(result.attachment)
    }
  }
  return { added, refused }
}

const draggingFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true

export function Composer({ slot, inputRef, autoFocus, seed = '', sessionId = null, cwd = null, canSend, canAttach, showStop, onSend, onStop, onInput, plan = 'submit', editing = null, onCancelEdit, above, onEscape, children }: ComposerProps) {
  const catalog = useTopic('slash') ?? NO_CATALOG
  const roster = useTopic('bots')
  const relay = useTopic('relay')
  const own = useTopic('open')?.shown?.bot ?? null
  const draft = useDraft(slot)
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const files = usePathFiles(sessionId, focused ? mentionWord(draft, caret) : null)
  const sources = useMemo(() => ({ catalog, bots: mentionable(roster, relay, own), files }), [catalog, roster, relay, own, files])
  const attachments = useAttachments(slot)
  const [attachRefusals, setAttachRefusals] = useState<readonly string[]>([])
  const [dragging, setDragging] = useState(false)
  const staging = useStaging(slot)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const press = editing?.press ?? null
  const sending = useRef(false)
  const ownBox = useRef<HTMLTextAreaElement>(null)
  const box = inputRef ?? ownBox
  const caretTo = useRef<number | null>(null)
  const typed = menuOf(draft, caret, sources, { active, dismissed })
  const menu = focused ? typed : { open: false as const }
  const hint = busyHint(plan, draft, catalog)

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

  // The box may end up holding a saved draft rather than the seed, and only once the saved drafts load.
  const caretAtEnd = useRef(false)
  useLayoutEffect(() => {
    if (seed === '' || slot === null) return
    caretAtEnd.current = true
    seedDraft(slot, seed)
  }, [])
  useLayoutEffect(() => {
    if (!caretAtEnd.current || draft === '') return
    caretAtEnd.current = false
    box.current?.setSelectionRange(draft.length, draft.length)
    setCaret(draft.length)
  }, [draft, box])

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

  const shownSlot = useRef(slot)
  shownSlot.current = slot
  const latestAttachments = useRef(attachments)
  latestAttachments.current = attachments
  const take = async (pending: Promise<readonly StageResult[]>) => {
    const results = await stagingFor(slot, pending)
    if (results.length === 0) return
    const { added, refused } = admitted(results, latestAttachments.current)
    attachTo(slot, added)
    setAttachRefusals(refused)
  }
  const latestTake = useRef(take)
  latestTake.current = take

  useEffect(() => {
    let depth = 0
    const enter = (event: DragEvent) => {
      if (!draggingFiles(event)) return
      depth++
      setDragging(true)
    }
    const leave = (event: DragEvent) => {
      if (!draggingFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    // Every file drag is claimed, so a drop anywhere never navigates the window to the file.
    const over = (event: DragEvent) => {
      if (!draggingFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = canAttach ? 'copy' : 'none'
    }
    const drop = (event: DragEvent) => {
      if (!draggingFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      if (canAttach && event.dataTransfer !== null) void latestTake.current(window.highwing.attachDropped([...event.dataTransfer.files]))
    }
    const handlers = { dragenter: enter, dragleave: leave, dragover: over, drop }
    for (const [type, handler] of Object.entries(handlers)) window.addEventListener(type, handler as EventListener)
    return () => {
      for (const [type, handler] of Object.entries(handlers)) window.removeEventListener(type, handler as EventListener)
    }
  }, [canAttach])

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const { items, types } = event.clipboardData
    if (types.includes('text/plain') || ![...items].some(item => item.kind === 'file' && item.type.startsWith('image/'))) return
    event.preventDefault()
    if (canAttach) void take(window.highwing.attachPaste())
  }

  const remove = (id: AttachmentId) => {
    detach(slot, id)
    box.current?.focus()
  }

  const edit = (next: string, at: number) => {
    writeDraft(slot, next)
    setCaret(at)
    setActive(0)
    setDismissed(null)
    onInput()
  }
  const pick = (open: Extract<Menu, { open: true }>, item: MenuItem) => {
    if (item.kind === 'file' && !item.current) return
    const next = picked(draft, open.range, item)
    caretTo.current = next.caret
    edit(next.text, next.caret)
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSend || sending.current || staging > 0 || draft.trim() === '') return
    if (editing?.kind === 'sent' && editing.later > 0) setConfirming(true)
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
    if (!canSend || sending.current || staging > 0 || text === '') return
    sending.current = true
    setPending(true)
    setOutput(null)
    const sent = editing === null ? attachments.map(attachment => attachment.id) : []
    const outcome = await onSend(text, sent).finally(() => {
      sending.current = false
      setPending(false)
    })
    setRefusal(outcome.ok ? null : outcome.refusal.message)
    if (!outcome.ok) {
      // A first message makes its chat before Hermes can refuse it, and the window has moved to that chat.
      moveDraft(slot, shownSlot.current)
      return
    }
    setOutput(outcome.value)
    setAttachRefusals([])
    draftSent(slot, text, new Set(sent))
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
  // The model and context popovers and the remove dialog sit in this footer too, and close on their own Escape.
  const onFooterKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return
    if (!(event.target instanceof Element) || event.target.closest('form, .sides') === null) return
    if (onEscape?.() !== true) return
    event.preventDefault()
    box.current?.focus()
  }

  return (
    <footer className={dragging && canAttach ? 'composer dragging' : 'composer'} onKeyDown={onFooterKeyDown}>
      {above}
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
          {cwd !== null && menu.sections.some(section => section.label === 'Files') && <p className="slash-folder">in {cwd}</p>}
        </div>
      )}
      {editing !== null && (
        <div className="editing">
          <span>{editing.kind === 'gone' ? editing.why : EDITING_WORDS[editing.kind]}</span>
          <button type="button" onClick={cancelEdit}>Cancel</button>
        </div>
      )}
      <Chips attachments={attachments} onRemove={remove} onMove={(id, by) => moveAttachment(slot, id, by)} />
      {attachRefusals.length > 0 && (
        <ul className="err attach-refused" aria-label="Not attached">
          {attachRefusals.map((reason, index) => <li key={index}>{reason}</li>)}
        </ul>
      )}
      {dragging && canAttach && <p className="drop-line" role="status">Drop to attach</p>}
      <form onSubmit={submit}>
        <button type="button" className="clip" aria-label="Attach files" disabled={!canAttach} onClick={() => void take(window.highwing.attachPick())}>
          <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
            <path d="M10.5 4.5 5.4 9.6a1.6 1.6 0 0 0 2.3 2.3l5.4-5.4a3 3 0 0 0-4.3-4.3L3.4 7.6a4.4 4.4 0 0 0 6.2 6.2l4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <textarea
          ref={box} autoFocus={autoFocus} rows={1} placeholder="Ask Hermes to do something" aria-label="Message Hermes" value={draft}
          aria-autocomplete="list" aria-controls={menu.open ? MENU_ID : undefined}
          aria-activedescendant={menu.open ? optionId(menu.active) : undefined} aria-describedby={hint === null ? undefined : HINT_ID}
          onChange={event => edit(event.target.value, event.target.selectionStart)} onKeyDown={onKeyDown} onPaste={onPaste}
          onSelect={event => setCaret(event.currentTarget.selectionStart)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        />
        {showStop && <button type="button" className="stop" disabled={!canSend} onClick={onStop}>Stop</button>}
        <button type="submit" disabled={!canSend || pending || staging > 0}>Send</button>
      </form>
      {hint !== null && <p className="busy" id={HINT_ID}>{hint}</p>}
      {children}
      {refusal !== null && <p className="err refusal">{refusal}</p>}
      {confirming && editing?.kind === 'sent' && (
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
