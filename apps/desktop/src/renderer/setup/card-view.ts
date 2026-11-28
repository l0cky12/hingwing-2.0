import { byKind, failureOf, machineOf, sameTarget, serverName, STEP_WORDS, wayLabel, type Link, type PickMode, type Server, type ServerId, type Target, type WayLabel } from '@highwing/hermes/domain'
import { NO_SERVERS, type Into, type ServerBook } from '../../ipc-contract'
import { bannerOf, type BannerAction } from '../chrome/Chrome'
import { KINDS, SIGN_IN_HINT, type Kind } from './form'
import type { CardSetup } from './screens'

export interface Summary {
  readonly kind: Target['kind']
  readonly title: string
  readonly host: string | null
  readonly linkMessage: string | null
  readonly online: boolean
  readonly action: BannerAction | null
}

export type Foot =
  | { readonly show: 'note' }
  | { readonly show: 'progress'; readonly words: string; readonly hint: string | null }
  | { readonly show: 'nothing' }

export interface Editor {
  /** What a passed check does with the target: the editor Change opens replaces the server, and the two Add buttons open the other two. */
  readonly into: Into
  /** What the form and its kind picker are called. */
  readonly title: string
  readonly asks: string
  readonly seed: Target | null
  /** The kind picked when there is no seed. */
  readonly kind: Kind
  readonly disabled: boolean
  readonly problem: { readonly words: string; readonly fix: string } | null
  readonly foot: Foot
  readonly cancel: 'fold' | 'stop' | 'saving' | 'stop-waiting' | null
}

/** One saved server in the Servers list, shown only when there are two or more. `ways`: its ways' labels, or null when they would only repeat its name. */
export interface ServerRow { readonly id: ServerId; readonly name: string; readonly ways: string | null; readonly current: boolean }

/** One way in to the current server. `up`, `down` and `without` are the ways as they would be after that button, or null where the button has nowhere to go. */
export interface WayRow {
  readonly key: string
  readonly label: WayLabel
  /** What the way is reached at, in mono. null for this computer. */
  readonly host: string | null
  /** What the row's buttons call it. */
  readonly name: string
  readonly time: string | null
  readonly inUse: boolean
  readonly up: readonly Target[] | null
  readonly down: readonly Target[] | null
  readonly without: readonly Target[]
}

/** The current server's ways and pick, shown only when it has two or more ways. */
export interface Ways { readonly pick: PickMode; readonly order: readonly Target[]; readonly rows: readonly WayRow[] }

export interface CardView {
  readonly servers: readonly ServerRow[]
  readonly summary: Summary | null
  readonly ways: Ways | null
  readonly editor: Editor | null
  /** Whether Change shows. A server with several ways is edited one way at a time. */
  readonly change: boolean
  /** Whether the two Add buttons show: in Settings, while no editor is open. */
  readonly adds: boolean
  /** Whether a check runs. Main refuses every edit of the servers until it ends. */
  readonly busy: boolean
  readonly news: string | null
}

const NOTE: Foot = { show: 'note' }
const NOTHING: Foot = { show: 'nothing' }

// Settings is open already, and main refuses to open it again, which would stop the commands after it.
const inSettings = ({ label, run }: BannerAction): BannerAction => ({ label, run: run.filter(command => command.do !== 'editTarget') })

// Main runs one check at a time, so Sign in, which starts one, waits for the running check to end.
const oneCheckAtATime = (summary: Summary | null): Summary | null =>
  summary?.action?.run.some(command => command.do === 'checkTarget') === true ? { ...summary, action: null } : summary

const addressOf = (target: Target) => byKind<string | null>(target, { local: () => null, remote: ({ host }) => host, ssh: ({ host }) => host, url: ({ url }) => url })

function summaryOf(target: Target, link: Link | undefined, server: Server | undefined): Summary {
  const title = server?.name ?? serverName(target)
  const saved = addressOf(target)
  const action = link === undefined ? null : (bannerOf(link, target)?.action ?? null)
  return {
    // The first way's, so the tile stays the same picture whichever way a dial lands on.
    kind: (server?.ways[0] ?? target).kind,
    title,
    // The rows of a server with several ways name each address.
    host: saved === title || (server !== undefined && server.ways.length > 1) ? null : saved,
    linkMessage: link?.state === 'waiting' || link?.state === 'blocked' ? link.message : null,
    online: link?.state === 'online',
    action: action && inSettings(action)
  }
}

const serverRow = (current: ServerId | null) => ({ id, name, ways }: Server): ServerRow => {
  const labels = ways.map(wayLabel).join(' · ')
  return { id, name, ways: labels === name ? null : labels, current: id === current }
}

const timeOf = (ms: number | null): string => (ms === null ? 'No answer' : `${Math.round(ms)} ms`)

function waysOf(server: Server, book: ServerBook, inUse: Target | null): Ways | null {
  const { ways } = server
  if (ways.length < 2) return null
  const swapped = (at: number, other: number) => ways.map((way, index) => (index === at ? ways[other] : index === other ? ways[at] : way) as Target)
  const rows = ways.map((way, index): WayRow => {
    const label = wayLabel(way)
    const host = addressOf(way)
    const timed = book.times.find(({ target }) => sameTarget(target, way))
    return {
      key: JSON.stringify(way),
      label, host, name: host ?? label,
      time: timed === undefined ? null : timeOf(timed.ms),
      inUse: inUse !== null && sameTarget(inUse, way),
      up: index === 0 ? null : swapped(index, index - 1),
      down: index === ways.length - 1 ? null : swapped(index, index + 1),
      without: ways.filter(other => other !== way)
    }
  })
  return { pick: server.pick, order: ways, rows }
}

const TITLES: { readonly [I in Into]: (server: string) => { readonly title: string; readonly asks: string } } = {
  replace: () => ({ title: 'Change the connection', asks: 'Where Hermes runs' }),
  addWay: server => ({ title: `Add a way in to ${server}`, asks: `Another way in to ${server}` }),
  addServer: () => ({ title: 'Add a server', asks: 'Where the other Hermes runs' })
}

/** A new way starts on the first kind the server has no way of, since a second way of one kind is the rarer wish. */
const firstKind = (into: Into, server: Server | undefined): Kind =>
  (into === 'addWay' ? KINDS.find(kind => server?.ways.every(way => way.kind !== kind) === true) : undefined) ?? 'remote'

/**
 * What the Connection page shows. `editing`: the editor the user opened, which a check in `setup` overrides.
 * `checked`: the target of the last check this window saw, which names the way a passed check added.
 */
export function cardOf(setup: CardSetup, link: Link | undefined, editing: Into | null, book: ServerBook = NO_SERVERS, checked: Target | null = null): CardView {
  const { live } = setup
  const first = live === null
  const server = first ? undefined : book.list.find(({ id }) => id === live.server)
  const named = server?.name ?? (first ? '' : serverName(live.target))
  const summary = first ? null : summaryOf(live.target, link, server)
  const editorOf = (into: Into, seed: Target | null, rest: Pick<Editor, 'disabled' | 'problem' | 'foot' | 'cancel'>): Editor =>
    ({ into, ...TITLES[into](named), seed, kind: firstKind(into, server), ...rest })
  const atRest = (): Editor | null => {
    const into = first ? 'replace' : editing
    if (into === null) return null
    return editorOf(into, into === 'replace' ? live?.target ?? null : null, { disabled: false, problem: null, foot: first ? NOTHING : NOTE, cancel: first ? null : 'fold' })
  }
  const shown = (editor: Editor | null, shownSummary: Summary | null, news: string | null): CardView => ({
    servers: book.list.length < 2 ? [] : book.list.map(serverRow(book.current)),
    summary: shownSummary,
    ways: server === undefined ? null : waysOf(server, book, summary?.online === true ? live?.target ?? null : null),
    editor,
    change: editor === null && (server === undefined || server.ways.length === 1),
    adds: !first && editor === null,
    busy: setup.at === 'checking',
    news
  })
  switch (setup.at) {
    case 'form': return shown(atRest(), summary, null)
    case 'saved': {
      const added = checked ?? server?.ways.at(-1) ?? setup.live.target
      // A server with several ways is the same server whichever way is in use, so the news names the server.
      const machine = server !== undefined && server.ways.length > 1 ? server.name : machineOf(setup.live.target)
      const news = setup.into === 'addWay' ? `${named} can now be reached over ${wayLabel(added)}.` : `Highwing now uses the Hermes on ${machine}.`
      return shown(atRest(), summary, news)
    }
    case 'checking': {
      const words = STEP_WORDS[setup.step](machineOf(setup.target))
      const signIn = setup.step === 'sign-in'
      const cancel = first ? (signIn ? 'stop-waiting' : null) : setup.step === 'save' ? 'saving' : 'stop'
      const foot: Foot = { show: 'progress', words, hint: signIn ? SIGN_IN_HINT : null }
      return shown(editorOf(setup.into, setup.target, { disabled: true, problem: null, foot, cancel }), oneCheckAtATime(summary), null)
    }
    case 'failed': {
      const failure = failureOf(setup.failure)
      const machine = machineOf(setup.target)
      const problem = { words: failure.words(machine), fix: failure.fix(machine) }
      return shown(editorOf(setup.into, setup.target, { disabled: false, problem, foot: first ? NOTHING : NOTE, cancel: first ? null : 'stop' }), summary, null)
    }
  }
}
