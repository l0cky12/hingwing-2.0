import { byKind, machineOf, onThisComputer, type Session, type SshHost } from '@highwing/hermes/domain'
import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isWebPage, type PageLoad, type PaneLayout, type Preview, type Setup, type Table } from '../ipc-contract'
import { openablePath } from './files'

/** `ssh`: an HTML file on the machine Hermes runs on, read over ssh. */
export type Page =
  | { readonly kind: 'web'; readonly url: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'ssh'; readonly host: SshHost; readonly path: string }

/** A file page loads from this scheme, never from `file:`, where its script could read any file on the disk. */
export const PAGE_SCHEME = 'highwing-page'

export const pageUrlOf = (path: string): string => `${PAGE_SCHEME}://file${pathToFileURL(path).pathname}`

export const pathOfPageUrl = (url: string): string | null => {
  const parsed = URL.parse(url)
  if (parsed?.protocol !== `${PAGE_SCHEME}:`) return null
  try {
    return fileURLToPath(`file://${parsed.pathname}`)
  } catch {
    return null
  }
}

const below = (root: string, path: string) => {
  const inner = relative(root, path)
  return inner !== '' && !inner.startsWith('..') && !isAbsolute(inner)
}

/**
 * The files a file page may load: itself, and what sits in its folder or under it, except a dot file
 * or a dot folder such as `.ssh` or `.env`. A page in the home folder, or above it, loads only itself.
 */
export function reachable(page: string, path: string, home: string): boolean {
  if (path === page) return true
  const root = dirname(page)
  if (root === home || below(root, home)) return false
  return below(root, path) && !relative(root, path).split(sep).some(part => part.startsWith('.'))
}

/**
 * The file the page scheme serves for `path`, or null. A link inside the folder may point anywhere, so
 * the rule holds both where the request points and where the file really is, and the real file is served.
 */
export async function servedPath(page: string, path: string, home: string): Promise<string | null> {
  if (!reachable(page, path, home)) return null
  const real = (each: string) => realpath(each).catch(() => null)
  const [realPage, realPath, realHome] = await Promise.all([real(page), real(path), real(home)])
  return realPage !== null && realPath !== null && realHome !== null && reachable(realPage, realPath, realHome) ? realPath : null
}

/** What a request to show something comes to. null: refused, so the pane stays as it is. */
export type Verdict = { readonly address: string; readonly page: Page } | { readonly address: string; readonly failed: string } | null

/** What a request is judged against: the chat that named it, and the machine Hermes runs on. `host`: that machine, when ssh reaches it. */
export interface Reach { readonly session: Session | undefined; readonly local: boolean; readonly machine: string; readonly host: SshHost | null }

export const reachOf = (setup: Setup, session: Session | undefined): Reach => {
  const target = setup.at === 'pinned' ? null : setup.live?.target ?? null
  return {
    session,
    local: target === null || onThisComputer(target),
    machine: target === null ? 'this computer' : machineOf(target),
    host: target === null ? null : byKind<SshHost | null>(target, { local: () => null, remote: ({ host }) => host, ssh: ({ host }) => host, url: () => null })
  }
}

const PAGE_FILE = /\.html?$/i

const LOOPBACK = /^(?:localhost|.+\.localhost|0\.0\.0\.0|\[::1\]|127(?:\.\d{1,3}){3})\.?$/i

const pathIn = (request: string, url: URL | null): string | null => {
  if (url === null) return request
  if (url.protocol !== 'file:') return null
  try {
    return fileURLToPath(url)
  } catch {
    return null
  }
}

/**
 * A web page loads as asked, unless it names the loopback of a remote Hermes, which is that machine's
 * and not this one's. A path, or a `file:` URL, loads only when a finished step of the chat named it,
 * as `openablePath` decides: from this computer when the chat runs here, and over ssh when it is an
 * HTML page on the ssh machine Hermes runs on.
 */
export function pageFor(request: string, { session, local, machine, host }: Reach): Verdict {
  const url = URL.parse(request)
  if (url !== null && isWebPage(request)) {
    return !local && LOOPBACK.test(url.hostname)
      ? { address: request, failed: `This page runs on ${machine}. Highwing can't reach that machine's localhost.` }
      : { address: request, page: { kind: 'web', url: request } }
  }
  const path = pathIn(request, url)
  const named = path === null || session === undefined ? null : openablePath(session, path)
  if (named === null) return null
  if (local) return { address: named, page: { kind: 'file', path: named } }
  return host !== null && PAGE_FILE.test(named) ? { address: named, page: { kind: 'ssh', host, path: named } } : { address: named, failed: `This file is on ${machine}.` }
}

const FAILURES: { readonly [code: number]: (host: string) => string } = {
  [-102]: host => `Nothing answered at ${host}.`,
  [-105]: host => `Highwing couldn't find ${host}.`,
  [-106]: () => "This computer isn't connected to the internet.",
  [-137]: host => `Highwing couldn't find ${host}.`
}

/** The words for a Chromium net error (net/base/net_error_list.h). */
export const failureOf = (code: number, description: string, address: string): string =>
  FAILURES[code]?.(URL.parse(address)?.host || address) ?? `This page didn't load (${description || `error ${code}`}).`

/**
 * The pane as main holds it. Hermes's label outranks the page's own title. `asked` is the request as
 * Hermes or the window put it, and `address` the page the view is on now. `file` is the path a
 * step named, when it is on this computer: what Open opens, wherever a page has gone since.
 * `painted`: the page has drawn once, so a reload keeps it in view. `table`: a CSV file, drawn by
 * the window in place of a page.
 */
export interface Pane {
  readonly layout: PaneLayout
  readonly asked: string
  readonly address: string
  readonly file: string | null
  readonly label: string | null
  readonly pageTitle: string | null
  readonly load: PageLoad
  readonly painted: boolean
  readonly table: Table | null
}

export type PaneEvent =
  | { readonly on: 'show'; readonly layout: PaneLayout; readonly asked: string; readonly address: string; readonly file: string | null; readonly label: string | null; readonly load: PageLoad }
  | { readonly on: 'navigated'; readonly address: string }
  | { readonly on: 'loading' }
  | { readonly on: 'loaded' }
  | { readonly on: 'failed'; readonly reason: string }
  | { readonly on: 'titled'; readonly title: string }
  | { readonly on: 'tabled'; readonly table: Table }
  | { readonly on: 'close' }

type Move<E extends PaneEvent['on']> = (pane: Pane, event: Extract<PaneEvent, { on: E }>) => Pane
const MOVES: { readonly [E in Exclude<PaneEvent['on'], 'show' | 'close'>]: Move<E> } = {
  navigated: (pane, { address }) => ({ ...pane, address }),
  loading: pane => ({ ...pane, load: { at: 'loading' } }),
  // A load that failed stays failed until the next one starts.
  loaded: pane => (pane.load.at === 'loading' ? { ...pane, load: { at: 'shown' }, painted: true } : pane),
  failed: (pane, { reason }) => ({ ...pane, load: { at: 'failed', reason } }),
  titled: (pane, { title }) => ({ ...pane, pageTitle: title.trim() === '' ? null : title }),
  tabled: (pane, { table }) => ({ ...pane, table, load: { at: 'shown' } })
}

export function nextPane(pane: Pane | null, event: PaneEvent): Pane | null {
  if (event.on === 'show') {
    const { layout, asked, address, file, label, load } = event
    return { layout, asked, address, file, label, pageTitle: null, load, painted: false, table: null }
  }
  if (pane === null || event.on === 'close') return null
  return (MOVES[event.on] as Move<typeof event.on>)(pane, event)
}

export const previewOf = (pane: Pane | null): Preview =>
  pane === null
    ? { state: 'closed' }
    : {
        state: 'open',
        layout: pane.layout,
        title: pane.label ?? pane.pageTitle ?? (pane.file === null ? pane.address : basename(pane.address)),
        address: pane.address,
        file: pane.file !== null,
        content: pane.table === null ? { kind: 'page', load: pane.load } : { kind: 'table', table: pane.table }
      }

/** Whether the page itself is drawn. A failed page gives its place to the reason, and a first load to the window's "Loading". */
export const pageInView = (pane: Pane | null): boolean => pane !== null && (pane.load.at === 'shown' || (pane.load.at === 'loading' && pane.painted))
