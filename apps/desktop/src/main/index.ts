import { checkTarget, liveDialer, openHermes, remoteRoute, type Dialer, type Route } from '@highwing/hermes'
import type { Target } from '@highwing/hermes/domain'
import { loadFixture, recordingDialer, scriptedDialer } from '@highwing/hermes/testing'
import { app, ipcMain } from 'electron'
import { ownConnection, pinnedConnection } from './connection'
import { serveWindows } from './ipc'
import { loadSettings, saveSettings } from './settings'
import { isAppUrl, openWindow } from './windows'

const { HIGHWING_FIXTURE, HIGHWING_RECORD } = process.env
const fixture = HIGHWING_FIXTURE ? loadFixture(HIGHWING_FIXTURE) : null

const recorded = (dial: Dialer): Dialer => (HIGHWING_RECORD ? recordingDialer(dial, HIGHWING_RECORD) : dial)

const routeFor = (target: Target): Route => {
  const route = target.kind === 'local' ? { dial: liveDialer(), dispose: () => {} } : remoteRoute(target.host)
  return { ...route, dial: recorded(route.dial) }
}

app.whenReady().then(async () => {
  const open = (dial: Dialer) => openHermes({ dial, client: { name: 'highwing', version: app.getVersion() } })
  const settingsDir = app.getPath('userData')
  const owner = fixture
    ? pinnedConnection(open(scriptedDialer(fixture, { timing: 'recorded' })))
    : ownConnection({ loaded: await loadSettings(settingsDir), save: target => saveSettings(settingsDir, target), check: checkTarget, routeFor, open })
  const served = serveWindows(owner, ipcMain, isAppUrl)
  openWindow(fixture?.header.sessionId ?? null)
  let closed: Promise<void> | null = null
  const close = () => (closed ??= (served.dispose(), owner.close()))
  app.on('window-all-closed', () => void close().finally(() => app.quit()))
  // A quit from the menu or the session never emits window-all-closed, and a check or an attach still running would outlive the app.
  app.on('will-quit', () => void close())
})
