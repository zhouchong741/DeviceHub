import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import * as crypto from 'crypto'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as net from 'net'
import * as path from 'path'
import { forwardPort, pushFile, removeForward } from '../adb/executor'
import type { MirrorSessionStatus, MirrorState, QualityPreset } from '../types'
import {
  encodeBackOrScreenOn,
  encodeInjectKeycode,
  encodeInjectScrollEvent,
  encodeInjectText,
  encodeInjectTouchEvent,
  encodeResetVideo,
  encodeRotateDevice,
  encodeSetClipboard,
  encodeSetDisplayPower,
  KEY_ACTION_DOWN,
  KEY_ACTION_UP,
  MOTION_ACTION_DOWN,
  MOTION_ACTION_MOVE,
  MOTION_ACTION_UP,
  POINTER_ID_GENERIC_FINGER,
  QUALITY_PRESETS,
  SCRCPY_SERVER_VERSION,
  ScrcpyVideoStreamParser
} from './protocol'

const REMOTE_SERVER_PATH = '/data/local/tmp/scrcpy-server.jar'

function resolveServerJarPath(): string {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'scrcpy-server.jar') : '',
    path.resolve(__dirname, '../../resources/scrcpy-server.jar'),
    path.resolve(process.cwd(), 'resources/scrcpy-server.jar')
  ].filter(Boolean)

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  throw new Error(`未找到 scrcpy-server.jar，已检查路径: ${candidates.join(', ')}`)
}

function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      const port = typeof address === 'object' && address ? address.port : 0
      srv.close((err) => {
        if (err) reject(err)
        else resolve(port)
      })
    })
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface VideoFramePacket {
  isConfig: boolean
  isKeyFrame: boolean
  ptsUs: bigint
  payload: Buffer
}

export class DeviceSession extends EventEmitter {
  private status: MirrorSessionStatus = 'idle'
  private videoWidth = 0
  private videoHeight = 0
  private fps = 0
  private bitrateKbps = 0
  private displayPower = true
  private warning: string | undefined
  private error: string | undefined

  private scidHex = ''
  private localPort = 0
  private forwardActive = false
  private serverProc: ChildProcessWithoutNullStreams | null = null
  private videoSocket: net.Socket | null = null
  private controlSocket: net.Socket | null = null
  private parser: ScrcpyVideoStreamParser | null = null
  private lastConfigPayload: Buffer | null = null

  private activePointers = new Map<bigint, { x: number; y: number }>()
  private frameCounter = 0
  private byteCounter = 0
  private statsTimer: NodeJS.Timeout | null = null
  private clipboardSeq = 1n
  private stopPromise: Promise<void> | null = null

  constructor(
    public readonly serial: string,
    private adbPath: string,
    private quality: QualityPreset
  ) {
    super()
  }

  getState(): MirrorState {
    return {
      serial: this.serial,
      status: this.status,
      videoWidth: this.videoWidth,
      videoHeight: this.videoHeight,
      fps: this.fps,
      bitrateKbps: this.bitrateKbps,
      displayPower: this.displayPower,
      warning: this.warning,
      error: this.error
    }
  }

  getLastConfigPayload(): Buffer | null {
    return this.lastConfigPayload
  }

  async start(): Promise<void> {
    if (this.status === 'starting' || this.status === 'running') return
    this.stopPromise = null
    this.setStatus('starting')
    this.error = undefined
    this.warning = undefined
    this.displayPower = true
    this.lastConfigPayload = null

    try {
      const jarPath = resolveServerJarPath()
      const scidInt = crypto.randomInt(0, 0x7fffffff)
      this.scidHex = scidInt.toString(16).padStart(8, '0')
      this.localPort = await allocateFreePort()

      await pushFile(this.adbPath, this.serial, jarPath, REMOTE_SERVER_PATH)
      await forwardPort(this.adbPath, this.serial, this.localPort, `scrcpy_${this.scidHex}`)
      this.forwardActive = true

      if (this.isCancelledDuringStart()) return

      const preset = QUALITY_PRESETS[this.quality]
      const shellCmd = [
        `CLASSPATH=${REMOTE_SERVER_PATH}`,
        'app_process',
        '/',
        'com.genymobile.scrcpy.Server',
        SCRCPY_SERVER_VERSION,
        `scid=${this.scidHex}`,
        'tunnel_forward=true',
        'audio=false',
        'control=true',
        `max_size=${preset.maxSize}`,
        `max_fps=${preset.maxFps}`,
        `video_bit_rate=${preset.bitRate}`,
        'send_device_meta=true',
        'send_frame_meta=true',
        'send_dummy_byte=true',
        'send_stream_meta=true',
        'cleanup=true'
      ].join(' ')

      this.serverProc = spawn(this.adbPath, ['-s', this.serial, 'shell', shellCmd])
      this.attachServerLogs(this.serverProc)

      const { videoSocket, initialChunk } = await this.connectVideoSocketWithRetry()
      if (this.isCancelledDuringStart()) {
        videoSocket.destroy()
        return
      }
      this.videoSocket = videoSocket

      this.controlSocket = await this.connectControlSocket()
      if (this.isCancelledDuringStart()) {
        this.controlSocket.destroy()
        return
      }
      this.controlSocket.setNoDelay(true)

      this.setupVideoPipeline(videoSocket, initialChunk)
      this.startStatsLoop()
      this.setStatus('running')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.error = msg
      await this.stopInternal('error')
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopPromise = this.stopInternal('idle')
    return this.stopPromise
  }

  requestKeyFrame(): void {
    this.writeControl(encodeResetVideo())
  }

  releaseActivePointers(): void {
    if (this.activePointers.size === 0) return
    const w = this.videoWidth || 1080
    const h = this.videoHeight || 2400
    for (const [pointerId, pos] of Array.from(this.activePointers.entries())) {
      this.writeControl(
        encodeInjectTouchEvent({
          action: MOTION_ACTION_UP,
          pointerId,
          x: pos.x,
          y: pos.y,
          screenWidth: w,
          screenHeight: h,
          pressure: 0
        })
      )
    }
    this.activePointers.clear()
  }

  private toDevicePoint(xRatio: number, yRatio: number): { x: number; y: number } {
    const maxX = Math.max(0, this.videoWidth - 1)
    const maxY = Math.max(0, this.videoHeight - 1)
    const x = Math.min(maxX, Math.max(0, Math.round(Math.max(0, Math.min(1, xRatio)) * maxX)))
    const y = Math.min(maxY, Math.max(0, Math.round(Math.max(0, Math.min(1, yRatio)) * maxY)))
    return { x, y }
  }

  sendNormalizedTouch(params: {
    action: 'down' | 'move' | 'up'
    pointerId?: bigint
    xRatio: number
    yRatio: number
  }): void {
    if (this.status !== 'running' || this.videoWidth <= 0 || this.videoHeight <= 0) return
    const pointerId = params.pointerId ?? POINTER_ID_GENERIC_FINGER
    const { x, y } = this.toDevicePoint(params.xRatio, params.yRatio)
    const action =
      params.action === 'down' ? MOTION_ACTION_DOWN : params.action === 'move' ? MOTION_ACTION_MOVE : MOTION_ACTION_UP

    if (params.action === 'down' || params.action === 'move') {
      this.activePointers.set(pointerId, { x, y })
    } else {
      this.activePointers.delete(pointerId)
    }

    this.writeControl(
      encodeInjectTouchEvent({
        action,
        pointerId,
        x,
        y,
        screenWidth: this.videoWidth,
        screenHeight: this.videoHeight,
        pressure: params.action === 'up' ? 0 : 1
      })
    )
  }

  sendNormalizedScroll(params: { xRatio: number; yRatio: number; hScroll: number; vScroll: number }): void {
    if (this.status !== 'running' || this.videoWidth <= 0 || this.videoHeight <= 0) return
    const { x, y } = this.toDevicePoint(params.xRatio, params.yRatio)

    this.writeControl(
      encodeInjectScrollEvent({
        x,
        y,
        screenWidth: this.videoWidth,
        screenHeight: this.videoHeight,
        hScroll: params.hScroll,
        vScroll: params.vScroll
      })
    )
  }

  sendKey(action: 'down' | 'up', keycode: number, repeat = 0, metaState = 0): void {
    if (this.status !== 'running') return
    this.writeControl(encodeInjectKeycode(action === 'down' ? KEY_ACTION_DOWN : KEY_ACTION_UP, keycode, repeat, metaState))
  }

  sendNavKey(key: 'back' | 'home' | 'app_switch'): void {
    if (this.status !== 'running') return
    if (key === 'back') {
      this.writeControl(encodeBackOrScreenOn(KEY_ACTION_DOWN))
      this.writeControl(encodeBackOrScreenOn(KEY_ACTION_UP))
      return
    }
    const keycode = key === 'home' ? 3 : 187 // KEYCODE_HOME = 3, KEYCODE_APP_SWITCH = 187
    this.writeControl(encodeInjectKeycode(KEY_ACTION_DOWN, keycode))
    this.writeControl(encodeInjectKeycode(KEY_ACTION_UP, keycode))
  }

  sendText(text: string): void {
    if (this.status !== 'running' || !text) return
    // scrcpy INJECT_TEXT 仅兼容 ASCII，非 ASCII 自动走剪贴板粘贴以原生支持中文
    if (/^[\x20-\x7e]+$/.test(text)) {
      this.writeControl(encodeInjectText(text))
    } else {
      this.sendClipboard(text, true)
    }
  }

  sendClipboard(text: string, paste = true): void {
    if (this.status !== 'running' || !text) return
    const seq = this.clipboardSeq++
    this.writeControl(encodeSetClipboard(text, paste, seq))
  }

  setDisplayPower(on: boolean): void {
    if (this.status !== 'running') return
    this.displayPower = on
    if (on) {
      // 面板关闭期间设备可能已被系统息屏/锁屏（Dozing/Asleep），仅恢复面板无法唤醒，
      // 需额外注入 KEYCODE_WAKEUP(224)；该键只唤醒、不会像 POWER 键那样来回切换
      this.writeControl(encodeInjectKeycode(KEY_ACTION_DOWN, 224))
      this.writeControl(encodeInjectKeycode(KEY_ACTION_UP, 224))
    }
    this.writeControl(encodeSetDisplayPower(on))
    this.emitState()
  }

  rotateDevice(): void {
    if (this.status !== 'running') return
    this.writeControl(encodeRotateDevice())
  }

  private writeControl(buf: Buffer): void {
    if (!this.controlSocket || this.controlSocket.destroyed) return
    this.controlSocket.write(buf)
  }

  private attachServerLogs(proc: ChildProcessWithoutNullStreams): void {
    const inspectLog = (chunk: Buffer): void => {
      const text = chunk.toString('utf-8')
      if (/INJECT_EVENTS|SecurityException/i.test(text)) {
        this.warning = '触控权限受限：请在手机「开发者选项」中开启「USB调试（安全设置）」'
        this.emitState()
      }
      if (/ERROR:/i.test(text) && !this.error) {
        this.error = text.trim()
      }
    }
    proc.stdout.on('data', inspectLog)
    proc.stderr.on('data', inspectLog)

    proc.on('exit', (code) => {
      if (this.status === 'running' || this.status === 'starting') {
        if (code !== 0 && !this.error) {
          this.error = `scrcpy-server 异常退出 (code=${code})`
        }
        void this.stopInternal(this.error ? 'error' : 'idle')
      }
    })
  }

  private async connectVideoSocketWithRetry(): Promise<{ videoSocket: net.Socket; initialChunk: Buffer }> {
    const maxAttempts = 40
    for (let i = 0; i < maxAttempts; i++) {
      if (this.status !== 'starting') {
        throw new Error('投屏已取消')
      }
      try {
        const result = await this.attemptVideoHandshake()
        return result
      } catch {
        await delay(100)
      }
    }
    throw new Error(this.error || '连接 scrcpy-server 视频隧道超时，请确认设备处于解锁与授权状态。')
  }

  private attemptVideoHandshake(): Promise<{ videoSocket: net.Socket; initialChunk: Buffer }> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: this.localPort })
      let settled = false

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          socket.destroy()
          reject(new Error('Video handshake timeout'))
        }
      }, 1500)

      socket.once('data', (chunk: Buffer) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.pause()
        resolve({ videoSocket: socket, initialChunk: chunk })
      })

      socket.once('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        reject(err)
      })

      socket.once('close', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error('Video socket closed before dummy byte'))
      })
    })
  }

  private connectControlSocket(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: this.localPort })
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error('Control socket connect timeout'))
      }, 3000)

      socket.once('connect', () => {
        clearTimeout(timer)
        resolve(socket)
      })
      socket.once('error', (err) => {
        clearTimeout(timer)
        socket.destroy()
        reject(err)
      })
    })
  }

  private setupVideoPipeline(socket: net.Socket, initialChunk: Buffer): void {
    this.parser = new ScrcpyVideoStreamParser({
      onDeviceMeta: () => {
        // 已从 ADB 获取更精确的型号，保留此处仅用于协议状态机推进
      },
      onSessionResize: (width, height) => {
        this.videoWidth = width
        this.videoHeight = height
        this.emit('session-resize', { width, height })
        this.emitState()
      },
      onFrame: (frame) => {
        if (frame.isConfig) {
          this.lastConfigPayload = frame.payload
        } else {
          this.frameCounter += 1
        }
        this.byteCounter += frame.payload.length
        this.emit('frame', frame)
      },
      onStreamDisabled: (code) => {
        this.error = `设备端停止推流 (code=${code})`
        void this.stopInternal('error')
      }
    })

    socket.on('data', (chunk: Buffer) => {
      this.parser?.push(chunk)
    })

    socket.on('close', () => {
      if (this.status === 'running') {
        void this.stopInternal('idle')
      }
    })

    socket.on('error', (err) => {
      if (this.status === 'running') {
        this.error = err.message
        void this.stopInternal('error')
      }
    })

    this.parser.push(initialChunk)
    socket.resume()
  }

  private startStatsLoop(): void {
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.frameCounter = 0
    this.byteCounter = 0
    this.statsTimer = setInterval(() => {
      this.fps = this.frameCounter
      this.bitrateKbps = Math.round((this.byteCounter * 8) / 1000)
      this.frameCounter = 0
      this.byteCounter = 0
      this.emitState()
    }, 1000)
  }

  private async stopInternal(finalStatus: 'idle' | 'error'): Promise<void> {
    if (this.status === 'stopping' || this.status === finalStatus) return
    this.status = 'stopping'
    this.emitState()

    if (this.statsTimer) {
      clearInterval(this.statsTimer)
      this.statsTimer = null
    }

    this.releaseActivePointers()

    if (this.controlSocket) {
      this.controlSocket.destroy()
      this.controlSocket = null
    }
    if (this.videoSocket) {
      this.videoSocket.destroy()
      this.videoSocket = null
    }
    this.parser = null

    if (this.serverProc) {
      const proc = this.serverProc
      this.serverProc = null
      try {
        proc.kill('SIGTERM')
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL')
        }, 500)
      } catch {
        // ignore
      }
    }

    if (this.forwardActive && this.localPort > 0) {
      this.forwardActive = false
      await removeForward(this.adbPath, this.serial, this.localPort)
    }

    this.fps = 0
    this.bitrateKbps = 0
    this.setStatus(finalStatus)
  }

  private isCancelledDuringStart(): boolean {
    return this.status !== 'starting'
  }

  private setStatus(status: MirrorSessionStatus): void {
    this.status = status
    this.emitState()
  }

  private emitState(): void {
    this.emit('state', this.getState())
  }
}
