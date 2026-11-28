import { checkTarget, gatewaysByUrl, liveRoute, openHermes, pickedRoute, remoteRoute, sshRead, timeWay, type Dialer, type Hermes, type Route } from '@highwing/hermes'
import { byKind, type BotId, type GatewayUrl, type ServerId, type Servers, type Target } from '@highwing/hermes/domain'
import { fixtureLatency, fixtureCall, fixtureTranscribe, loadFixture, maskedFrame, recordingDialer, scriptedDialer } from '@highwing/hermes/testing'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, net, Notification, safeStorage, session, shell, type OpenDialogOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { version } from '../../package.json'
import { attachmentStore, ATTACHMENTS_DIR, desktopSources, HERMES_LIMITS } from './attachments'
import { ownConnection, pinnedConnection, refreshBotsOnFocus, type ConnectionOwner } from './connection'
import { ownIntro } from './intro'
import { desktopMenus, recordingMenus } from './context-menu'
import { seedDictionary } from './dictionary'
import { desktopOpener, recordingOpener, type Opener } from './files'
import { desktopImageDeps, fixtureImageDeps, imageLoader } from './images'
import { draftStore, DRAFTS_DIR } from './drafts'
import { serveWindows } from './ipc'
import { desktopCatalogDeps, fixtureCatalogDeps, pluginCatalog } from './plugin-catalog'
import { serveScreen } from './screen'
import { dbusSend, hasSecretService } from './keyring'
import { chatLinks } from './links'
import { ACCENT, APPEARANCE, MODE, NOTICES, ON_CLOSE, preferenceStore, SEND_KEY, SHOW_WORK, SIDEBAR_WIDTH, SNOOZES, SPELL_CHECK, THEME } from './preferences'
import { desktopNotifier, notify, recordingNotifier } from './notify'
import { installTray } from './tray'
import { choosePicture, pickPicture, readHead } from './picture'
import { previewPane, registerPageScheme } from './preview'
import { reachOf } from './preview-page'
import { dialogSaver, folderSaver } from './saves'
import { loadSettings, saveSettings } from './settings'
import { keyringSeal, signInStore, UNSEALED } from './sign-ins'
import { unreadStore, UNREAD_DIR } from './unread'
import { isAppUrl, openWindow } from './windows'
import dictionary from '../../dictionaries/en-US-10-2.bdic?asset'

const { HIGHWING_FIXTURE, HIGHWING_FIXTURE_CALLS, HIGHWING_FIXTURE_LATENCY_MS, HIGHWING_RECORD, HIGHWING_OPEN_LOG, HIGHWING_PICK_FILE, HIGHWING_PICK_FILES, HIGHWING_SAVE_DIR, HIGHWING_NOTIFY_LOG, HIGHWING_MENU_LOG, HIGHWING_MENU_PICK, HIGHWING_SIGN_IN_MS, HIGHWING_TEST_KEYRING, HIGHWING_TRAY_LOG } = process.env
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

/** A far page as ssh brings it: about as long as a dial's own wait. */
const REMOTE_READ_MS = 20_000

const recorded = (dial: Dialer): Dialer => (HIGHWING_RECORD ? recordingDialer(dial, HIGHWING_RECORD) : dial)

const addressesOf = (target: Target) => byKind<readonly GatewayUrl[]>(target, { local: () => [], remote: () => [], ssh: () => [], url: ({ url }) => [url] })
/** Every gateway address a saved server can be reached at, so a sign-in is kept for as long as a way needs it. */
const addressesIn = ({ list }: Servers) => list.flatMap(({ ways }) => ways.flatMap(addressesOf))

async function savedConnection(settingsDir: string, opener: Opener, open: (dial: Dialer, place: string) => Hermes, armIntro: () => Promise<void>): Promise<ConnectionOwner> {
  // An installed build takes neither variable: one would keep sign-ins unsealed, the other would cut a real sign-in short.
  const verifying = !app.isPackaged
  const signInMs = verifying && /^[1-9]\d*$/.test(HIGHWING_SIGN_IN_MS ?? '') ? Number(HIGHWING_SIGN_IN_MS) : null
  const keep = signInStore(settingsDir, async () => (verifying && HIGHWING_TEST_KEYRING ? UNSEALED : keyringSeal(safeStorage, process.platform)))
  const gateways = gatewaysByUrl({ keep, browse: opener.browse, ...(signInMs === null ? {} : { signInMs }) })

  const routeOf = (target: Target): Route => {
    const route = byKind<Route>(target, {
      local: () => liveRoute(),
      remote: ({ host }) => remoteRoute(host),
      ssh: ({ host }) => remoteRoute(host),
      url: ({ url }) => gateways.route(url)
    })
    return { ...route, dial: recorded(route.dial) }
  }

  const loaded = await loadSettings(settingsDir)
  // A file this build cannot read may name an address, so its sign-in stays until a save replaces the file.
  if (loaded.state === 'saved') await gateways.keepOnly(addressesIn(loaded.servers))
  if (loaded.state === 'none') await gateways.keepOnly([])
  return ownConnection({
    loaded,
    save: async servers => {
      await saveSettings(settingsDir, servers)
      await gateways.keepOnly(addressesIn(servers))
    },
    check: (target, options) => checkTarget(target, { ...options, gateways }),
    routeFor: (server, onPick) => pickedRoute(server, target => ({ target, route: routeOf(target), time: signal => timeWay(target, { signal }) }), onPick),
    newId: () => randomUUID() as ServerId,
    open,
    armIntro
  })
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
seedDictionary(dictionary, app.getPath('sessionData'))

app.whenReady().then(async () => {
  const opener = HIGHWING_OPEN_LOG ? recordingOpener(HIGHWING_OPEN_LOG) : desktopOpener(shell)
  const pane = previewPane({
    opener, isAppUrl,
    reach: session => reachOf(owner.setup.get(), session),
    readRemote: (host, path) => sshRead(host, path, { deadlineMs: REMOTE_READ_MS, signal: new AbortController().signal })
  })
  const settingsDir = app.getPath('userData')
  const attachments = attachmentStore(join(settingsDir, ATTACHMENTS_DIR), { ...HERMES_LIMITS, ...fixture?.header.attachLimits })
  const drafts = draftStore(join(settingsDir, DRAFTS_DIR))
  const mode = await preferenceStore(settingsDir, MODE)
  const theme = await preferenceStore(settingsDir, THEME)
  const accent = await preferenceStore(settingsDir, ACCENT)
  const sidebarWidth = await preferenceStore(settingsDir, SIDEBAR_WIDTH)
  const sendKey = await preferenceStore(settingsDir, SEND_KEY)
  const showWork = await preferenceStore(settingsDir, SHOW_WORK)
  const spellCheck = await preferenceStore(settingsDir, SPELL_CHECK)
  const snoozes = await preferenceStore(settingsDir, SNOOZES)
  const notices = await preferenceStore(settingsDir, NOTICES)
  const intro = await ownIntro(settingsDir)
  const onClose = await preferenceStore(settingsDir, ON_CLOSE)
  const appearance = await preferenceStore(settingsDir, APPEARANCE)
  nativeTheme.themeSource = theme.get()
  theme.subscribe(source => (nativeTheme.themeSource = source))
  session.defaultSession.setSpellCheckerEnabled(spellCheck.get())
  spellCheck.subscribe(on => session.defaultSession.setSpellCheckerEnabled(on))
  await attachments.sweep(new Set((await drafts.load()).flatMap(draft => draft.attachments.map(held => held.id))))
  const unread = unreadStore(join(settingsDir, UNREAD_DIR))
  // Unpackaged Electron reports its own version. The desktop package is the app version.
  const open = (dial: Dialer, place: string) => openHermes({
    dial, client: { name: 'highwing', version }, onPane: pane.ask, uploads: attachments,
    unread: { chats: unread.load(place), keep: chats => unread.keep(place, chats) }
  })
  const played = fixture && scriptedDialer(fixture, {
    timing: 'recorded', latencyMs: fixtureLatency(HIGHWING_FIXTURE_LATENCY_MS),
    ...(HIGHWING_FIXTURE_CALLS ? { onReceived: (frame: unknown) => appendFileSync(HIGHWING_FIXTURE_CALLS, `${JSON.stringify(maskedFrame(frame))}\n`) } : {})
  })
  const owner = fixture && played
    ? pinnedConnection(open(played, 'fixture'), fixtureCall(fixture.header, played.rules), fixtureTranscribe(fixture.header.transcribe))
    : await savedConnection(settingsDir, opener, open, intro.armIntro)
  pane.follow(owner.setup)
  const pictureDeps = { choose: pictureFile, read: readHead, set: (bot: BotId, data: string) => owner.run({ do: 'setBotPicture', bot, data }) }
  const sources = desktopSources({ dialog, clipboard, focused: () => BrowserWindow.getFocusedWindow() }, HIGHWING_PICK_FILES)
  const images = imageLoader(fixture ? fixtureImageDeps(fixture.header.media) : desktopImageDeps(net))
  const saver = HIGHWING_SAVE_DIR ? folderSaver(HIGHWING_SAVE_DIR) : dialogSaver(dialog, () => app.getPath('downloads'))
  const served = serveWindows(
    owner, ipcMain, isAppUrl, opener, images, drafts, pane, { pick: (bot, live) => pickPicture(pictureDeps, bot, live), choose: () => choosePicture(pictureDeps) },
    { store: attachments, sources }, saver, { mode, theme, accent, sidebarWidth, sendKey, showWork, spellCheck, snoozes, notices, onClose, appearance }, intro,
    pluginCatalog(fixture ? fixtureCatalogDeps(fixture.header.pluginCatalog) : desktopCatalogDeps(net))
  )
  const stopScreen = serveScreen(owner, ipcMain, isAppUrl)
  const stopNotices = notify(owner, intro.intro, {
    notifier: HIGHWING_NOTIFY_LOG ? recordingNotifier(HIGHWING_NOTIFY_LOG) : desktopNotifier(Notification),
    focused: () => BrowserWindow.getFocusedWindow() !== null,
    raise,
    kinds: () => notices.get()
  })
  const window = openWindow(opener, pane, HIGHWING_MENU_LOG ? recordingMenus(HIGHWING_MENU_LOG, HIGHWING_MENU_PICK) : desktopMenus(Menu))
  const stopTray = installTray(window, owner, onClose, raise, HIGHWING_TRAY_LOG)
  const stopLinks = links.serve(owner, intro.intro, raise)
  const stopRefresh = refreshBotsOnFocus(app, owner)
  let closed: Promise<void> | null = null
  const close = () => (closed ??= (served.dispose(), stopScreen(), stopNotices(), stopLinks(), stopRefresh(), stopTray(), Promise.all([owner.close(), drafts.settled(), unread.settled(), mode.settled(), theme.settled(), accent.settled(), sidebarWidth.settled(), sendKey.settled(), showWork.settled(), spellCheck.settled(), snoozes.settled(), notices.settled(), onClose.settled(), appearance.settled(), intro.settled()]).then(() => {})))
  app.on('window-all-closed', () => void close().finally(() => app.quit()))
  // A quit from the menu or the session never emits window-all-closed, and a check or an attach still running would outlive the app.
  // Electron does not wait for a will-quit listener, so the quit is held until a draft or a preference still being written is on disk.
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
