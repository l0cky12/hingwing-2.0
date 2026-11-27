import type { BotId, Header, ServerSetup } from '@highwing/hermes/domain'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { run } from '../store'
import { EMPTY, readOf, ready, setupOf, testedWords, type Draft, type Read } from './tool-servers-view'

const KINDS: readonly { readonly kind: ServerSetup['kind']; readonly label: string }[] = [{ kind: 'address', label: 'Web address' }, { kind: 'command', label: 'Command' }]

const settling = new Map<BotId | null, Promise<unknown>>()

function settled<T>(bot: BotId | null, work: Promise<T>): Promise<T> {
  settling.set(bot, work)
  void work.finally(() => { if (settling.get(bot) === work) settling.delete(bot) })
  return work
}

export interface Said { readonly ok: boolean; readonly words: string }

export function useToolServers(bot: BotId | null) {
  const [read, setRead] = useState<Read>({ at: 'reading' })
  const [testing, setTesting] = useState(false)
  const [said, setSaid] = useState<Said | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  const reread = async () => {
    setRead({ at: 'reading' })
    await settling.get(bot)
    setRead(readOf(await run({ do: 'toolServers', bot })))
  }
  useEffect(() => { void reread() }, [])

  const add = async (setup: ServerSetup): Promise<boolean> => {
    setTesting(true)
    setSaid(null)
    const outcome = await settled(bot, run({ do: 'addToolServer', bot, setup }))
    setTesting(false)
    if (!outcome.ok) {
      setSaid({ ok: false, words: outcome.refusal.message })
      return false
    }
    setRead({ at: 'read', servers: outcome.value.servers })
    setSaid({ ok: outcome.value.tested.ok, words: testedWords(setup.name, outcome.value.tested) })
    return outcome.value.tested.ok
  }

  const remove = async (name: string) => {
    setRemoving(name)
    setSaid(null)
    const outcome = await settled(bot, run({ do: 'removeToolServer', bot, name }))
    setRemoving(null)
    if (outcome.ok) setRead({ at: 'read', servers: outcome.value })
    else setSaid({ ok: false, words: outcome.refusal.message })
  }

  return { read, testing, said, busy: testing || removing !== null || read.at === 'reading', reread, add, remove, quiet: () => setSaid(null) }
}

export function ToolServerForm({ testing, busy, onAdd, onCancel }: { readonly testing: boolean; readonly busy: boolean; readonly onAdd: (setup: ServerSetup) => void; readonly onCancel: () => void }) {
  const ids = useId()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const change = (patch: Partial<Draft>) => setDraft(held => ({ ...held, ...patch }))
  const changeHeader = (at: number, patch: Partial<Header>) => change({ headers: draft.headers.map((header, index) => (index === at ? { ...header, ...patch } : header)) })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready(draft) && !busy) onAdd(setupOf(draft))
  }

  return (
    <form className="tool-form" aria-label="Add a tool server" onSubmit={submit}>
      <fieldset disabled={testing}>
        <label htmlFor={`${ids}-name`}>Name</label>
        <input id={`${ids}-name`} type="text" spellCheck={false} autoComplete="off" autoFocus value={draft.name} onChange={event => change({ name: event.target.value })} />
        <div className="tool-kinds" role="group" aria-label="Type">
          {KINDS.map(({ kind, label }) => <button key={kind} type="button" aria-pressed={draft.kind === kind} onClick={() => change({ kind })}>{label}</button>)}
        </div>
        {draft.kind === 'address' ? (
          <>
            <label htmlFor={`${ids}-url`}>Address</label>
            <input id={`${ids}-url`} type="url" spellCheck={false} autoComplete="off" placeholder="https://example.com/mcp" value={draft.url} onChange={event => change({ url: event.target.value })} />
            <p className="tool-label">Headers</p>
            <p className="tool-hint">Highwing never shows a header's value again after it adds the server.</p>
            {draft.headers.map((header, at) => (
              <div className="tool-header" key={at}>
                <input type="text" aria-label={`Header ${at + 1} name`} spellCheck={false} autoComplete="off" placeholder="Authorization" value={header.name} onChange={event => changeHeader(at, { name: event.target.value })} />
                <input type="password" aria-label={`Header ${at + 1} value`} autoComplete="off" value={header.value} onChange={event => changeHeader(at, { value: event.target.value })} />
                <button type="button" aria-label={`Remove header ${at + 1}`} onClick={() => change({ headers: draft.headers.filter((_, index) => index !== at) })}>Remove</button>
              </div>
            ))}
            <div className="tool-header"><button type="button" onClick={() => change({ headers: [...draft.headers, { name: '', value: '' }] })}>Add header</button></div>
          </>
        ) : (
          <>
            <label htmlFor={`${ids}-command`}>Command to run</label>
            <input id={`${ids}-command`} type="text" spellCheck={false} autoComplete="off" placeholder="npx" aria-describedby={`${ids}-command-hint`} value={draft.command} onChange={event => change({ command: event.target.value })} />
            <p className="tool-hint" id={`${ids}-command-hint`}>Runs on the Hermes machine.</p>
            <label htmlFor={`${ids}-args`}>Arguments</label>
            <textarea id={`${ids}-args`} rows={3} spellCheck={false} aria-describedby={`${ids}-args-hint`} value={draft.args} onChange={event => change({ args: event.target.value })} />
            <p className="tool-hint" id={`${ids}-args-hint`}>One per line.</p>
          </>
        )}
      </fieldset>
      <div className="tool-foot">
        <button type="button" disabled={testing} onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy || !ready(draft)}>Test and add</button>
      </div>
    </form>
  )
}
