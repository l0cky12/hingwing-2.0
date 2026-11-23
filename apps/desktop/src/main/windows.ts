import type { SessionId } from '@highwing/hermes/domain'
import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isWebLink, SESSION_PARAM } from '../ipc-contract'

const INDEX_HTML = join(import.meta.dirname, '../renderer/index.html')
const DEV_URL = process.env.ELECTRON_RENDERER_URL

export const isAppUrl = (url: string) => {
  const page = url.split(/[?#]/)[0]
  return DEV_URL ? page === new URL(DEV_URL).href : page === pathToFileURL(INDEX_HTML).href
}

/** The content size design C was drawn and reviewed at. */
const DESIGN_SIZE = { width: 1180, height: 860 } as const
/** Leaves the chat 392 px beside the 288 px bots column, which its compact layout fits. */
const MIN_WIDTH = 680

export function openWindow(sessionId: SessionId | null): BrowserWindow {
  const window = new BrowserWindow({
    ...DESIGN_SIZE, minWidth: MIN_WIDTH, useContentSize: true,
    title: 'Highwing', backgroundColor: '#E8EBE4',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebLink(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', event => event.preventDefault())
  const query: Record<string, string> = sessionId === null ? {} : { [SESSION_PARAM]: sessionId }
  if (DEV_URL) void window.loadURL(`${DEV_URL}?${new URLSearchParams(query)}`)
  else void window.loadFile(INDEX_HTML, { query })
  return window
}
