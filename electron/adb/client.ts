import * as net from 'net'

const ADB_HOST = '127.0.0.1'
const ADB_PORT = 5037

export function encodeAdbPacket(command: string): Buffer {
  const payload = Buffer.from(command, 'utf-8')
  const header = payload.length.toString(16).padStart(4, '0')
  return Buffer.concat([Buffer.from(header, 'ascii'), payload])
}

export interface TrackStreamHandle {
  close: () => void
}

/**
 * 直连本机 127.0.0.1:5037 打开 host:track-devices-l 长连接流，零子进程轮询开销
 */
export function openTrackDevicesStream(handlers: {
  onReady?: () => void
  onPayload: (payload: string) => void
  onError: (err: Error) => void
  onClose: () => void
}): TrackStreamHandle {
  const socket = net.createConnection({ host: ADB_HOST, port: ADB_PORT })
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let handshakeState: 'status' | 'fail_len' | 'fail_msg' | 'stream_len' | 'stream_body' = 'status'
  let expectedLen = 0
  let closed = false

  const close = (): void => {
    if (closed) return
    closed = true
    socket.destroy()
  }

  socket.on('connect', () => {
    socket.write(encodeAdbPacket('host:track-devices-l'))
  })

  socket.on('data', (chunk: Buffer) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])

    while (true) {
      if (handshakeState === 'status') {
        if (buffer.length < 4) return
        const status = buffer.subarray(0, 4).toString('ascii')
        buffer = buffer.subarray(4)
        if (status === 'OKAY') {
          handshakeState = 'stream_len'
          handlers.onReady?.()
        } else if (status === 'FAIL') {
          handshakeState = 'fail_len'
        } else {
          handlers.onError(new Error(`Unexpected ADB status: ${status}`))
          close()
          return
        }
      } else if (handshakeState === 'fail_len') {
        if (buffer.length < 4) return
        expectedLen = parseInt(buffer.subarray(0, 4).toString('ascii'), 16)
        buffer = buffer.subarray(4)
        if (Number.isNaN(expectedLen) || expectedLen < 0) {
          handlers.onError(new Error('Invalid ADB FAIL length'))
          close()
          return
        }
        handshakeState = 'fail_msg'
      } else if (handshakeState === 'fail_msg') {
        if (buffer.length < expectedLen) return
        const msg = buffer.subarray(0, expectedLen).toString('utf-8')
        buffer = buffer.subarray(expectedLen)
        handlers.onError(new Error(msg || 'ADB host:track-devices-l failed'))
        close()
        return
      } else if (handshakeState === 'stream_len') {
        if (buffer.length < 4) return
        expectedLen = parseInt(buffer.subarray(0, 4).toString('ascii'), 16)
        buffer = buffer.subarray(4)
        if (Number.isNaN(expectedLen) || expectedLen < 0) {
          handlers.onError(new Error('Invalid track-devices frame length'))
          close()
          return
        }
        if (expectedLen === 0) {
          handlers.onPayload('')
        } else {
          handshakeState = 'stream_body'
        }
      } else if (handshakeState === 'stream_body') {
        if (buffer.length < expectedLen) return
        const payload = buffer.subarray(0, expectedLen).toString('utf-8')
        buffer = buffer.subarray(expectedLen)
        handshakeState = 'stream_len'
        handlers.onPayload(payload)
      }
    }
  })

  socket.on('error', (err) => {
    if (!closed) {
      handlers.onError(err)
    }
  })

  socket.on('close', () => {
    if (!closed) {
      closed = true
    }
    handlers.onClose()
  })

  return { close }
}
