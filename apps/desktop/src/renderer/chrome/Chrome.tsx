import type { Link } from '@highwing/hermes/domain'
import { run } from '../store'

export function TopBar() {
  return <header className="bar"><h1><span className="brand">Hermes</span></h1></header>
}

interface BannerCopy {
  readonly words: string
  /** Start is the only way a dial after launch starts the gateway. */
  readonly action: { readonly label: string; readonly start: boolean } | null
}

function bannerOf(link: Link): BannerCopy | null {
  switch (link.state) {
    case 'blocked': return { words: link.message, action: { label: 'Retry', start: false } }
    case 'waiting': return { words: link.message, action: link.why === 'not-running' ? { label: 'Start Hermes', start: true } : null }
    default: return null
  }
}

export function Banner({ link }: { readonly link: Link }) {
  const copy = bannerOf(link)
  if (copy === null) return null
  const { action } = copy
  return (
    <div className="banner" role="status" aria-label="Connection">
      <p>{copy.words}</p>
      {action !== null && <button onClick={() => void run({ do: 'reconnect', start: action.start })}>{action.label}</button>}
    </div>
  )
}
