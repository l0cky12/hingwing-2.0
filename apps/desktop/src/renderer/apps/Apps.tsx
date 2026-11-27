import { appsView, shownBot, STANDING_WORDS, type AppEntry, type AppsBoard } from '@highwing/hermes/domain'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { appsKeys, isShortcut } from '../keys'
import { run, useTopic } from '../store'
import { ToolServers } from './ToolServers'

const canHoldFocus = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement && element !== document.body && element.isConnected && element.closest('[hidden]') === null
  && element.checkVisibility() && !element.matches(':disabled')

const FALLBACKS = ['.settings .change', '.settings > h2', '.composer textarea']
const fallbackFocus = () => FALLBACKS.map(selector => document.querySelector(selector)).find(canHoldFocus) ?? null

interface Waiting {
  readonly slug: string
  readonly opId: string | null
  readonly url: string | null
}

const wordsOf = (app: AppEntry, waiting: Waiting | null) =>
  waiting?.slug === app.slug ? 'Connecting…' : STANDING_WORDS[app.account?.standing ?? 'disconnected']

export function AppsButton({ onOpen }: { readonly onOpen: () => void }) {
  return <button type="button" className="apps-open" aria-keyshortcuts={appsKeys()} onClick={onOpen}>Connect apps</button>
}

interface SheetProps {
  readonly back: RefObject<Element | null>
  readonly onClose: () => void
}

function Sheet({ back, onClose }: SheetProps) {
  const bot = shownBot(useTopic('open'))
  const [board, setBoard] = useState<AppsBoard | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [waiting, setWaiting] = useState<Waiting | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const leaving = useRef(false)
  const openRef = useRef(true)
  const signingIn = useRef(false)
  const view = board === null ? null : appsView(board, { text, category })
  const opId = waiting?.opId ?? null

  useLayoutEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  useEffect(() => {
    openRef.current = true
    let stopped = false
    void run({ do: 'apps', bot }).then(outcome => {
      if (stopped || !openRef.current) return
      if (outcome.ok) {
        setBoard(outcome.value)
        setProblem(null)
      } else setProblem(outcome.refusal.message)
    })
    return () => {
      stopped = true
      openRef.current = false
    }
  }, [bot])

  useEffect(() => {
    if (opId === null) return
    let stopped = false
    let id = 0
    const tick = async () => {
      const outcome = await run({ do: 'appSignIn', opId, bot })
      if (stopped || !openRef.current) return
      if (!outcome.ok) {
        signingIn.current = false
        setWaiting(null)
        setProblem(outcome.refusal.message)
        return
      }
      if (!outcome.value.settled) return
      stopped = true
      clearInterval(id)
      signingIn.current = false
      const next = await run({ do: 'apps', bot })
      if (!openRef.current) return
      if (next.ok) setBoard(next.value)
      else setProblem(next.refusal.message)
      setWaiting(null)
    }
    id = window.setInterval(() => void tick(), 400)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [opId, bot])

  const dismiss = () => {
    leaving.current = true
    openRef.current = false
    dialog.current?.close()
    const held = canHoldFocus(back.current) ? back.current : fallbackFocus()
    held?.focus()
    onClose()
  }

  const connect = (app: AppEntry) => {
    if (signingIn.current) return
    signingIn.current = true
    setWaiting({ slug: app.slug, opId: null, url: null })
    void run({ do: 'connectApp', slug: app.slug, bot, connectionId: app.account?.connectionId ?? null }).then(async outcome => {
      if (!openRef.current) return
      if (!outcome.ok) {
        signingIn.current = false
        setWaiting(null)
        setProblem(outcome.refusal.message)
        return
      }
      const { url, settled } = outcome.value
      if (url !== null) void run({ do: 'browse', url })
      if (settled || outcome.value.opId === '') {
        signingIn.current = false
        setWaiting(null)
        const next = await run({ do: 'apps', bot })
        if (!openRef.current) return
        if (next.ok) setBoard(next.value)
        else setProblem(next.refusal.message)
        return
      }
      setWaiting({ slug: app.slug, opId: outcome.value.opId, url })
    })
  }

  const remove = (app: AppEntry) => {
    const connectionId = app.account?.connectionId
    if (connectionId === undefined || signingIn.current) return
    void run({ do: 'removeApp', connectionId, bot }).then(async outcome => {
      if (!openRef.current) return
      if (!outcome.ok) {
        setProblem(outcome.refusal.message)
        return
      }
      const next = await run({ do: 'apps', bot })
      if (!openRef.current) return
      if (next.ok) setBoard(next.value)
      else setProblem(next.refusal.message)
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    event.stopPropagation()
    if (event.nativeEvent.isComposing || event.repeat) return
    if (!isShortcut(event.nativeEvent, 'apps')) return
    event.preventDefault()
    dismiss()
  }

  const closeOnBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) dismiss()
  }

  return (
    <dialog
      ref={dialog} className="apps" aria-label="Connect apps"
      onCancel={event => { event.preventDefault(); dismiss() }}
      onClose={() => { if (!leaving.current) dismiss() }}
      onKeyDown={onKeyDown} onClick={closeOnBackdrop}
    >
      <div className="apps-sheet">
        <input
          type="text" className="apps-field" aria-label="Search apps" placeholder="Search apps" autoFocus spellCheck={false} autoComplete="off"
          value={text} onChange={event => setText(event.target.value)}
        />
        {problem !== null && <p className="apps-problem" role="alert">{problem}</p>}
        {view !== null && board !== null && (
          <>
            <p className="apps-summary">{view.summary}</p>
            <div className="apps-chips" role="group" aria-label="Categories">
              <button type="button" aria-pressed={category === null} onClick={() => setCategory(null)}>All</button>
              {view.categories.map(name => (
                <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>
              ))}
            </div>
          </>
        )}
        <div className="apps-list">
          {view !== null && board !== null && (
            <>
              {view.sections.map(section => (
                <section key={section.heading} aria-label={section.heading}>
                  <h3 className="apps-heading">{section.heading}</h3>
                  {section.apps.map(app => {
                    const again = waiting?.slug === app.slug ? waiting.url : null
                    const reconnect = app.account !== null
                    return (
                      <div key={app.slug} className="apps-row">
                        <div className="apps-copy">
                          <p className="apps-name">{app.name}</p>
                          {app.description !== '' && <p className="apps-desc">{app.description}</p>}
                        </div>
                        <p className="apps-standing" data-standing={waiting?.slug === app.slug ? 'connecting' : app.account?.standing ?? 'disconnected'}>{wordsOf(app, waiting)}</p>
                        <div className="apps-actions">
                          {again !== null && <button type="button" onClick={() => void run({ do: 'browse', url: again })}>Open sign-in again</button>}
                          <button type="button" aria-label={`${reconnect ? 'Reconnect' : 'Connect'} ${app.name}`} disabled={waiting !== null} onClick={() => connect(app)}>
                            {reconnect ? 'Reconnect' : 'Connect'}
                          </button>
                          {app.account !== null && (
                            <button type="button" aria-label={`Remove ${app.name}`} disabled={waiting !== null} onClick={() => remove(app)}>Remove</button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </section>
              ))}
              {view.empty && <p className="apps-empty">{board.apps.length === 0 ? 'No apps.' : 'No apps match.'}</p>}
            </>
          )}
          <ToolServers key={bot ?? ''} bot={bot} />
        </div>
      </div>
    </dialog>
  )
}

export function Apps({ open, back, onOpen, onClose }: { readonly open: boolean; readonly back: RefObject<Element | null>; readonly onOpen: () => void; readonly onClose: () => void }) {
  useEffect(() => {
    if (open) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isShortcut(event, 'apps') || document.querySelector('dialog:modal') !== null) return
      event.preventDefault()
      if (!event.repeat) onOpen()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onOpen])
  return open ? <Sheet back={back} onClose={onClose} /> : null
}
