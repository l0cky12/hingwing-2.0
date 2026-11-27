import type { BotId, Header, ServerSetup, ToolServer } from '@highwing/hermes/domain'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { run } from '../store'
import { EMPTY, readOf, ready, setupOf, STATES, testedWords, type Draft, type Read } from './tool-servers-view'

const KINDS: readonly { readonly kind: ServerSetup['kind']; readonly label: string }[] = [{ kind: 'address', label: 'Web address' }, { kind: 'command', label: 'Command' }]

/** A bot's add or remove that is still running, which the window opened again waits for before it reads the list. */
const settling = new Map<BotId | null, Promise<unknown>>()

function settled<T>(bot: BotId | null, work: Promise<T>): Promise<T> {
  settling.set(bot, work)
  void work.finally(() => { if (settling.get(bot) === work) settling.delete(bot) })
  return work
}

/** The Connect apps window's tool servers for `bot`, the open chat's bot or, for null, the bot Hermes runs as. */
export function ToolServers({ bot }: { readonly bot: BotId | null }) {
  const ids = useId()
  const [read, setRead] = useState<Read>({ at: 'reading' })
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [testing, setTesting] = useState(false)
  const [said, setSaid] = useState<{ readonly ok: boolean; readonly words: string } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const busy = testing || removing !== null || read.at === 'reading'

  const reread = async () => {
    setRead({ at: 'reading' })
    await settling.get(bot)
    setRead(readOf(await run({ do: 'toolServers', bot })))
  }
  useEffect(() => { void reread() }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready(draft) || busy) return
    const setup = setupOf(draft)
    setTesting(true)
    setSaid(null)
    const outcome = await settled(bot, run({ do: 'addToolServer', bot, setup }))
    setTesting(false)
    if (!outcome.ok) {
      setSaid({ ok: false, words: outcome.refusal.message })
      return
    }
    setRead({ at: 'read', servers: outcome.value.servers })
    setSaid({ ok: outcome.value.tested.ok, words: testedWords(setup.name, outcome.value.tested) })
    if (!outcome.value.tested.ok) return
    setDraft(EMPTY)
    setAdding(false)
  }

  const remove = async (name: string) => {
    setRemoving(name)
    setSaid(null)
    const outcome = await settled(bot, run({ do: 'removeToolServer', bot, name }))
    setRemoving(null)
    if (outcome.ok) setRead({ at: 'read', servers: outcome.value })
    else setSaid({ ok: false, words: outcome.refusal.message })
  }

  const close = () => {
    setDraft(EMPTY)
    setAdding(false)
    setSaid(null)
  }
  const change = (patch: Partial<Draft>) => setDraft(held => ({ ...held, ...patch }))
  const changeHeader = (at: number, patch: Partial<Header>) => change({ headers: draft.headers.map((header, index) => (index === at ? { ...header, ...patch } : header)) })

  return (
    <section className="tool-servers" aria-label="Tool servers" aria-busy={read.at === 'reading' || undefined}>
      <h3 className="apps-heading">Tool servers</h3>
      {read.at === 'reading' && <p className="apps-empty">Asking Hermes…</p>}
      {read.at === 'refused' && (
        <div className="apps-row">
          <p className="apps-copy apps-desc" role="alert">{read.words}</p>
          {!read.unsupported && <div className="apps-actions"><button type="button" disabled={busy} onClick={() => void reread()}>Try again</button></div>}
        </div>
      )}
      {read.at === 'read' && read.servers.length === 0 && <p className="apps-empty">No tool servers yet.</p>}
      {read.at === 'read' && read.servers.map(server => <ServerRow key={server.name} server={server} busy={busy} onRemove={() => void remove(server.name)} />)}
      <p className="tool-said" role="status">{testing ? 'Testing…' : said?.ok === true ? said.words : ''}</p>
      {said?.ok === false && <p className="tool-problem" role="alert">{said.words}</p>}
      {!(read.at === 'refused' && read.unsupported) && !adding && (
        <div className="apps-row"><div className="apps-actions"><button type="button" onClick={() => { setAdding(true); setSaid(null) }}>Add a tool server</button></div></div>
      )}
      {adding && (
        <form className="tool-form" aria-label="Add a tool server" onSubmit={event => void submit(event)}>
          <fieldset disabled={testing}>
            <label htmlFor={`${ids}-name`}>Name</label>
            <input id={`${ids}-name`} type="text" spellCheck={false} autoComplete="off" autoFocus value={draft.name} onChange={event => change({ name: event.target.value })} />
            <div className="apps-chips" role="group" aria-label="Type">
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
            <button type="button" disabled={testing} onClick={close}>Cancel</button>
            <button type="submit" className="primary" disabled={busy || !ready(draft)}>Test and add</button>
          </div>
        </form>
      )}
    </section>
  )
}

function ServerRow({ server, busy, onRemove }: { readonly server: ToolServer; readonly busy: boolean; readonly onRemove: () => void }) {
  return (
    <div className="apps-row">
      <div className="apps-copy">
        <p className="apps-name">{server.name}</p>
        <p className="apps-desc tool-where">{server.where}</p>
      </div>
      <p className="apps-standing" data-standing={server.state}>{STATES[server.state](server.tools)}</p>
      <div className="apps-actions">
        {server.removable
          ? <button type="button" disabled={busy} aria-label={`Remove tool server ${server.name}`} onClick={onRemove}>Remove</button>
          : <p className="apps-desc">From a plugin</p>}
      </div>
    </div>
  )
}
