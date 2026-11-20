import { useCallback, useEffect, useRef, useState } from 'react'
import type { MirrorSessionStatus, MirrorState } from '../types/droidwall'

const WS_MSG_SESSION_META = 0x01
const WS_MSG_VIDEO_FRAME = 0x02
const WS_MSG_STATE = 0x03

function toHex2(n: number): string {
  return n.toString(16).padStart(2, '0').toUpperCase()
}

function extractSpsCodecString(annexB: Uint8Array): string | null {
  const len = annexB.length
  let i = 0
  while (i + 4 < len) {
    let startCodeLen = 0
    if (annexB[i] === 0 && annexB[i + 1] === 0 && annexB[i + 2] === 1) {
      startCodeLen = 3
    } else if (i + 5 < len && annexB[i] === 0 && annexB[i + 1] === 0 && annexB[i + 2] === 0 && annexB[i + 3] === 1) {
      startCodeLen = 4
    }
    if (startCodeLen > 0) {
      const naluStart = i + startCodeLen
      const nalType = annexB[naluStart] & 0x1f
      if (nalType === 7 && naluStart + 3 < len) {
        const profileIdc = annexB[naluStart + 1]
        const profileCompat = annexB[naluStart + 2]
        const levelIdc = annexB[naluStart + 3]
        return `avc1.${toHex2(profileIdc)}${toHex2(profileCompat)}${toHex2(levelIdc)}`
      }
      i = naluStart + 1
    } else {
      i += 1
    }
  }
  return null
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

export type OutgoingControlMessage =
  | { type: 'touch'; action: 'down' | 'move' | 'up'; pointerId?: string | number; xRatio: number; yRatio: number }
  | { type: 'scroll'; xRatio: number; yRatio: number; hScroll: number; vScroll: number }
  | { type: 'key'; action: 'down' | 'up'; keycode: number; repeat?: number; metaState?: number }
  | { type: 'nav'; key: 'back' | 'home' | 'app_switch' }
  | { type: 'text'; text: string }
  | { type: 'clipboard'; text: string; paste?: boolean }
  | { type: 'displayPower'; on: boolean }
  | { type: 'rotate' }

export function useMirrorStream(
  serial: string,
  sessionStatus: MirrorSessionStatus,
  canvasRef: React.RefObject<HTMLCanvasElement | null>
): {
  videoSize: { width: number; height: number }
  wsConnected: boolean
  liveState: MirrorState | null
  sendControl: (msg: OutgoingControlMessage) => void
} {
  const shouldConnect = sessionStatus === 'starting' || sessionStatus === 'running'
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 })
  const [wsConnected, setWsConnected] = useState(false)
  const [liveState, setLiveState] = useState<MirrorState | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const decoderRef = useRef<VideoDecoder | null>(null)
  const lastConfigRef = useRef<Uint8Array | null>(null)
  const currentCodecRef = useRef<string | null>(null)
  const waitingKeyFrameRef = useRef(true)

  const sendControl = useCallback((msg: OutgoingControlMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }, [])

  useEffect(() => {
    if (!shouldConnect) {
      setWsConnected(false)
      setLiveState(null)
      return
    }

    let disposed = false

    const closeDecoder = (): void => {
      if (decoderRef.current) {
        try {
          if (decoderRef.current.state !== 'closed') {
            decoderRef.current.close()
          }
        } catch {
          // ignore
        }
        decoderRef.current = null
      }
      currentCodecRef.current = null
      waitingKeyFrameRef.current = true
    }

    const ensureDecoderConfigured = (codec: string): void => {
      if (decoderRef.current && currentCodecRef.current === codec && decoderRef.current.state === 'configured') {
        return
      }
      closeDecoder()

      const decoder = new VideoDecoder({
        output: (frame) => {
          try {
            const canvas = canvasRef.current
            if (canvas) {
              if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
                canvas.width = frame.displayWidth
                canvas.height = frame.displayHeight
                setVideoSize({ width: frame.displayWidth, height: frame.displayHeight })
              }
              const ctx = canvas.getContext('2d')
              ctx?.drawImage(frame, 0, 0, canvas.width, canvas.height)
            }
          } finally {
            frame.close()
          }
        },
        error: (err) => {
          console.error(`[VideoDecoder:${serial}]`, err)
          closeDecoder()
        }
      })

      decoder.configure({
        codec,
        hardwareAcceleration: 'prefer-hardware',
        optimizeForLatency: true
      })

      decoderRef.current = decoder
      currentCodecRef.current = codec
      waitingKeyFrameRef.current = true
    }

    const startConnection = async (): Promise<void> => {
      const wsUrl = await window.droidWall.getMirrorWsUrl(serial)
      if (disposed) return

      const ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => {
        if (!disposed) setWsConnected(true)
      }

      ws.onclose = () => {
        if (!disposed) setWsConnected(false)
      }

      ws.onmessage = (event) => {
        if (disposed || !(event.data instanceof ArrayBuffer)) return
        const bytes = new Uint8Array(event.data)
        if (bytes.length < 1) return

        const view = new DataView(event.data)
        const msgType = bytes[0]

        if (msgType === WS_MSG_SESSION_META && bytes.length >= 9) {
          const width = view.getUint32(1, false)
          const height = view.getUint32(5, false)
          if (width > 0 && height > 0) {
            setVideoSize({ width, height })
          }
          return
        }

        if (msgType === WS_MSG_STATE) {
          try {
            const jsonText = new TextDecoder().decode(bytes.subarray(1))
            const parsed = JSON.parse(jsonText) as MirrorState
            setLiveState(parsed)
          } catch {
            // ignore
          }
          return
        }

        if (msgType === WS_MSG_VIDEO_FRAME && bytes.length > 10) {
          const flags = bytes[1]
          const isConfig = (flags & 0x01) !== 0
          const isKeyFrame = (flags & 0x02) !== 0
          const ptsUs = Number(view.getBigUint64(2, false))
          const payload = bytes.subarray(10)

          if (isConfig) {
            lastConfigRef.current = payload.slice()
            const codec = extractSpsCodecString(payload) ?? 'avc1.42E01E'
            ensureDecoderConfigured(codec)
            return
          }

          if (!decoderRef.current || decoderRef.current.state !== 'configured') {
            if (lastConfigRef.current) {
              const codec = extractSpsCodecString(lastConfigRef.current) ?? 'avc1.42E01E'
              ensureDecoderConfigured(codec)
            } else {
              return
            }
          }

          const decoder = decoderRef.current
          if (!decoder || decoder.state !== 'configured') return

          // 队列积压时跳过非关键帧以保证实时低延迟
          if (decoder.decodeQueueSize > 4 && !isKeyFrame) {
            waitingKeyFrameRef.current = true
            return
          }

          if (waitingKeyFrameRef.current && !isKeyFrame) {
            return
          }

          const chunkData =
            isKeyFrame && lastConfigRef.current ? concatBytes(lastConfigRef.current, payload) : payload

          try {
            decoder.decode(
              new EncodedVideoChunk({
                type: isKeyFrame ? 'key' : 'delta',
                timestamp: ptsUs,
                data: chunkData
              })
            )
            if (isKeyFrame) {
              waitingKeyFrameRef.current = false
            }
          } catch (err) {
            console.error(`[VideoDecoder:${serial}] decode failed:`, err)
            waitingKeyFrameRef.current = true
          }
        }
      }
    }

    void startConnection()

    return () => {
      disposed = true
      setWsConnected(false)
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      lastConfigRef.current = null
      closeDecoder()
    }
  }, [serial, shouldConnect, canvasRef])

  return { videoSize, wsConnected, liveState, sendControl }
}
