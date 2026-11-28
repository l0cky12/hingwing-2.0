import type { PageView } from '@highwing/thread'
import { createContext, useContext, useState, type MouseEvent } from 'react'
import { baseName, FileCallContext } from './FilePath'

/** The thread's `newestPages`, read by each card so a new version of a page redraws its cards without redrawing their turns. */
export const NewestPagesContext = createContext<ReadonlyMap<string, string>>(new Map())

function PageCard({ page }: { readonly page: PageView }) {
  const fileCall = useContext(FileCallContext)
  const newest = useContext(NewestPagesContext).get(page.path)
  const [refused, setRefused] = useState(false)
  const open = async () => setRefused(!(await fileCall('page', page.path)).ok)
  const older = newest !== undefined && newest !== page.version
  const toNewest = (event: MouseEvent<HTMLButtonElement>) => {
    const scope = event.currentTarget.closest('#transcript') ?? document
    const card = scope.querySelector(`.page-card[data-page-path="${CSS.escape(page.path)}"][data-page-version="${CSS.escape(newest ?? '')}"]`)
    card?.scrollIntoView({ block: 'center', behavior: 'instant' })
    card?.querySelector<HTMLElement>('.page-open')?.focus({ preventScroll: true })
  }
  return (
    <section className={older ? 'page-card older' : 'page-card'} aria-label={page.title} data-page-path={page.path} data-page-version={page.version}>
      <div className="page-card-text">
        <h3>{page.title}</h3>
        <p title={page.path}>{baseName(page.path)}</p>
      </div>
      <button type="button" className="page-open" aria-label={`Open ${page.title}`} onClick={() => void open()}>Open</button>
      {older && (
        <button type="button" className="page-newer" onClick={toNewest}>
          <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12"><path d="M6 2v8M2.5 6.5 6 10l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Newer version below
        </button>
      )}
      {refused && <p className="file-note">Highwing couldn't open this page.</p>}
    </section>
  )
}

/** The pages a turn made, under its reply. Open fills the window with one and moves the chat to its side. An older card points down to the newest. */
export function Pages({ pages }: { readonly pages: readonly PageView[] }) {
  if (pages.length === 0) return null
  return <div className="pages">{pages.map(page => <PageCard key={page.path} page={page} />)}</div>
}
