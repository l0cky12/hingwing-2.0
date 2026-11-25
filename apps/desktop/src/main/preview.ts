import type { Feed } from '@highwing/hermes'
import type { CommandOutcome, PaneAsk, Session } from '@highwing/hermes/domain'
import { net, protocol, session as sessions, WebContentsView, type BrowserWindow, type Session as WebSession } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import type { Preview, PreviewCommand, Rect, Setup } from '../ipc-contract'
import type { Opener } from './files'
import {
  failureOf, nextPane, PAGE_SCHEME, pageFor, pageInView, pageUrlOf, pathOfPageUrl, previewOf, servedPath, type Page, type Pane, type PaneEvent, type Reach
} from './preview-page'

/** The pane beside the chat: one page at a time, drawn by main in a view of its own over the window. */
export interface PreviewPane {
  readonly preview: Feed<Preview>
  /** A web URL, a path or a `file:` URL, judged against the chat that named it. false: refused, and the pane is as it was. */
  show(request: string, label: string | null, session: Session | undefined): boolean
  ask(ask: PaneAsk, from: Session): void
  run(command: PreviewCommand): Promise<CommandOutcome<void>>
  attach(window: BrowserWindow): void
  /** A new connection closes the pane: its pages belong to the old one. */
  follow(setup: Feed<Setup>): void
}

export interface PreviewDeps {
  readonly opener: Pick<Opener, 'browse'>
  reach(session: Session | undefined): Reach
  isAppUrl(url: string): boolean
}

const DONE = { ok: true, value: undefined } as const
const ABORTED = -3
const NAVIGABLE: ReadonlySet<string> = new Set(['http:', 'https:', `${PAGE_SCHEME}:`])
const MISSING = "This file isn't there any more."

/** Before the app is ready, as Electron asks: a standard scheme resolves a page's relative links. */
export const registerPageScheme = () =>
  protocol.registerSchemesAsPrivileged([{ scheme: PAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])

let configured: WebSession | null = null

/**
 * In memory, so nothing a page stores outlives the app. A page asks for no permission, download or
 * window that it gets. `filePage` is the file page shown, which decides what the page scheme serves.
 */
function previewSession(filePage: () => string | null): WebSession {
  if (configured !== null) return configured
  const session = sessions.fromPartition('highwing-preview')
  session.setPermissionRequestHandler((_contents, _permission, answer) => answer(false))
  session.setPermissionCheckHandler(() => false)
  session.on('will-download', event => event.preventDefault())
  session.protocol.handle(PAGE_SCHEME, async request => {
    const page = filePage()
    const path = pathOfPageUrl(request.url)
    const served = page === null || path === null ? null : await servedPath(page, path, homedir())
    return served === null ? new Response(null, { status: 404 }) : net.fetch(pathToFileURL(served).href)
  })
  configured = session
  return session
}

const epochOf = (setup: Setup) => (setup.at === 'pinned' ? 0 : setup.live?.epoch ?? null)

export function previewPane(deps: PreviewDeps): PreviewPane {
  let window: BrowserWindow | null = null
  let view: WebContentsView | null = null
  let pane: Pane | null = null
  let filePage: string | null = null
  /** Shows the last request again, for a Reload with no page in view to reload, as after a missing file. */
  let retry: (() => void) | null = null
  let rect: Rect | null = null
  let value: Preview = previewOf(null)
  const listeners = new Set<(value: Preview) => void>()

  const place = () => {
    if (view === null) return
    const at = rect !== null && rect.width > 0 && rect.height > 0 && pageInView(pane) ? rect : null
    if (at !== null) view.setBounds(at)
    view.setVisible(at !== null)
  }

  const apply = (event: PaneEvent) => {
    pane = nextPane(pane, event)
    const next = previewOf(pane)
    place()
    if (JSON.stringify(next) === JSON.stringify(value)) return
    value = next
    for (const listener of [...listeners]) listener(next)
  }

  /** The next page starts in a fresh view, with nothing of the last one's history or script. */
  const drop = () => {
    if (view === null) return
    window?.contentView.removeChildView(view)
    view.webContents.close()
    view = null
  }

  const load = (page: Page) => {
    drop()
    filePage = page.kind === 'file' ? page.path : null
    const created = new WebContentsView({ webPreferences: { session: previewSession(() => filePage), sandbox: true, contextIsolation: true, nodeIntegration: false } })
    const contents = created.webContents
    const own = <A extends unknown[]>(act: (...args: A) => void) => (...args: A) => {
      if (view === created) act(...args)
    }
    const loaded = own(() => apply({ on: 'loaded' }))
    const stay = (event: Electron.Event<{ url: string }>) => {
      if (!NAVIGABLE.has(URL.parse(event.url)?.protocol ?? '') || deps.isAppUrl(event.url)) event.preventDefault()
    }
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', stay)
    contents.on('will-redirect', stay)
    contents.on('did-start-navigation', own(details => {
      if (details.isMainFrame && !details.isSameDocument) apply({ on: 'loading' })
    }))
    const navigated = (url: string) => apply({ on: 'navigated', address: pathOfPageUrl(url) ?? url })
    contents.on('did-navigate', own((_event, url) => navigated(url)))
    contents.on('did-navigate-in-page', own((_event, url, isMainFrame) => {
      if (isMainFrame) navigated(url)
    }))
    contents.on('dom-ready', loaded)
    contents.on('did-finish-load', loaded)
    contents.on('did-fail-load', own((_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== ABORTED) apply({ on: 'failed', reason: failureOf(code, description, url) })
    }))
    contents.on('page-title-updated', own((_event, title) => apply({ on: 'titled', title })))
    contents.on('render-process-gone', own(() => apply({ on: 'failed', reason: 'This page stopped working. Reload to try again.' })))
    view = created
    created.setVisible(false)
    window?.contentView.addChildView(created)
    void contents.loadURL(page.kind === 'web' ? page.url : pageUrlOf(page.path)).catch(() => {})
  }

  const show: PreviewPane['show'] = (request, label, session) => {
    const verdict = pageFor(request, deps.reach(session))
    if (verdict === null) return false
    retry = () => show(request, label, session)
    if ('page' in verdict && (verdict.page.kind === 'web' || existsSync(verdict.page.path))) {
      apply({ on: 'show', asked: request, address: verdict.address, label, load: { at: 'loading' } })
      load(verdict.page)
    } else {
      drop()
      apply({ on: 'show', asked: request, address: verdict.address, label, load: { at: 'failed', reason: 'failed' in verdict ? verdict.failed : MISSING } })
    }
    return true
  }

  const close = () => {
    retry = null
    drop()
    apply({ on: 'close' })
  }

  const COMMANDS: { readonly [K in PreviewCommand['do']]: (command: Extract<PreviewCommand, { do: K }>) => unknown } = {
    preview: ({ url }) => show(url, null, undefined),
    browse: ({ url }) => deps.opener.browse(url),
    reloadPreview: () => (view === null ? retry?.() : view.webContents.reload()),
    closePreview: close,
    placePreview: ({ rect: next }) => {
      rect = next
      place()
    }
  }

  return {
    preview: {
      get: () => value,
      subscribe: listener => {
        listeners.add(listener)
        return () => void listeners.delete(listener)
      }
    },
    show,
    ask: (ask, from) => {
      if (ask.do === 'open') show(ask.url, ask.label, from)
      else if (ask.url === null || ask.url === pane?.asked || ask.url === pane?.address) close()
    },
    run: async command => {
      await (COMMANDS[command.do] as (command: PreviewCommand) => unknown)(command)
      return DONE
    },
    attach: opened => {
      window = opened
      opened.on('closed', () => {
        window = null
        close()
      })
    },
    follow: setup => {
      let epoch = epochOf(setup.get())
      setup.subscribe(next => {
        if (epochOf(next) === epoch) return
        epoch = epochOf(next)
        close()
      })
    }
  }
}
