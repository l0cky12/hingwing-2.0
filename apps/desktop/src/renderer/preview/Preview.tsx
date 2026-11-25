import { useEffect, useRef, type ReactNode } from 'react'
import { isWebPage, type Preview as PreviewState, type PreviewContent, type Rect } from '../../ipc-contract'
import { run } from '../store'

type Open = Extract<PreviewState, { state: 'open' }>
type BodyProps<K extends PreviewContent['kind']> = { readonly content: Extract<PreviewContent, { kind: K }>; readonly address: string }

const browse = (url: string) => void run({ do: 'browse', url })
const close = () => void run({ do: 'closePreview' })

/** Where the body sits in the window, in whole pixels. null when it has no room, as under the setup screen. */
function rectOf(element: Element): Rect | null {
  const box = element.getBoundingClientRect()
  const rect = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
  return rect.width > 0 && rect.height > 0 ? rect : null
}

/** Main draws the page over this box, so the box tells main where it is whenever it moves or changes size. */
function PageBody({ content: { load }, address }: BodyProps<'page'>) {
  const slot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = slot.current
    if (element === null) return
    let placed = ''
    const place = () => {
      const rect = rectOf(element)
      if (JSON.stringify(rect) === placed) return
      placed = JSON.stringify(rect)
      void run({ do: 'placePreview', rect })
    }
    const observer = new ResizeObserver(place)
    observer.observe(element)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      void run({ do: 'placePreview', rect: null })
    }
  }, [])
  return (
    <div className="preview-page" ref={slot}>
      {load.at === 'loading' && <p className="preview-note" role="status">Loading</p>}
      {load.at === 'failed' && (
        <div className="preview-failed" role="alert">
          <p>{load.reason}</p>
          {isWebPage(address) && <button type="button" onClick={() => browse(address)}>Open in browser</button>}
        </div>
      )}
    </div>
  )
}

const BODIES: { readonly [K in PreviewContent['kind']]: (props: BodyProps<K>) => ReactNode } = { page: PageBody }

export function Preview({ preview: { title, address, content } }: { readonly preview: Open }) {
  const Body = BODIES[content.kind]
  const failed = content.kind === 'page' && content.load.at === 'failed'
  return (
    <section className="preview" role="region" aria-label="Preview">
      <header className="preview-head">
        <button type="button" className="preview-back" onClick={close}>Back to chat</button>
        <h2 title={address}>{title}</h2>
        <button type="button" onClick={() => void run({ do: 'reloadPreview' })}>Reload</button>
        {/* A failed page offers its own, beside the reason. */}
        {isWebPage(address) && !failed && <button type="button" onClick={() => browse(address)}>Open in browser</button>}
        <button type="button" className="preview-close" aria-label="Close preview" title="Close preview" onClick={close}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <Body content={content} address={address} />
    </section>
  )
}
