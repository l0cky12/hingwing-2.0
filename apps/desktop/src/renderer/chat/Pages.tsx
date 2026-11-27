import type { PageView } from '@highwing/thread'
import { useContext, useState } from 'react'
import { baseName, FileCallContext } from './FilePath'

function PageCard({ page }: { readonly page: PageView }) {
  const fileCall = useContext(FileCallContext)
  const [refused, setRefused] = useState(false)
  const open = async () => setRefused(!(await fileCall('page', page.path)).ok)
  return (
    <section className="page-card" aria-label={page.title}>
      <div className="page-card-text">
        <h3>{page.title}</h3>
        <p title={page.path}>{baseName(page.path)}</p>
      </div>
      <button type="button" aria-label={`Open ${page.title}`} onClick={() => void open()}>Open</button>
      {refused && <p className="file-note">Highwing couldn't open this page.</p>}
    </section>
  )
}

/** The pages a turn made, under its reply. Open fills the window with one and moves the chat to its side. */
export function Pages({ pages }: { readonly pages: readonly PageView[] }) {
  if (pages.length === 0) return null
  return <div className="pages">{pages.map(page => <PageCard key={page.path} page={page} />)}</div>
}
