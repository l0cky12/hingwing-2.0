import { liveDialer, openHermes, type Dialer } from '@highwing/hermes'
import { loadFixture, recordingDialer, scriptedDialer } from '@highwing/hermes/testing'
import { app, ipcMain, shell } from 'electron'
import { desktopOpener, recordingOpener } from './files'
import { serveWindows } from './ipc'
import { isAppUrl, openWindow } from './windows'

const { HIGHWING_FIXTURE, HIGHWING_RECORD, HIGHWING_OPEN_LOG } = process.env
const fixture = HIGHWING_FIXTURE ? loadFixture(HIGHWING_FIXTURE) : null

const dial: Dialer = fixture
  ? scriptedDialer(fixture, { timing: 'recorded' })
  : HIGHWING_RECORD
    ? recordingDialer(liveDialer(), HIGHWING_RECORD)
    : liveDialer()

app.whenReady().then(() => {
  const hermes = openHermes({ dial, client: { name: 'highwing', version: app.getVersion() } })
  const opener = HIGHWING_OPEN_LOG ? recordingOpener(HIGHWING_OPEN_LOG) : desktopOpener(shell)
  const served = serveWindows(hermes, ipcMain, isAppUrl, opener)
  openWindow(fixture?.header.sessionId ?? null)
  app.on('window-all-closed', () => {
    served.dispose()
    void hermes.close().finally(() => app.quit())
  })
})
