import type RFB from '@novnc/novnc'
import type { Control, ScreenView } from '@highwing/hermes/domain'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { blobUrlOf } from '../bots/pictures'
import { Epoch, run } from '../store'
import { CARD_WORDS, closedWords, CONTROL_WORDS, NO_SCREEN_WORDS, pressOf, showComputer, useComputerShown } from './computer'
import { askForPort, portSocket } from './port'

const close = () => showComputer(false)

/** In the top bar of a bot's chat: opens the view, which says what it can when there is no screen to show. */
export function ComputerButton({ view }: { readonly view: ScreenView }) {
  const shown = useComputerShown()
  return <button type="button" aria-pressed={shown} data-screen={view.screen.state} onClick={() => showComputer(!shown)}>Screen</button>
}

function useFrame(thumbnail: string | null): string | null {
  const url = useMemo(() => (thumbnail === null ? null : blobUrlOf(thumbnail)), [thumbnail])
  useEffect(() => () => {
    if (url !== null) URL.revokeObjectURL(url)
  }, [url])
  return url
}

/** Above the composer while the agent uses its screen: the latest frame, and the way into the live view. */
export function ComputerCard({ control, thumbnail }: { readonly control: Control; readonly thumbnail: string | null }) {
  const frame = useFrame(thumbnail)
  return (
    <div className="computer-card">
      <button type="button" aria-label="Open screen" onClick={() => showComputer(true)}>
        {frame === null ? <span className="computer-thumb" /> : <img className="computer-thumb" src={frame} alt="" data-frame="shown" />}
        <span>{CARD_WORDS[control]}</span>
      </button>
    </div>
  )
}

/**
 * noVNC draws a JPEG or PNG rectangle of the screen from a `data:` URL (core/display.js `imageRect`), which the window's
 * policy refuses, so this view's display draws each from a `blob:` URL instead.
 */
function drawFromBlobs({ _display: display }: RFB) {
  display.imageRect = (x, y, width, height, mime, bytes) => {
    if (width === 0 || height === 0) return
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
    const img = new Image()
    const free = () => URL.revokeObjectURL(url)
    img.addEventListener('load', free, { once: true })
    img.addEventListener('error', free, { once: true })
    img.src = url
    display._renderQPush({ type: 'img', img, x, y, width, height })
  }
}

type Live = { readonly at: 'connecting' } | { readonly at: 'live' } | { readonly at: 'closed'; readonly code: number }

/** The screen itself, over a port main opens to Hermes. Input reaches it only while `control` is `you`, and Hermes checks that too. */
function LiveScreen({ control }: { readonly control: Control }) {
  const epoch = useContext(Epoch)
  const target = useRef<HTMLDivElement>(null)
  const rfb = useRef<RFB | null>(null)
  const [live, setLive] = useState<Live>({ at: 'connecting' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let gone = false
    let code = 1000
    const watch = (viewer: RFB) => {
      drawFromBlobs(viewer)
      viewer.scaleViewport = true
      viewer.viewOnly = true
      viewer.addEventListener('connect', () => setLive({ at: 'live' }))
      viewer.addEventListener('disconnect', () => {
        rfb.current = null
        if (gone) return
        if (closedWords(code).again) setAttempt(at => at + 1)
        else setLive({ at: 'closed', code })
      })
      rfb.current = viewer
    }
    setLive({ at: 'connecting' })
    const withdraw = askForPort(epoch, port => {
      // noVNC reads the window as it loads, so it is loaded only when a view opens.
      void import('@novnc/novnc').then(({ default: Viewer }) => {
        if (gone || target.current === null) return port.close()
        watch(new Viewer(target.current, portSocket(port, closed => (code = closed)), { shared: true }))
      })
    })
    return () => {
      gone = true
      withdraw()
      rfb.current?.disconnect()
      rfb.current = null
    }
  }, [epoch, attempt])

  useEffect(() => {
    if (rfb.current === null) return
    rfb.current.viewOnly = control !== 'you'
    if (control === 'you') rfb.current.focus()
  }, [control, live])

  return (
    <div className="computer-live" data-live={live.at} data-control={control}>
      <div className="computer-canvas" ref={target} hidden={live.at === 'closed'} />
      {live.at === 'connecting' && <p className="preview-note" role="status">Connecting to the screen</p>}
      {live.at === 'closed' && (
        <div className="preview-failed" role="alert">
          <p>{closedWords(live.code).words}</p>
          <button type="button" onClick={() => setAttempt(at => at + 1)}>Reconnect</button>
        </div>
      )}
    </div>
  )
}

/** The pane beside the chat that shows the open chat's bot's screen. */
export function ComputerView({ view: { bot, screen } }: { readonly view: ScreenView }) {
  const [said, setSaid] = useState<string | null>(null)
  const press = screen.state === 'on' ? pressOf(screen.control) : null
  useEffect(() => setSaid(null), [bot, screen.state])
  const act = async (take: boolean) => {
    const outcome = await run(take ? { do: 'takeControl', bot } : { do: 'handBack', bot })
    setSaid(outcome.ok ? null : outcome.refusal.message)
  }
  return (
    <section className="preview computer" role="region" aria-label="Screen">
      <header className="preview-head">
        <button type="button" className="preview-back" onClick={close}>Back to chat</button>
        <h2>Screen</h2>
        {screen.state === 'on' && <span className="computer-control" role="status" data-control={screen.control}>{CONTROL_WORDS[screen.control]}</span>}
        {press !== null && <button type="button" className={press.take ? undefined : 'primary'} onClick={() => void act(press.take)}>{press.label}</button>}
        <button type="button" className="preview-close" aria-label="Close screen" title="Close screen" onClick={close}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>
      {said !== null && <p className="computer-said" role="alert">{said}</p>}
      {screen.state === 'on'
        ? <LiveScreen key={bot ?? ''} control={screen.control} />
        : <div className="preview-page"><p className="preview-note">{NO_SCREEN_WORDS[screen.state]}</p></div>}
    </section>
  )
}
