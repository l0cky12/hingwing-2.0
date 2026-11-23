import { contextBridge, ipcRenderer } from 'electron'
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
  run: command => ipcRenderer.invoke(CHANNEL.run, command),
  copy: text => ipcRenderer.invoke(CHANNEL.copy, text)
}

contextBridge.exposeInMainWorld('highwing', bridge)
