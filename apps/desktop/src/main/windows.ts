import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isWebLink } from '../ipc-contract'
import { attachContextMenu, type ShowMenu } from './context-menu'
import type { Opener } from './files'
import type { PreviewPane } from './preview'

const INDEX_HTML = join(import.meta.dirname, '../renderer/index.html')
const DEV_URL = process.env.ELECTRON_RENDERER_URL

export const isAppUrl = (url: string) => {
  const page = url.split(/[?#]/)[0]
  return DEV_URL ? page === new URL(DEV_URL).href : page === pathToFileURL(INDEX_HTML).href
}

/** The content size design C was drawn and reviewed at. */
const DESIGN_SIZE = { width: 1180, height: 860 } as const

const APP_CSS_PAPER = { light: '#F7F7F8', dark: '#15161A' } as const
const paper = () => APP_CSS_PAPER[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']

export function openWindow(opener: Pick<Opener, 'browse'>, pane: Pick<PreviewPane, 'attach'>, show: ShowMenu): BrowserWindow {
  const window = new BrowserWindow({
    ...DESIGN_SIZE, useContentSize: true,
    title: 'Highwing', backgroundColor: paper(),
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebLink(url)) void opener.browse(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', event => event.preventDefault())
  const repaint = () => window.setBackgroundColor(paper())
  nativeTheme.on('updated', repaint)
  window.once('closed', () => nativeTheme.off('updated', repaint))
  attachContextMenu(window, show)
  pane.attach(window)
  if (DEV_URL) void window.loadURL(DEV_URL)
  else void window.loadFile(INDEX_HTML)
  return window
}
