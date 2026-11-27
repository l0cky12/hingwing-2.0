import { MessageChannelMain, type IpcMain, type IpcMainEvent } from 'electron'
import { CHANNEL, epochOf, type ScreenFrame } from '../ipc-contract'
import type { ConnectionOwner } from './connection'

/** The close code a live view reports when it never reached the screen: Hermes gave no ticket, or no socket could reach it. */
export const UNREACHED = 4404

/**
 * Carries the live view of a bot's screen between Hermes and the window. The window cannot dial it: its page may open no
 * socket, and the gateway refuses an upgrade that carries an Origin. So main dials it, with Node's WebSocket, which sends
 * none, and relays the RFB bytes over a MessagePort. The address holds a single-use ticket and never leaves main.
 */
export function serveScreen(owner: ConnectionOwner, ipc: Pick<IpcMain, 'on' | 'removeAllListeners'>, isAppUrl: (url: string) => boolean): () => void {
  ipc.on(CHANNEL.screen, (event: IpcMainEvent, epoch: unknown) => {
    const frame = event.senderFrame
    if (frame === null || frame.parent !== null || !isAppUrl(frame.url)) return
    const { port1: port, port2 } = new MessageChannelMain()
    event.sender.postMessage(CHANNEL.screen, null, [port2])
    const send = (sent: ScreenFrame) => port.postMessage(sent)
    let socket: WebSocket | null = null
    let ended = false
    const end = (code: number) => {
      if (ended) return
      ended = true
      send({ closed: code })
      port.close()
      socket?.close()
    }
    port.on('message', ({ data }) => {
      if (data === 'close') return end(1000)
      if (socket?.readyState === WebSocket.OPEN && (data instanceof ArrayBuffer || ArrayBuffer.isView(data))) socket.send(data)
    })
    port.on('close', () => end(1000))
    port.start()

    const hermes = owner.hermes
    if (hermes === null || epoch !== epochOf(owner.setup.get())) return end(UNREACHED)
    void hermes.screenSocket().then(address => {
      if (ended) return
      if (address === null) return end(UNREACHED)
      const opened = new WebSocket(address)
      socket = opened
      opened.binaryType = 'arraybuffer'
      opened.addEventListener('open', () => {
        if (!ended) send('open')
      })
      opened.addEventListener('message', ({ data }) => {
        if (!ended && data instanceof ArrayBuffer) send(data)
      })
      opened.addEventListener('close', ({ code }) => end(code))
      // Node's WebSocket fires `error` and never `close` when the dial fails.
      opened.addEventListener('error', () => end(UNREACHED))
    }, () => end(UNREACHED))
  })
  return () => void ipc.removeAllListeners(CHANNEL.screen)
}
