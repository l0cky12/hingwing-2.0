import { checkTarget, liveDialer, openHermes, remoteRoute, type Dialer, type Route } from '@highwing/hermes'
import { byKind, type BotId, type Target } from '@highwing/hermes/domain'
import { loadFixture, maskedFrame, recordingDialer, scriptedDialer } from '@highwing/hermes/testing'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, Notification, shell, type OpenDialogOptions } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { attachmentStore, ATTACHMENTS_DIR, desktopSources, HERMES_LIMITS } from './attachments'
import { ownConnection, pinnedConnection } from './connection'
import { desktopMenus, recordingMenus } from './context-menu'
import { desktopOpener, recordingOpener } from './files'
import { desktopImageDeps, fixtureImageDeps, imageLoader } from './images'
import { draftStore, DRAFTS_DIR } from './drafts'
import { serveWindows } from './ipc'
import { dbusSend, hasSecretService } from './keyring'
import { chatLinks } from './links'
import { modeStore } from './mode'
import { desktopNotifier, notifyTurnEnds, recordingNotifier } from './notify'
import { choosePicture, pickPicture, readHead } from './picture'
import { previewPane, registerPageScheme } from './preview'
import { reachOf } from './preview-page'
import { dialogSaver, folderSaver } from './saves'
import { loadSettings, saveSettings } from './settings'
import { isAppUrl, openWindow } from './windows'

const { HIGHWING_FIXTURE, HIGHWING_FIXTURE_CALLS, HIGHWING_RECORD, HIGHWING_OPEN_LOG, HIGHWING_PICK_FILE, HIGHWING_PICK_FILES, HIGHWING_SAVE_DIR, HIGHWING_NOTIFY_LOG, HIGHWING_MENU_LOG, HIGHWING_MENU_PICK } = process.env
const fixture = HIGHWING_FIXTURE ? loadFixture(HIGHWING_FIXTURE) : null

const PICTURE_DIALOG: OpenDialogOptions = {
  title: 'Choose a picture', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
}

async function pictureFile(): Promise<string | null> {
  if (HIGHWING_PICK_FILE) return HIGHWING_PICK_FILE
  const window = BrowserWindow.getFocusedWindow()
  const { canceled, filePaths: [path] } = await (window === null ? dialog.showOpenDialog(PICTURE_DIALOG) : dialog.showOpenDialog(window, PICTURE_DIALOG))
  return canceled ? null : path ?? null
}

const recorded = (dial: Dialer): Dialer => (HIGHWING_RECORD ? recordingDialer(dial, HIGHWING_RECORD) : dial)

const routeFor = (target: Target): Route => {
  const route = byKind<Route>(target, { local: () => ({ dial: liveDialer(), dispose: () => {} }), remote: ({ host }) => remoteRoute(host) })
  return { ...route, dial: recorded(route.dial) }
}

const raise = () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (window === undefined) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

const links = chatLinks()
// One instance per user-data directory: a second would open a second socket and race the first one's saves.
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', (_event, argv) => {
  raise()
  links.holdLatest(argv)
})
app.on('open-url', (event, url) => {
  event.preventDefault()
  links.holdLatest([url])
})
links.holdLatest(process.argv)
// Chromium picks a keyring by the desktop's name, and takes none on a desktop it does not know, even where a Secret Service runs.
if (process.platform === 'linux' && fixture === null && !app.commandLine.hasSwitch('password-store') && hasSecretService(dbusSend(process.env))) {
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret')
}
// Only an installed build claims the scheme: a dev or verify run would point the user's desktop at a build that goes away.
if (app.isPackaged) app.setAsDefaultProtocolClient('highwing')

registerPageScheme()

app.whenReady().then(async () => {
  const opener = HIGHWING_OPEN_LOG ? recordingOpener(HIGHWING_OPEN_LOG) : desktopOpener(shell)
  const pane = previewPane({ opener, isAppUrl, reach: session => reachOf(owner.setup.get(), session) })
  const settingsDir = app.getPath('userData')
  const attachments = attachmentStore(join(settingsDir, ATTACHMENTS_DIR), { ...HERMES_LIMITS, ...fixture?.header.attachLimits })
  const drafts = draftStore(join(settingsDir, DRAFTS_DIR))
  const mode = await modeStore(settingsDir)
  await attachments.sweep(new Set((await drafts.load()).flatMap(draft => draft.attachments.map(held => held.id))))
  const open = (dial: Dialer) => openHermes({ dial, client: { name: 'highwing', version: app.getVersion() }, onPane: pane.ask, uploads: attachments })
  const owner = fixture
    ? pinnedConnection(open(scriptedDialer(fixture, {
      timing: 'recorded',
      ...(HIGHWING_FIXTURE_CALLS ? { onReceived: (frame: unknown) => appendFileSync(HIGHWING_FIXTURE_CALLS, `${JSON.stringify(maskedFrame(frame))}\n`) } : {})
    })))
    : ownConnection({ loaded: await loadSettings(settingsDir), save: target => saveSettings(settingsDir, target), check: checkTarget, routeFor, open })
  pane.follow(owner.setup)
  const pictureDeps = { choose: pictureFile, read: readHead, set: (bot: BotId, data: string) => owner.run({ do: 'setBotPicture', bot, data }) }
  const sources = desktopSources({ dialog, clipboard, focused: () => BrowserWindow.getFocusedWindow() }, HIGHWING_PICK_FILES)
  const images = imageLoader(fixture ? fixtureImageDeps(fixture.header.media) : desktopImageDeps(net))
  const saver = HIGHWING_SAVE_DIR ? folderSaver(HIGHWING_SAVE_DIR) : dialogSaver(dialog, () => app.getPath('downloads'))
  const served = serveWindows(
    owner, ipcMain, isAppUrl, opener, images, drafts, pane, { pick: bot => pickPicture(pictureDeps, bot), choose: () => choosePicture(pictureDeps) },
    { store: attachments, sources }, saver, mode
  )
  const stopNotices = notifyTurnEnds(owner, {
    notifier: HIGHWING_NOTIFY_LOG ? recordingNotifier(HIGHWING_NOTIFY_LOG) : desktopNotifier(Notification),
    focused: () => BrowserWindow.getFocusedWindow() !== null,
    raise
  })
  openWindow(opener, pane, HIGHWING_MENU_LOG ? recordingMenus(HIGHWING_MENU_LOG, HIGHWING_MENU_PICK) : desktopMenus(Menu))
  const stopLinks = links.serve(owner, raise)
  let closed: Promise<void> | null = null
  const close = () => (closed ??= (served.dispose(), stopNotices(), stopLinks(), Promise.all([owner.close(), drafts.settled(), mode.settled()]).then(() => {})))
  app.on('window-all-closed', () => void close().finally(() => app.quit()))
  // A quit from the menu or the session never emits window-all-closed, and a check or an attach still running would outlive the app.
  // Electron does not wait for a will-quit listener, so the quit is held until a draft or the mode still being written is on disk.
  let settled = false
  app.on('will-quit', event => {
    if (settled) return
    event.preventDefault()
    void close().finally(() => {
      settled = true
      app.quit()
    })
  })
})
