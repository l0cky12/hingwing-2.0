import type { ScreenFrame } from '../../ipc-contract'

type Handler = ((event: unknown) => void) | null

/**
 * A live view's port as the socket noVNC expects: the fields its Websock checks (core/websock.js), with the RFB bytes main
 * relays from Hermes. `closed` hears the socket's close code once.
 */
export function portSocket(port: MessagePort, closed: (code: number) => void) {
  const socket = {
    binaryType: 'arraybuffer',
    protocol: '',
    readyState: 'connecting' as 'connecting' | 'open' | 'closing' | 'closed',
    onopen: null as Handler,
    onmessage: null as Handler,
    onerror: null as Handler,
    onclose: null as Handler,
    // noVNC sends a view of its whole send buffer, so only the bytes it names are copied across.
    send: (data: ArrayBuffer | ArrayBufferView) => port.postMessage(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data),
    close: () => {
      if (socket.readyState === 'closing' || socket.readyState === 'closed') return
      socket.readyState = 'closing'
      port.postMessage('close')
    }
  }
  port.onmessage = ({ data }: MessageEvent<ScreenFrame>) => {
    if (data === 'open') {
      socket.readyState = 'open'
      socket.onopen?.(new Event('open'))
    } else if (data instanceof ArrayBuffer) {
      socket.onmessage?.({ data })
    } else if (socket.readyState !== 'closed') {
      socket.readyState = 'closed'
      port.close()
      // noVNC reports its disconnect from inside onclose, so the code is heard first.
      closed(data.closed)
      socket.onclose?.({ code: data.closed, reason: '', wasClean: data.closed === 1000 })
    }
  }
  port.start()
  return socket
}
