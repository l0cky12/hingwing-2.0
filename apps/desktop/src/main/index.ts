import { checkTarget, liveDialer, openHermes, remoteRoute, type Dialer, type Route } from '@highwing/hermes'
import type { Target } from '@highwing/hermes/domain'
import { loadFixture, recordingDialer, scriptedDialer } from '@highwing/hermes/testing'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { appendFileSync } from 'node:fs'
import { ownConnection, pinnedConnection } from './connection'
import { desktopOpener, recordingOpener } from './files'
import { serveWindows } from './ipc'
import { loadSettings, saveSettings } from './settings'
import { isAppUrl, openWindow } from './windows'

const { HIGHWING_FIXTURE, HIGHWING_FIXTURE_CALLS, HIGHWING_RECORD, HIGHWING_OPEN_LOG } = process.env
const fixture = HIGHWING_FIXTURE ? loadFixture(HIGHWING_FIXTURE) : null

const recorded = (dial: Dialer): Dialer => (HIGHWING_RECORD ? recordingDialer(dial, HIGHWING_RECORD) : dial)

const routeFor = (target: Target): Route => {
  const route = target.kind === 'local' ? { dial: liveDialer(), dispose: () => {} } : remoteRoute(target.host)
  return { ...route, dial: recorded(route.dial) }
}

// One instance per user-data directory: a second would open a second socket and race the first one's saves.
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus())

app.whenReady().then(async () => {
  const open = (dial: Dialer) => openHermes({ dial, client: { name: 'highwing', version: app.getVersion() } })
  const settingsDir = app.getPath('userData')
  const owner = fixture
    ? pinnedConnection(open(scriptedDialer(fixture, {
      timing: 'recorded',
      ...(HIGHWING_FIXTURE_CALLS ? { onReceived: (frame: unknown) => appendFileSync(HIGHWING_FIXTURE_CALLS, `${JSON.stringify(frame)}\n`) } : {})
    })))
    : ownConnection({ loaded: await loadSettings(settingsDir), save: target => saveSettings(settingsDir, target), check: checkTarget, routeFor, open })
  const opener = HIGHWING_OPEN_LOG ? recordingOpener(HIGHWING_OPEN_LOG) : desktopOpener(shell)
  const served = serveWindows(owner, ipcMain, isAppUrl, opener)
  openWindow()
  let closed: Promise<void> | null = null
  const close = () => (closed ??= (served.dispose(), owner.close()))
  app.on('window-all-closed', () => void close().finally(() => app.quit()))
  // A quit from the menu or the session never emits window-all-closed, and a check or an attach still running would outlive the app.
  app.on('will-quit', () => void close())
})
