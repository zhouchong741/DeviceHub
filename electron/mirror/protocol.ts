import type { QualityPreset } from '../types'

export const SCRCPY_SERVER_VERSION = '5.0.1'
export const SCRCPY_CODEC_H264 = 0x68323634 // "h264"

export const PACKET_FLAG_SESSION = 1n << 63n
export const PACKET_FLAG_CONFIG = 1n << 62n
export const PACKET_FLAG_KEY_FRAME = 1n << 61n
export const PTS_MASK = (1n << 61n) - 1n

export const POINTER_ID_MOUSE = 0xffffffffffffffffn
export const POINTER_ID_GENERIC_FINGER = 0xfffffffffffffffen

export const MOTION_ACTION_DOWN = 0
export const MOTION_ACTION_UP = 1
export const MOTION_ACTION_MOVE = 2

export const KEY_ACTION_DOWN = 0
export const KEY_ACTION_UP = 1

export const CONTROL_MSG_INJECT_KEYCODE = 0
export const CONTROL_MSG_INJECT_TEXT = 1
export const CONTROL_MSG_INJECT_TOUCH_EVENT = 2
export const CONTROL_MSG_INJECT_SCROLL_EVENT = 3
export const CONTROL_MSG_BACK_OR_SCREEN_ON = 4
export const CONTROL_MSG_SET_CLIPBOARD = 9
export const CONTROL_MSG_SET_DISPLAY_POWER = 10
export const CONTROL_MSG_ROTATE_DEVICE = 11
export const CONTROL_MSG_RESET_VIDEO = 17

export interface QualityConfig {
  maxSize: number
  maxFps: number
  bitRate: number
}

export const QUALITY_PRESETS: Record<QualityPreset, QualityConfig> = {
  '540p': { maxSize: 540, maxFps: 20, bitRate: 800_000 },
  '720p': { maxSize: 800, maxFps: 30, bitRate: 1_500_000 },
  '1080p': { maxSize: 1080, maxFps: 60, bitRate: 4_000_000 }
}

export interface VideoParserCallbacks {
  onDeviceMeta: (deviceName: string, codecId: number) => void
  onSessionResize: (width: number, height: number, isClientResize: boolean) => void
  onFrame: (frame: {
    isConfig: boolean
    isKeyFrame: boolean
    ptsUs: bigint
    payload: Buffer
  }) => void
  onStreamDisabled: (errorCode: number) => void
}

/**
 * 解析 scrcpy-server v5.0.1 视频流：
 * 1B dummy -> 64B deviceName -> 4B codecId -> 循环 12B 包头 (SessionMeta | FrameMeta + payload)
 */
export class ScrcpyVideoStreamParser {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private stage: 'dummy' | 'device_meta' | 'codec_id' | 'packet_header' | 'packet_payload' | 'disabled' = 'dummy'
  private deviceName = ''
  private currentFrame = {
    isConfig: false,
    isKeyFrame: false,
    ptsUs: 0n,
    packetSize: 0
  }

  constructor(private readonly callbacks: VideoParserCallbacks) {}

  push(chunk: Buffer): void {
    if (this.stage === 'disabled' || chunk.length === 0) return
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])

    while (true) {
      if (this.stage === 'dummy') {
        if (this.buffer.length < 1) return
        this.consume(1)
        this.stage = 'device_meta'
      } else if (this.stage === 'device_meta') {
        if (this.buffer.length < 64) return
        const nameBuf = this.consume(64)
        const nullIdx = nameBuf.indexOf(0)
        this.deviceName = nameBuf.subarray(0, nullIdx === -1 ? 64 : nullIdx).toString('utf-8')
        this.stage = 'codec_id'
      } else if (this.stage === 'codec_id') {
        if (this.buffer.length < 4) return
        const codecId = this.consume(4).readUInt32BE(0)
        if (codecId === 0 || codecId === 1) {
          this.stage = 'disabled'
          this.callbacks.onStreamDisabled(codecId)
          return
        }
        this.callbacks.onDeviceMeta(this.deviceName, codecId)
        this.stage = 'packet_header'
      } else if (this.stage === 'packet_header') {
        if (this.buffer.length < 12) return
        const header = this.consume(12)
        const ptsAndFlags = header.readBigUInt64BE(0)

        if ((ptsAndFlags & PACKET_FLAG_SESSION) !== 0n) {
          // v5.0.1 SessionMeta 只有 12 字节，没有后续 payload
          const flags = header.readUInt32BE(0)
          const width = header.readUInt32BE(4)
          const height = header.readUInt32BE(8)
          const isClientResize = (flags & 1) !== 0
          this.callbacks.onSessionResize(width, height, isClientResize)
          continue
        }

        const isConfig = (ptsAndFlags & PACKET_FLAG_CONFIG) !== 0n
        const isKeyFrame = (ptsAndFlags & PACKET_FLAG_KEY_FRAME) !== 0n
        const ptsUs = ptsAndFlags & PTS_MASK
        const packetSize = header.readUInt32BE(8)

        if (packetSize === 0) {
          this.callbacks.onFrame({
            isConfig,
            isKeyFrame,
            ptsUs,
            payload: Buffer.alloc(0)
          })
          continue
        }

        this.currentFrame = { isConfig, isKeyFrame, ptsUs, packetSize }
        this.stage = 'packet_payload'
      } else if (this.stage === 'packet_payload') {
        const { packetSize, isConfig, isKeyFrame, ptsUs } = this.currentFrame
        if (this.buffer.length < packetSize) return
        const payload = Buffer.from(this.consume(packetSize))
        this.stage = 'packet_header'
        this.callbacks.onFrame({ isConfig, isKeyFrame, ptsUs, payload })
      } else {
        return
      }
    }
  }

  private consume(n: number): Buffer {
    const slice = this.buffer.subarray(0, n)
    this.buffer = n === this.buffer.length ? Buffer.alloc(0) : this.buffer.subarray(n)
    return slice
  }
}

function clampInt(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(val)))
}

function floatToI16Fixed(val: number): number {
  const clamped = Math.max(-1, Math.min(1, val))
  if (clamped >= 1) return 0x7fff
  if (clamped <= -1) return -0x8000
  return clampInt(clamped * 0x7fff, -0x8000, 0x7fff)
}

export function encodeInjectKeycode(
  action: number,
  keycode: number,
  repeat = 0,
  metaState = 0
): Buffer {
  const buf = Buffer.allocUnsafe(14)
  buf.writeUInt8(CONTROL_MSG_INJECT_KEYCODE, 0)
  buf.writeUInt8(action & 0xff, 1)
  buf.writeInt32BE(keycode, 2)
  buf.writeInt32BE(repeat, 6)
  buf.writeInt32BE(metaState, 10)
  return buf
}

export function encodeInjectText(text: string): Buffer {
  const raw = Buffer.from(text, 'utf-8')
  const truncated = raw.length > 300 ? raw.subarray(0, 300) : raw
  const buf = Buffer.allocUnsafe(5 + truncated.length)
  buf.writeUInt8(CONTROL_MSG_INJECT_TEXT, 0)
  buf.writeUInt32BE(truncated.length, 1)
  truncated.copy(buf, 5)
  return buf
}

export function encodeInjectTouchEvent(params: {
  action: number
  pointerId?: bigint
  x: number
  y: number
  screenWidth: number
  screenHeight: number
  pressure?: number
  actionButton?: number
  buttons?: number
}): Buffer {
  const buf = Buffer.allocUnsafe(32)
  const w = Math.max(1, Math.min(0xffff, Math.round(params.screenWidth)))
  const h = Math.max(1, Math.min(0xffff, Math.round(params.screenHeight)))
  const x = clampInt(params.x, 0, w)
  const y = clampInt(params.y, 0, h)
  const pressure =
    params.pressure !== undefined
      ? clampInt(params.pressure * 0xffff, 0, 0xffff)
      : params.action === MOTION_ACTION_UP
      ? 0
      : 0xffff

  buf.writeUInt8(CONTROL_MSG_INJECT_TOUCH_EVENT, 0)
  buf.writeUInt8(params.action & 0xff, 1)
  buf.writeBigUInt64BE(params.pointerId ?? POINTER_ID_GENERIC_FINGER, 2)
  buf.writeInt32BE(x, 10)
  buf.writeInt32BE(y, 14)
  buf.writeUInt16BE(w, 18)
  buf.writeUInt16BE(h, 20)
  buf.writeUInt16BE(pressure, 22)
  buf.writeInt32BE(params.actionButton ?? 0, 24)
  buf.writeInt32BE(params.buttons ?? 0, 28)
  return buf
}

export function encodeInjectScrollEvent(params: {
  x: number
  y: number
  screenWidth: number
  screenHeight: number
  hScroll: number
  vScroll: number
  buttons?: number
}): Buffer {
  const buf = Buffer.allocUnsafe(21)
  const w = Math.max(1, Math.min(0xffff, Math.round(params.screenWidth)))
  const h = Math.max(1, Math.min(0xffff, Math.round(params.screenHeight)))
  const x = clampInt(params.x, 0, w)
  const y = clampInt(params.y, 0, h)

  // scrcpy 协议滚动范围为 [-16, 16]，先除以 16 归一化到 [-1, 1] 再转为 i16 定点数
  const hNorm = Math.max(-16, Math.min(16, params.hScroll)) / 16
  const vNorm = Math.max(-16, Math.min(16, params.vScroll)) / 16

  buf.writeUInt8(CONTROL_MSG_INJECT_SCROLL_EVENT, 0)
  buf.writeInt32BE(x, 1)
  buf.writeInt32BE(y, 5)
  buf.writeUInt16BE(w, 9)
  buf.writeUInt16BE(h, 11)
  buf.writeInt16BE(floatToI16Fixed(hNorm), 13)
  buf.writeInt16BE(floatToI16Fixed(vNorm), 15)
  buf.writeInt32BE(params.buttons ?? 0, 17)
  return buf
}

export function encodeBackOrScreenOn(action: number): Buffer {
  return Buffer.from([CONTROL_MSG_BACK_OR_SCREEN_ON, action & 0xff])
}

export function encodeSetClipboard(text: string, paste = true, sequence = 0n): Buffer {
  const maxBytes = (1 << 18) - 14
  const raw = Buffer.from(text, 'utf-8')
  const payload = raw.length > maxBytes ? raw.subarray(0, maxBytes) : raw
  const buf = Buffer.allocUnsafe(14 + payload.length)
  buf.writeUInt8(CONTROL_MSG_SET_CLIPBOARD, 0)
  buf.writeBigUInt64BE(sequence, 1)
  buf.writeUInt8(paste ? 1 : 0, 9)
  buf.writeUInt32BE(payload.length, 10)
  payload.copy(buf, 14)
  return buf
}

export function encodeSetDisplayPower(on: boolean): Buffer {
  return Buffer.from([CONTROL_MSG_SET_DISPLAY_POWER, on ? 1 : 0])
}

export function encodeRotateDevice(): Buffer {
  return Buffer.from([CONTROL_MSG_ROTATE_DEVICE])
}

export function encodeResetVideo(): Buffer {
  return Buffer.from([CONTROL_MSG_RESET_VIDEO])
}
