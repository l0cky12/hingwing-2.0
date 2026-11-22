import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1180, height: 860, useContentSize: true,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), sandbox: true, contextIsolation: true }
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
