import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [page, ...screens] = process.argv.slice(process.argv.indexOf('--') + 1)
if (page === undefined || screens.length === 0) {
  console.error('usage: electron capture.mjs -- <page.html> <screen>[@<width>x<height>] ...')
  process.exit(2)
}
const pagePath = resolve(page)
const FREEZE = '*, *::before, *::after { animation-delay: -0.45s !important; animation-play-state: paused !important; }'

app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  for (const spec of screens) {
    const [name, size = '1180x860'] = spec.split('@')
    const [width, height] = size.split('x').map(Number)
    const win = new BrowserWindow({ width, height, useContentSize: true, show: false, webPreferences: { offscreen: false } })
    await win.loadURL(`${pathToFileURL(pagePath).href}#${name}`)
    await win.webContents.insertCSS(FREEZE)
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => [...document.fonts].filter(f => f.status === "loaded").map(f => f.family + " " + f.weight))')
      .then(fonts => console.log(`${name}: fonts ${[...new Set(fonts)].join(', ')}`))
    const [w, h] = await win.webContents.executeJavaScript('[innerWidth, innerHeight]')
    const out = join(dirname(pagePath), `${name}.png`)
    writeFileSync(out, (await win.webContents.capturePage()).toPNG())
    console.log(`${name}: ${w}x${h} -> ${out}`)
    win.destroy()
  }
  app.quit()
}).catch(error => {
  console.error(error)
  app.exit(1)
})
