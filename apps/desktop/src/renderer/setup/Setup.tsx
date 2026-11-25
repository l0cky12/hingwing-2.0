import { machineOf, type Target } from '@highwing/hermes/domain'
import type { Setup } from '../../ipc-contract'
import { Bar } from '../chrome/Chrome'
import { run } from '../store'
import { ConnectionCard } from './ConnectionCard'
import { LEAD } from './form'

const NOTICES = {
  unreadable: "Highwing couldn't read its saved connection, so it is asking again. The old file is kept under another name when you connect.",
  newer: 'A newer Highwing saved the connection on this computer. This one can\'t read it, and keeps that file under another name when you connect.'
} as const

export function FirstRun({ setup }: { readonly setup: Extract<Setup, { at: 'form' | 'checking' | 'failed' }> }) {
  return (
    <div className="screen">
      <Bar where="Connection" />
      <main>
        <div className="setup">
          <h2>Connect to Hermes</h2>
          <p className="lead">{LEAD}</p>
          {setup.at === 'form' && setup.notice !== null && <p className="kept" role="note">{NOTICES[setup.notice]}</p>}
          <ConnectionCard setup={setup} link={undefined} />
        </div>
      </main>
    </div>
  )
}

export function Saved({ target }: { readonly target: Target }) {
  return (
    <div className="screen">
      <Bar where="Connection" />
      <main>
        <div className="setup saved">
          <h2><span className="glyph" />Highwing now uses the Hermes on {machineOf(target)}.</h2>
          <p className="lead">This connection is saved, and Highwing opens on the chat from now on. To change it, open Settings from the top bar.</p>
          <div className="actions">
            <button type="button" className="primary" autoFocus onClick={() => void run({ do: 'openChat' })}>Open chat</button>
          </div>
        </div>
      </main>
    </div>
  )
}
