import { EventEmitter } from 'events'
import type { AndroidDevice, DeviceConnectionState } from '../types'
import { openTrackDevicesStream, type TrackStreamHandle } from './client'
import { execAdb } from './executor'
import { ensureAdbServerStarted } from './locator'

interface CachedDeviceProps {
  manufacturer?: string
  marketName?: string
  model?: string
  androidVersion?: string
  sdkVersion?: number
  physicalWidth?: number
  physicalHeight?: number
}

const VALID_STATES = new Set<DeviceConnectionState>(['device', 'unauthorized', 'offline', 'recovery'])

export function parseTrackDevicesPayload(payload: string): AndroidDevice[] {
  const lines = payload
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const devices: AndroidDevice[] = []
  for (const line of lines) {
    const parts = line.split(/\s+/)
    if (parts.length < 2) continue

    const serial = parts[0]
    const rawState = parts[1] as DeviceConnectionState
    const state: DeviceConnectionState = VALID_STATES.has(rawState) ? rawState : 'unknown'

    let model = serial
    let product: string | undefined
    let device: string | undefined
    let transportId: string | undefined

    for (let i = 2; i < parts.length; i++) {
      const token = parts[i]
      const sep = token.indexOf(':')
      if (sep === -1) continue
      const key = token.slice(0, sep)
      const value = token.slice(sep + 1)
      if (key === 'model' && value) model = value.replace(/_/g, ' ')
      else if (key === 'product') product = value
      else if (key === 'device') device = value
      else if (key === 'transport_id') transportId = value
    }

    devices.push({ serial, state, model, product, device, transportId })
  }

  return devices
}

export class AdbDeviceTracker extends EventEmitter {
  private adbPath: string | null = null
  private stream: TrackStreamHandle | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private retryDelayMs = 1000
  private stopped = false

  private rawDevices: AndroidDevice[] = []
  private propsCache = new Map<string, CachedDeviceProps>()
  private probingSerials = new Set<string>()

  start(adbPath: string): void {
    this.stop()
    this.stopped = false
    this.adbPath = adbPath
    this.retryDelayMs = 1000
    void this.connectStream()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stream?.close()
    this.stream = null
  }

  getDevices(): AndroidDevice[] {
    return this.rawDevices.map((d) => {
      const cached = this.propsCache.get(d.serial)
      if (!cached) return d
      return {
        ...d,
        manufacturer: cached.manufacturer,
        marketName: cached.marketName,
        model: cached.model || d.model,
        androidVersion: cached.androidVersion,
        sdkVersion: cached.sdkVersion,
        physicalWidth: cached.physicalWidth,
        physicalHeight: cached.physicalHeight
      }
    })
  }

  private async connectStream(): Promise<void> {
    if (this.stopped || !this.adbPath) return

    await ensureAdbServerStarted(this.adbPath)
    if (this.stopped) return

    this.stream = openTrackDevicesStream({
      onReady: () => {
        this.retryDelayMs = 1000
        this.emit('server-status', true)
      },
      onPayload: (payload) => {
        this.handleSnapshot(payload)
      },
      onError: () => {
        this.emit('server-status', false)
      },
      onClose: () => {
        this.stream = null
        if (!this.stopped) {
          this.scheduleReconnect()
        }
      }
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    const delay = this.retryDelayMs
    this.retryDelayMs = Math.min(5000, this.retryDelayMs * 2)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connectStream()
    }, delay)
  }

  private handleSnapshot(payload: string): void {
    const nextDevices = parseTrackDevicesPayload(payload)
    const activeSerials = new Set(nextDevices.map((d) => d.serial))

    for (const cachedSerial of Array.from(this.propsCache.keys())) {
      if (!activeSerials.has(cachedSerial)) {
        this.propsCache.delete(cachedSerial)
        this.emit('device-removed', cachedSerial)
      }
    }

    this.rawDevices = nextDevices
    this.emitUpdate()

    for (const dev of nextDevices) {
      if (dev.state === 'device' && !this.propsCache.has(dev.serial) && !this.probingSerials.has(dev.serial)) {
        void this.probeDeviceProps(dev.serial)
      }
    }
  }

  private async probeDeviceProps(serial: string): Promise<void> {
    if (!this.adbPath || this.stopped) return
    this.probingSerials.add(serial)
    try {
      // 单条 shell 命令一次性获取所有关键属性，减少子进程创建
      const cmd = [
        'getprop ro.product.manufacturer',
        'getprop ro.product.marketname',
        'getprop ro.product.model',
        'getprop ro.build.version.release',
        'getprop ro.build.version.sdk',
        'wm size'
      ].join(' && echo "===SEP===" && ')

      const { stdout } = await execAdb(this.adbPath, ['-s', serial, 'shell', cmd], 6000)
      const parts = stdout.split('===SEP===').map((s) => s.trim())
      if (parts.length < 6) return

      const manufacturer = parts[0] || undefined
      const marketName = parts[1] || undefined
      const model = parts[2] || undefined
      const androidVersion = parts[3] || undefined
      const sdkParsed = parseInt(parts[4], 10)
      const sdkVersion = Number.isFinite(sdkParsed) ? sdkParsed : undefined

      let physicalWidth: number | undefined
      let physicalHeight: number | undefined
      const overrideMatch = parts[5].match(/Override size:\s*(\d+)x(\d+)/i)
      const physicalMatch = parts[5].match(/Physical size:\s*(\d+)x(\d+)/i)
      const sizeMatch = overrideMatch || physicalMatch
      if (sizeMatch) {
        physicalWidth = parseInt(sizeMatch[1], 10)
        physicalHeight = parseInt(sizeMatch[2], 10)
      }

      if (this.rawDevices.some((d) => d.serial === serial)) {
        this.propsCache.set(serial, {
          manufacturer,
          marketName,
          model,
          androidVersion,
          sdkVersion,
          physicalWidth,
          physicalHeight
        })
        this.emitUpdate()
      }
    } catch {
      // 设备在探测瞬间断开时忽略
    } finally {
      this.probingSerials.delete(serial)
    }
  }

  private emitUpdate(): void {
    this.emit('devices-updated', this.getDevices())
  }
}
