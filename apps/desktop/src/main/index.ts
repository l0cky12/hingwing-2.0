import { liveDialer, openHermes, type Dialer } from '@highwing/hermes'
import { loadFixture, recordingDialer, scriptedDialer } from '@highwing/hermes/testing'
import { app, ipcMain } from 'electron'
import { serveWindows } from './ipc'
import { isAppUrl, openWindow } from './windows'

const { HIGHWING_FIXTURE, HIGHWING_RECORD } = process.env
const fixture = HIGHWING_FIXTURE ? loadFixture(HIGHWING_FIXTURE) : null

const dial: Dialer = fixture
  ? scriptedDialer(fixture, { timing: 'recorded' })
  : HIGHWING_RECORD
    ? recordingDialer(liveDialer(), HIGHWING_RECORD)
    : liveDialer()

app.whenReady().then(() => {
  const hermes = openHermes({ dial, client: { name: 'highwing', version: app.getVersion() } })
  const served = serveWindows(hermes, ipcMain, isAppUrl)
  openWindow(fixture?.header.sessionId ?? null)
  app.on('window-all-closed', () => {
    served.dispose()
    void hermes.close().finally(() => app.quit())
  })
})
