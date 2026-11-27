import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CHANNEL, type Bridge, type Push } from '../ipc-contract'

const subscribers = new Map<number, (push: Push) => void>()
let lastId = 0

ipcRenderer.on(CHANNEL.push, (_event, id: number, push: Push) => subscribers.get(id)?.(push))

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
  // getPathForFile answers '' for a File the page built itself, so a window can only name a file the user gave it.
  attachDropped: files => ipcRenderer.invoke(CHANNEL.attachDrop, files.map(file => ({ name: file.name, path: webUtils.getPathForFile(file) || null })))
}

contextBridge.exposeInMainWorld('highwing', bridge)
