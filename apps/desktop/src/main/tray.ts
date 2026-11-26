import type { Hermes } from '@highwing/hermes'
import type { Sidebar, SidebarRow } from '@highwing/hermes/domain'
import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import { appendFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { OnClose } from '../ipc-contract'
import type { ConnectionOwner } from './connection'
import { TRAY_ICON_PNG } from './tray-icon'
import { decideClose, trayView, type TrayAction, type TrayItem, type TrayView } from './tray-view'

const SCALE = 2
const CELL = 3
const GLYPHS = [
  '111101101101111',
  '010110010010111',
  '111001111100111',
  '111001111001111',
  '101101111001001',
  '111100111001111',
  '111100111101111',
  '111001001001001',
  '111101111101111',
  '111101111001111'
]

function record(logPath: string | undefined, line: unknown, png: Buffer | null): void {
  if (logPath === undefined) return
  try {
    appendFileSync(logPath, `${JSON.stringify(line)}\n`)
    if (png !== null) writeFileSync(join(dirname(logPath), 'tray-icon.png'), png)
  } catch {
    return
  }
}

function drawCount(bitmap: Buffer, width: number, height: number, count: number): void {
  const digits = String(count)
  const box = CELL * SCALE
  const gap = SCALE
  const span = digits.length * box + (digits.length - 1) * gap
  const originX = width - 1 - span
  const originY = height - 1 - box
  const ink = new Set<number>()
  for (let index = 0; index < digits.length; index++) {
    const glyph = GLYPHS[Number(digits[index])]
    if (glyph === undefined) continue
    const ox = originX + index * (box + gap)
    for (let i = 0; i < glyph.length; i++) {
      if (glyph[i] !== '1') continue
      const col = i % CELL
      const row = Math.floor(i / CELL)
      for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) {
        const x = ox + col * SCALE + dx
        const y = originY + row * SCALE + dy
        if (x >= 0 && y >= 0 && x < width && y < height) ink.add(y * width + x)
      }
    }
  }
  // nativeImage.toBitmap() is BGRA, so the fourth byte is opacity. White and black do not care which channel is which.
  const put = (x: number, y: number, byte: number) => {
    const at = (y * width + x) * 4
    bitmap[at] = byte
    bitmap[at + 1] = byte
    bitmap[at + 2] = byte
    bitmap[at + 3] = 255
  }
  for (const at of ink) {
    const x = at % width
    const y = (at - x) / width
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || ink.has(ny * width + nx)) continue
      put(nx, ny, 0)
    }
  }
  for (const at of ink) put(at % width, (at - (at % width)) / width, 255)
}

function icon(bytes: Buffer, count: number): Electron.NativeImage {
  const base = nativeImage.createFromBuffer(bytes)
  if (count <= 0 || base.isEmpty()) return base
  const { width, height } = base.getSize()
  const bitmap = Buffer.from(base.toBitmap())
  if (bitmap.length !== width * height * 4) return base
  drawCount(bitmap, width, height, count)
  return nativeImage.createFromBitmap(bitmap, { width, height })
}

function created(logPath: string | undefined): { readonly tray: Tray; readonly bytes: Buffer } | null {
  try {
    return { tray: new Tray(icon(TRAY_ICON_PNG, 0)), bytes: TRAY_ICON_PNG }
  } catch {
    record(logPath, { tray: 'down' }, null)
    return null
  }
}

function menuOf(items: readonly TrayItem[], act: (action: TrayAction) => void): Electron.Menu {
  return Menu.buildFromTemplate(items.map(item => (
    item.kind === 'separator' ? { type: 'separator' as const } : { label: item.label, click: () => act(item.action) }
  )))
}

export function installTray(
  window: BrowserWindow,
  owner: Pick<ConnectionOwner, 'setup' | 'hermes' | 'run'>,
  onClose: { readonly get: () => OnClose; subscribe(listener: (value: OnClose) => void): () => void },
  raise: () => void,
  logPath: string | undefined
): () => void {
  const opened = created(logPath)
  if (opened === null) return () => {}
  const { tray, bytes } = opened

  const act = (action: TrayAction) => {
    if (action.do === 'quit') {
      app.quit()
      return
    }
    raise()
    if (action.do === 'open') void owner.run({ do: 'open', ref: { kind: 'chat', sessionId: action.sessionId } })
  }

  const apply = (view: TrayView) => {
    const image = icon(bytes, view.count)
    tray.setImage(image)
    tray.setToolTip(view.tooltip)
    tray.setContextMenu(menuOf(view.items, act))
    const labels = view.items.flatMap(item => (item.kind === 'action' ? [item.label] : []))
    const decision = decideClose({ preference: onClose.get(), trayAlive: true, intent: 'window' })
    record(logPath, { tray: 'up', count: view.count, tooltip: view.tooltip, labels, decision }, image.toPNG())
  }

  let rows: readonly Pick<SidebarRow, 'id' | 'title' | 'badge'>[] = []
  const show = (next: readonly Pick<SidebarRow, 'id' | 'title' | 'badge'>[]) => {
    rows = next
    apply(trayView(rows))
  }
  const bind = (hermes: Hermes | null) => {
    if (hermes === null) {
      show([])
      return () => {}
    }
    show(hermes.sidebar.get().rows)
    return hermes.sidebar.subscribe((sidebar: Sidebar) => show(sidebar.rows))
  }

  let hermes = owner.hermes
  let unbind = bind(hermes)
  const unfollow = owner.setup.subscribe(() => {
    if (owner.hermes === hermes) return
    unbind()
    hermes = owner.hermes
    unbind = bind(hermes)
  })
  const unprefer = onClose.subscribe(() => apply(trayView(rows)))

  let intent: 'window' | 'quit' = 'window'
  // before-quit is emitted before the window's close, so Quit and a session quit are not hidden.
  const markQuit = () => { intent = 'quit' }
  const onWindowClose = (event: Electron.Event) => {
    if (decideClose({ preference: onClose.get(), trayAlive: true, intent }) !== 'hide') return
    event.preventDefault()
    window.hide()
  }
  app.on('before-quit', markQuit)
  window.on('close', onWindowClose)

  return () => {
    unfollow()
    unbind()
    unprefer()
    app.removeListener('before-quit', markQuit)
    if (!window.isDestroyed()) window.removeListener('close', onWindowClose)
    tray.destroy()
  }
}
