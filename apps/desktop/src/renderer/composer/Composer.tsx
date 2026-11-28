import { quoteOf, shownChat, slashLineOf, withQuote, type Attachment, type AttachmentId, type CommandOutcome, type PathMatch, type SendPlan, type SessionId, type SlashCatalog } from '@highwing/hermes/domain'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { MAX_ATTACHMENTS, type StageResult } from '../../ipc-contract'
import { Avatar } from '../bots/Avatar'
import { botIn } from '../bots/roster-view'
import { Chips } from '../chat/Attachments'
import { COMMAND_KEY, isShortcut, SEND_KEY_LABEL, sendsMessage } from '../keys'
import { useTopic } from '../store'
import { busyHint } from './busy'
import { inserted } from './dictation'
import { Microphone, useDictation } from './Dictate'
import { attachTo, detach, draftSent, moveAttachment, moveDraft, quoteInto, seedDraft, stagingFor, useAttachments, useDraft, useQuote, useStaging, writeDraft, type DraftSlot } from './drafts'
import { EDITING_WORDS, removalWords, type Editing } from './edit'
import { RemoveDialog } from './RemoveDialog'
import { mentionable, mentionWord, menuOf, picked, type Mention, type Menu, type MenuItem } from './menu'
import { usePathFiles } from './paths'

export interface ComposerGroup {
  readonly name: string
  readonly mentions: readonly Mention[]
  readonly warning: string | null
}

interface ComposerProps {
  readonly slot: DraftSlot
  readonly group?: ComposerGroup
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
  /** How a send holding these attachments would reach Hermes now. */
  readonly planFor?: (attachments: readonly Attachment[]) => SendPlan['by']
  readonly editing?: Editing | null
  readonly onCancelEdit?: () => void
  readonly above?: ReactNode
  readonly onEscape?: () => boolean
  readonly stack?: ReactNode
  /** Controls at the left of the row under the pill. */
  readonly start?: ReactNode
  /** Controls at the right of the row under the pill. */
  readonly end?: ReactNode
  /** What renders under the card. */
  readonly children?: ReactNode
}

const NO_CATALOG: SlashCatalog = []
const NO_FILES = { word: null, matches: [] } as const
const SUBMIT_ALWAYS = (): SendPlan['by'] => 'submit'
const FORM_ID = 'composer-form'
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

export function Composer({ slot, group, inputRef, autoFocus, seed = '', sessionId = null, cwd = null, canSend, canAttach, showStop, onSend, onStop, onInput, planFor = SUBMIT_ALWAYS, editing = null, onCancelEdit, above, onEscape, stack, start, end, children }: ComposerProps) {
  const catalog = useTopic('slash') ?? NO_CATALOG
  const roster = useTopic('bots')
  const sendKey = useTopic('sendKey') ?? 'enter'
  const relay = useTopic('relay')
  const open = useTopic('open')
  const own = shownChat(open)?.bot ?? null
  const ownBot = own === null ? null : botIn(roster, own)
  const draft = useDraft(slot)
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const files = usePathFiles(sessionId, focused ? mentionWord(draft, caret) : null)
  const sources = useMemo(
    () => (group === undefined ? { catalog, bots: mentionable(roster, relay, own), files } : { catalog: NO_CATALOG, bots: group.mentions, files: NO_FILES }),
    [group, catalog, roster, relay, own, files]
  )
  const attachments = useAttachments(slot)
  const draftQuote = useQuote(slot)
  const quote = group === undefined ? draftQuote : null
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
  const hint = group === undefined ? busyHint(planFor(attachments), draft, catalog, editing) : group.warning
  const blocked = !canSend || pending || staging > 0

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
    const { quote, body } = quoteOf(editing.text)
    caretTo.current = body.length
    writeDraft(slot, body)
    quoteInto(slot, quote)
    setCaret(body.length)
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

  const dictated = (words: string) => {
    const element = box.current
    const next = inserted(draft, element?.selectionStart ?? draft.length, element?.selectionEnd ?? draft.length, words)
    caretTo.current = next.caret
    edit(next.text, next.caret)
    element?.focus()
  }
  const [dictation, dictate] = useDictation(dictated)
  /** Set by the Ctrl/Cmd+D that pressed, so only its own keyup can end a push to talk. */
  const dictateKeyDown = useRef(false)
  const slotKey = slot?.key ?? null
  useEffect(() => dictate({ do: 'cancel' }), [slotKey, canAttach, dictate])

  const remove = (id: AttachmentId) => {
    detach(slot, id)
    box.current?.focus()
  }

  const unquote = () => {
    quoteInto(slot, null)
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
    quoteInto(slot, null)
    setConfirming(false)
    onCancelEdit?.()
    box.current?.focus()
  }

  const deliver = async () => {
    setConfirming(false)
    const text = draft.trim()
    if (!canSend || sending.current || staging > 0 || text === '') return
    sending.current = true
    // Send disables itself while the message is on its way, so a focused Send would drop focus to the page.
    box.current?.focus()
    setPending(true)
    setOutput(null)
    const sent = editing === null ? attachments.map(attachment => attachment.id) : []
    const command = slashLineOf(text, catalog) !== null
    const sentQuote = command ? null : quote
    const outcome = await onSend(withQuote(sentQuote, text), sent).finally(() => {
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
    draftSent(slot, text, new Set(sent), sentQuote)
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
    if (group === undefined && isShortcut(event.nativeEvent, 'dictate')) {
      event.preventDefault()
      if (event.repeat || !canAttach) return
      dictateKeyDown.current = true
      dictate({ do: 'press', at: performance.now() })
      return
    }
    const sendChord = sendKey === 'modEnter' && sendsMessage(event, sendKey)
    if (menu.open && !sendChord && onMenuKey(event, menu)) return
    if (event.key === 'Escape' && editing !== null) {
      event.preventDefault()
      cancelEdit()
      return
    }
    if (!sendsMessage(event, sendKey)) return
    event.preventDefault()
    void submit()
  }
  // macOS sends no keyup for D while Cmd is down, so letting go of Cmd ends a push to talk too.
  const onKeyUp = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!dictateKeyDown.current || !/^(?:d|D|Control|Meta)$/.test(event.key)) return
    dictateKeyDown.current = false
    dictate({ do: 'release', at: performance.now() })
  }
  // The toolbar's popovers and the remove dialog sit in this footer too, and close on their own Escape.
  const onFooterKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return
    if (!(event.target instanceof Element) || event.target.closest(`#${FORM_ID}, .sides, .clip, .stop, .send`) === null) return
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
      {stack}
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
      <div className="box">
        <div className="pill">
          {quote !== null && (
            <div className="quote-chip" role="group" aria-label="Replying to">
              <span title={quote.text}>{quote.text}</span>
              <button type="button" className="unchip" aria-label="Remove quote" onClick={unquote}>
                <svg aria-hidden="true" viewBox="0 0 10 10" width="10" height="10"><path d="M2 2l6 6M8 2 2 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            </div>
          )}
          <form id={FORM_ID} onSubmit={submit}>
            <textarea
              ref={box} autoFocus={autoFocus} rows={1} value={draft}
              placeholder={group !== undefined ? 'Message the group, or type @ to ask specific bots' : quote === null ? `Message ${ownBot?.name ?? 'Hermes'}` : 'Reply…'}
              aria-label={group === undefined ? 'Message Hermes' : `Message ${group.name}`}
              aria-autocomplete="list" aria-controls={menu.open ? MENU_ID : undefined}
              aria-activedescendant={menu.open ? optionId(menu.active) : undefined} aria-describedby={hint === null ? undefined : HINT_ID}
              onChange={event => edit(event.target.value, event.target.selectionStart)} onKeyDown={onKeyDown} onPaste={onPaste}
              onKeyUp={onKeyUp}
              onSelect={event => setCaret(event.currentTarget.selectionStart)}
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            />
          </form>
          {group === undefined && (
            <button type="button" className="clip" aria-label="Attach files" disabled={!canAttach} onClick={() => void take(window.highwing.attachPick())}>
              <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          )}
          {group === undefined && <Microphone state={dictation} disabled={!canAttach} onPress={() => dictate({ do: 'press', at: performance.now() })} />}
          <span className="go">
            {showStop && (
              <button type="button" className="stop" aria-label="Stop" disabled={!canSend} onClick={onStop}>
                <svg aria-hidden="true" viewBox="0 0 10 10" width="10" height="10"><rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
              </button>
            )}
            <button type="submit" form={FORM_ID} className={`send tone-${ownBot?.tone ?? 'ink'}${blocked || draft.trim() === '' ? '' : ' ready'}`} aria-label="Send" title={`Send (${SEND_KEY_LABEL[sendKey]})`} disabled={blocked}>
              <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </span>
        </div>
        <div className="tools">
          {start}
          <div className="end">{end}</div>
        </div>
      </div>
      {hint !== null && <p className="busy" id={HINT_ID}>{hint}</p>}
      {dictation.at === 'recording' && <p className="busy" role="status">Listening. Press {COMMAND_KEY}+D or the microphone to stop.</p>}
      {dictation.at === 'transcribing' && <p className="busy" role="status">Turning speech into text…</p>}
      {dictation.at === 'idle' && dictation.notice !== null && <p className="err refusal" role="alert">{dictation.notice}</p>}
      {children}
      {refusal !== null && <p className="err refusal">{refusal}</p>}
      {open?.missing != null && <p className="err refusal">That chat isn't on this Hermes.</p>}
      {confirming && editing?.kind === 'sent' && (
        <RemoveDialog
          title={removalWords(editing.later)} detail="Hermes can’t bring them back." confirm="Remove and send"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void deliver()}
        />
      )}
      <pre className="slash-output" role="status" aria-label="Command output" aria-busy={pending}>{output}</pre>
    </footer>
  )
}
