import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { isWebPage, type Preview as PreviewState, type PreviewContent, type Rect, type Table } from '../../ipc-contract'
import { run } from '../store'

type Open = Extract<PreviewState, { state: 'open' }>
type BodyProps<K extends PreviewContent['kind']> = { readonly content: Extract<PreviewContent, { kind: K }>; readonly wayOut: ReactNode }

const close = () => void run({ do: 'closePreview' })

function WayOut({ address, file }: Pick<Open, 'address' | 'file'>) {
  if (file) return <button type="button" onClick={() => void run({ do: 'openPreview' })}>Open</button>
  if (isWebPage(address)) return <button type="button" onClick={() => void run({ do: 'browse', url: address })}>Open in browser</button>
  return null
}

/** Where the body sits in the window, in whole pixels. null when it has no room, as under the setup screen. */
function rectOf(element: Element): Rect | null {
  const box = element.getBoundingClientRect()
  const rect = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
  return rect.width > 0 && rect.height > 0 ? rect : null
}

/** Main draws the page over this box, so the box tells main where it is whenever it moves or changes size. */
function PageBody({ content: { load }, wayOut }: BodyProps<'page'>) {
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
          {wayOut}
        </div>
      )}
    </div>
  )
}

const count = (rows: number) => rows.toLocaleString('en-US')

const rowsOf = ({ rows, total }: Table) =>
  rows.length < total ? `Showing the first ${count(rows.length)} of ${count(total)} rows` : total === 0 ? 'No rows' : `${count(total)} ${total === 1 ? 'row' : 'rows'}`

const SCROLL_KEYS: ReadonlySet<string> = new Set(['PageUp', 'PageDown', 'End'])
const keepScrollKeys = (event: KeyboardEvent) => {
  if (SCROLL_KEYS.has(event.key)) event.stopPropagation()
}

function TableBody({ content: { table } }: BodyProps<'table'>) {
  return (
    <>
      <div className="preview-table" role="region" aria-label="Rows" tabIndex={0} onKeyDown={keepScrollKeys}>
        <table>
          <thead>
            <tr>{table.header.map((cell, at) => <th key={at} scope="col">{cell}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((row, at) => <tr key={at}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      <p className="preview-rows" role="status">{rowsOf(table)}</p>
    </>
  )
}

const BODIES: { readonly [K in PreviewContent['kind']]: (props: BodyProps<K>) => ReactNode } = { page: PageBody, table: TableBody }

export function Preview({ preview: { title, address, file, content } }: { readonly preview: Open }) {
  const Body = BODIES[content.kind] as (props: BodyProps<PreviewContent['kind']>) => ReactNode
  const failed = content.kind === 'page' && content.load.at === 'failed'
  const wayOut = <WayOut address={address} file={file} />
  return (
    <section className="preview" role="region" aria-label="Preview">
      <header className="preview-head">
        <button type="button" className="preview-back" onClick={close}>Back to chat</button>
        <h2 title={address}>{title}</h2>
        <button type="button" onClick={() => void run({ do: 'reloadPreview' })}>Reload</button>
        {/* A failed page offers its own, beside the reason. */}
        {!failed && wayOut}
        <button type="button" className="preview-close" aria-label="Close preview" title="Close preview" onClick={close}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <Body content={content} wayOut={wayOut} />
    </section>
  )
}
