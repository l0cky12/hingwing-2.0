// The browser of a verify run: one window for Hermes's sign-in page. Its session is in memory, so no cookie outlives it.
import { app, BrowserWindow } from 'electron'

app.on('window-all-closed', () => app.quit())
// No top-level await: Electron holds `ready` until this module has loaded, so awaiting `ready` here would never end.
void app.whenReady().then(() => new BrowserWindow({ width: 900, height: 760, webPreferences: { partition: 'sign-in' } }).loadURL('about:blank'))
