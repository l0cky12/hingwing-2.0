import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('highwing', {})
