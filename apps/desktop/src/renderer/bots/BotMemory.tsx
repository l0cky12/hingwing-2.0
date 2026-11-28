import type { BotId, BotMemory as BotMemoryRead, CommandOutcome, MemoryFile, MemoryFileName } from '@highwing/hermes/domain'
import { useEffect, useState } from 'react'

export type MemoryView =
  | { readonly state: 'loading' }
  | { readonly state: 'refused'; readonly message: string }
  | { readonly state: 'ready'; readonly memory: BotMemoryRead }

const ABOUT: Readonly<Record<MemoryFileName, string>> = {
  'MEMORY.md': 'What Hermes remembers about its work',
  'USER.md': 'What Hermes remembers about you'
}
const NEAR_FULL = 0.9

const grouped = (count: number) => count.toLocaleString('en-US')

export interface BotMemoryProps {
  readonly bot: BotId
  readonly onRead: (bot: BotId) => Promise<CommandOutcome<BotMemoryRead>>
}

/** What a bot's Memory tab shows: the two files Hermes keeps for it, read afresh each time the tab opens. */
export function BotMemory({ bot, onRead }: BotMemoryProps) {
  const [read, setRead] = useState<{ readonly bot: BotId; readonly view: MemoryView } | null>(null)
  useEffect(() => {
    let current = true
    void onRead(bot).then(outcome => {
      if (current) setRead({ bot, view: outcome.ok ? { state: 'ready', memory: outcome.value } : { state: 'refused', message: outcome.refusal.message } })
    })
    return () => { current = false }
  }, [bot, onRead])
  return <MemoryFiles view={read?.bot === bot ? read.view : { state: 'loading' }} />
}

export function MemoryFiles({ view }: { readonly view: MemoryView }) {
  if (view.state === 'loading') return <p className="memory-note" aria-busy="true">Reading memory…</p>
  if (view.state === 'refused') return <p className="memory-note memory-refused" role="alert">{view.message}</p>
  return <>{view.memory.files.map(file => <MemorySection key={file.name} file={file} />)}</>
}

function MemorySection({ file }: { readonly file: MemoryFile }) {
  const { name, entries, used, cap } = file
  const size = cap === null ? `${name}: ${grouped(used)} characters` : `${name}: ${grouped(used)} of ${grouped(cap)} characters`
  return (
    <section className="memory-file" aria-label={name}>
      <h3>{name}</h3>
      <p className="memory-about">{ABOUT[name]}</p>
      {cap === null ? null : (
        // A meter's high region starts above `high`, so this is the whole number just under nine tenths of the cap.
        <meter className="memory-meter" min={0} max={cap} high={Math.ceil(cap * NEAR_FULL) - 1} optimum={0} value={used} aria-label={size} />
      )}
      <p className="memory-size" aria-hidden={cap === null ? undefined : true}>{size}</p>
      {cap === null ? <p className="memory-note">Highwing couldn't read how much this file may hold from Hermes, so it has no meter.</p> : null}
      {entries.length === 0 ? <p className="memory-note">Nothing yet.</p> : (
        <ul className="memory-entries" aria-label={`${name} entries`}>
          {entries.map((text, at) => <li key={at}>{text}</li>)}
        </ul>
      )}
    </section>
  )
}
