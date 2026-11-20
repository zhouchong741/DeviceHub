import type { IncomingMessage } from 'http'
import { URL } from 'url'
import { WebSocket, WebSocketServer } from 'ws'
import type { MirrorState } from '../types'
import type { DeviceSession, VideoFramePacket } from './device-session'
import type { SessionManager } from './session-manager'

const WS_MSG_SESSION_META = 0x01
const WS_MSG_VIDEO_FRAME = 0x02
const WS_MSG_STATE = 0x03

type ClientControlMessage =
  | { type: 'touch'; action: 'down' | 'move' | 'up'; pointerId?: string | number; xRatio: number; yRatio: number }
  | { type: 'scroll'; xRatio: number; yRatio: number; hScroll: number; vScroll: number }
  | { type: 'key'; action: 'down' | 'up'; keycode: number; repeat?: number; metaState?: number }
  | { type: 'nav'; key: 'back' | 'home' | 'app_switch' }
  | { type: 'text'; text: string }
  | { type: 'clipboard'; text: string; paste?: boolean }
  | { type: 'displayPower'; on: boolean }
  | { type: 'rotate' }

function encodeSessionMetaPacket(width: number, height: number): Buffer {
  const buf = Buffer.allocUnsafe(9)
  buf.writeUInt8(WS_MSG_SESSION_META, 0)
  buf.writeUInt32BE(width, 1)
  buf.writeUInt32BE(height, 5)
  return buf
}

function encodeVideoFramePacket(frame: VideoFramePacket): Buffer {
  const flags = (frame.isConfig ? 0x01 : 0) | (frame.isKeyFrame ? 0x02 : 0)
  const buf = Buffer.allocUnsafe(10 + frame.payload.length)
  buf.writeUInt8(WS_MSG_VIDEO_FRAME, 0)
  buf.writeUInt8(flags, 1)
  buf.writeBigUInt64BE(frame.ptsUs, 2)
  frame.payload.copy(buf, 10)
  return buf
}

function encodeStatePacket(state: MirrorState): Buffer {
  const json = Buffer.from(JSON.stringify(state), 'utf-8')
  const buf = Buffer.allocUnsafe(1 + json.length)
  buf.writeUInt8(WS_MSG_STATE, 0)
  json.copy(buf, 1)
  return buf
}

export class MirrorWsGateway {
  private wss: WebSocketServer | null = null
  private port = 0
  private clientsBySerial = new Map<string, Set<WebSocket>>()
  private boundSessions = new WeakSet<DeviceSession>()

  constructor(private readonly sessionManager: SessionManager) {
    this.sessionManager.on('session-created', (session: DeviceSession) => {
      this.bindSession(session)
    })
  }

  start(): Promise<number> {
    if (this.wss) return Promise.resolve(this.port)
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: '127.0.0.1',
        port: 0,
        perMessageDeflate: false
      })

      wss.once('listening', () => {
        const addr = wss.address()
        this.port = typeof addr === 'object' && addr ? addr.port : 0
        this.wss = wss
        resolve(this.port)
      })

      wss.once('error', reject)
      wss.on('connection', (ws, req) => this.handleConnection(ws, req))
    })
  }

  getWsUrl(serial: string): string {
    return `ws://127.0.0.1:${this.port}/mirror?serial=${encodeURIComponent(serial)}`
  }

  async stop(): Promise<void> {
    if (!this.wss) return
    const wss = this.wss
    this.wss = null
    for (const set of this.clientsBySerial.values()) {
      for (const ws of set) {
        ws.terminate()
      }
    }
    this.clientsBySerial.clear()
    await new Promise<void>((resolve) => wss.close(() => resolve()))
  }

  private bindSession(session: DeviceSession): void {
    if (this.boundSessions.has(session)) return
    this.boundSessions.add(session)

    session.on('session-resize', ({ width, height }: { width: number; height: number }) => {
      this.broadcast(session.serial, encodeSessionMetaPacket(width, height))
    })

    session.on('frame', (frame: VideoFramePacket) => {
      this.broadcast(session.serial, encodeVideoFramePacket(frame))
    })

    session.on('state', (state: MirrorState) => {
      this.broadcast(session.serial, encodeStatePacket(state))
    })
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const serial = url.searchParams.get('serial')
    if (!serial) {
      ws.close(1008, 'Missing serial')
      return
    }

    let set = this.clientsBySerial.get(serial)
    if (!set) {
      set = new Set()
      this.clientsBySerial.set(serial, set)
    }
    set.add(ws)

    const session = this.sessionManager.getSession(serial)
    if (session) {
      this.bindSession(session)
      const state = session.getState()
      this.safeSend(ws, encodeStatePacket(state))
      if (state.videoWidth > 0 && state.videoHeight > 0) {
        this.safeSend(ws, encodeSessionMetaPacket(state.videoWidth, state.videoHeight))
        const cachedConfig = session.getLastConfigPayload()
        if (cachedConfig) {
          this.safeSend(
            ws,
            encodeVideoFramePacket({
              isConfig: true,
              isKeyFrame: false,
              ptsUs: 0n,
              payload: cachedConfig
            })
          )
        }
        // 仅在编码器完成首帧初始化之后才可请求关键帧，避免 SurfaceEncoder 未 init 时触发 NPE
        session.requestKeyFrame()
      }
    }

    ws.on('message', (data) => {
      this.handleClientMessage(serial, data)
    })

    ws.on('close', () => {
      const currentSet = this.clientsBySerial.get(serial)
      if (currentSet) {
        currentSet.delete(ws)
        if (currentSet.size === 0) {
          this.clientsBySerial.delete(serial)
          this.sessionManager.getSession(serial)?.releaseActivePointers()
        }
      }
    })
  }

  private handleClientMessage(serial: string, raw: unknown): void {
    const session = this.sessionManager.getSession(serial)
    if (!session) return

    let msg: ClientControlMessage
    try {
      const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf-8') : ''
      if (!text) return
      msg = JSON.parse(text) as ClientControlMessage
    } catch {
      return
    }

    switch (msg.type) {
      case 'touch':
        session.sendNormalizedTouch({
          action: msg.action,
          pointerId: msg.pointerId !== undefined ? BigInt(msg.pointerId) : undefined,
          xRatio: msg.xRatio,
          yRatio: msg.yRatio
        })
        break
      case 'scroll':
        session.sendNormalizedScroll({
          xRatio: msg.xRatio,
          yRatio: msg.yRatio,
          hScroll: msg.hScroll,
          vScroll: msg.vScroll
        })
        break
      case 'key':
        session.sendKey(msg.action, msg.keycode, msg.repeat ?? 0, msg.metaState ?? 0)
        break
      case 'nav':
        session.sendNavKey(msg.key)
        break
      case 'text':
        session.sendText(msg.text)
        break
      case 'clipboard':
        session.sendClipboard(msg.text, msg.paste ?? true)
        break
      case 'displayPower':
        session.setDisplayPower(msg.on)
        break
      case 'rotate':
        session.rotateDevice()
        break
    }
  }

  private broadcast(serial: string, packet: Buffer): void {
    const clients = this.clientsBySerial.get(serial)
    if (!clients || clients.size === 0) return
    for (const ws of clients) {
      this.safeSend(ws, packet)
    }
  }

  private safeSend(ws: WebSocket, packet: Buffer): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(packet, { binary: true })
    }
  }
}
