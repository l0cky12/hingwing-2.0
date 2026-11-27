import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import { CHANNEL, SCREEN_PORT, type Bridge, type Push } from '../ipc-contract'

const subscribers = new Map<number, (push: Push) => void>()
let lastId = 0

ipcRenderer.on(CHANNEL.push, (_event, id: number, push: Push) => subscribers.get(id)?.(push))
// A MessagePort cannot cross the context bridge, so it reaches the page as a window message, as Electron's own guide does it.
ipcRenderer.on(CHANNEL.screen, (event, request: number) => window.postMessage({ [SCREEN_PORT]: request }, window.location.origin === 'null' ? '*' : window.location.origin, event.ports))

const ZOOM_STEP = 0.5
const ZOOM_RANGE = { min: -3, max: 5 }

const bridge: Bridge = {
  watch(topic, onPush) {
    const id = ++lastId
    subscribers.set(id, onPush as (push: Push) => void)
    ipcRenderer.send(CHANNEL.watch, id, topic)
    return () => {
      if (subscribers.delete(id)) ipcRenderer.send(CHANNEL.unwatch, id)
    }
  },
  run: (command, epoch) => ipcRenderer.invoke(CHANNEL.run, command, epoch),
  file: request => ipcRenderer.invoke(CHANNEL.file, request),
  image: request => ipcRenderer.invoke(CHANNEL.image, request),
  drafts: () => ipcRenderer.invoke(CHANNEL.drafts),
  keepDraft: draft => ipcRenderer.send(CHANNEL.keepDraft, draft),
  pickBotPicture: (bot, epoch) => ipcRenderer.invoke(CHANNEL.pickPicture, bot, epoch),
  choosePicture: () => ipcRenderer.invoke(CHANNEL.choosePicture),
  taskBoard: () => ipcRenderer.invoke(CHANNEL.taskBoard),
  taskChat: id => ipcRenderer.invoke(CHANNEL.taskChat, id),
  attachPick: () => ipcRenderer.invoke(CHANNEL.attachPick),
  attachPaste: () => ipcRenderer.invoke(CHANNEL.attachPaste),
  openScreen: (epoch, request) => ipcRenderer.send(CHANNEL.screen, epoch, request),
  // getPathForFile answers '' for a File the page built itself, so a window can only name a file the user gave it.
  attachDropped: files => ipcRenderer.invoke(CHANNEL.attachDrop, files.map(file => ({ name: file.name, path: webUtils.getPathForFile(file) || null }))),
  zoom: how => webFrame.setZoomLevel(how === 'reset' ? 0 : Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, webFrame.getZoomLevel() + (how === 'in' ? ZOOM_STEP : -ZOOM_STEP))))
}

contextBridge.exposeInMainWorld('highwing', bridge)
