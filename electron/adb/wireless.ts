import { EventEmitter } from 'events'
import type { ActionResult, MdnsAdbService, WirelessDiscoveryState } from '../types'
import { execAdb } from './executor'

const POLL_INTERVAL_MS = 6000
const AUTO_CONNECT_COOLDOWN_MS = 30000

export function parseMdnsServicesOutput(output: string, connectedSerials: Set<string>): MdnsAdbService[] {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const services: MdnsAdbService[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    if (/^List of (?:discovered )?mdns services/i.test(line)) continue
    // adb mdns services 输出格式为 tab 分隔，且 instanceName 可能包含空格（如 "... (2)"）
    const match = line.match(/^(.+?)\s+(_adb(?:-tls-(?:connect|pairing))?\._tcp\.?)\s+(\S+):(\d+)$/)
    if (!match) continue

    const instanceName = match[1].trim()
    const rawType = match[2]
    const ip = match[3]
    const port = Number(match[4])
    if (!ip || !Number.isFinite(port) || port <= 0) continue

    const serviceType: 'connect' | 'pairing' = rawType.includes('pairing') ? 'pairing' : 'connect'
    const address = `${ip}:${port}`
    const dedupKey = `${serviceType}:${address}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)

    services.push({
      instanceName,
      serviceType,
      ip,
      port,
      address,
      alreadyConnected: connectedSerials.has(address)
    })
  }

  return services
}

export class WirelessAdbManager extends EventEmitter {
  private adbPath: string | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private getConnectedSerials: () => Set<string> = () => new Set()
  private autoConnectCooldown = new Map<string, number>()
  private scanInFlight: Promise<WirelessDiscoveryState> | null = null

  private state: WirelessDiscoveryState = {
    supported: false,
    scanning: false,
    autoConnect: true,
    services: []
  }

  setConnectedSerialsProvider(provider: () => Set<string>): void {
    this.getConnectedSerials = provider
  }

  start(adbPath: string | null): void {
    this.stop()
    this.adbPath = adbPath
    if (!adbPath) {
      this.state = {
        supported: false,
        scanning: false,
        autoConnect: this.state.autoConnect,
        services: [],
        lastError: '未检测到有效 adb'
      }
      this.emitState()
      return
    }

    this.state = { ...this.state, supported: true, lastError: undefined }
    // 延迟首次扫描，确保 tracker 已完成首轮设备列表同步，避免重复连接已在线设备
    setTimeout(() => {
      if (this.adbPath === adbPath) {
        void this.scan()
      }
    }, 800)
    this.pollTimer = setInterval(() => {
      void this.scan()
    }, POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  getState(): WirelessDiscoveryState {
    const connected = this.getConnectedSerials()
    return {
      ...this.state,
      services: this.state.services.map((s) => ({
        ...s,
        alreadyConnected: connected.has(s.address)
      }))
    }
  }

  setAutoConnect(enabled: boolean): WirelessDiscoveryState {
    this.state = { ...this.state, autoConnect: enabled }
    this.emitState()
    if (enabled) {
      void this.scan()
    }
    return this.getState()
  }

  async scan(): Promise<WirelessDiscoveryState> {
    if (this.scanInFlight) return this.scanInFlight
    this.scanInFlight = this.doScan().finally(() => {
      this.scanInFlight = null
    })
    return this.scanInFlight
  }

  private async doScan(): Promise<WirelessDiscoveryState> {
    if (!this.adbPath) {
      this.state = { ...this.state, supported: false, scanning: false, services: [] }
      this.emitState()
      return this.getState()
    }

    this.state = { ...this.state, scanning: true }
    this.emitState()

    try {
      const { stdout, stderr } = await execAdb(this.adbPath, ['mdns', 'services'], 5000)
      const combined = `${stdout}\n${stderr}`
      if (/mdns.*disabled|unknown command/i.test(combined)) {
        this.state = {
          ...this.state,
          supported: false,
          scanning: false,
          services: [],
          lastError: '当前 adb 未启用 mDNS 服务'
        }
        this.emitState()
        return this.getState()
      }

      const connected = this.getConnectedSerials()
      const services = parseMdnsServicesOutput(stdout, connected)
      this.state = {
        ...this.state,
        supported: true,
        scanning: false,
        services,
        lastError: undefined
      }
      this.emitState()

      if (this.state.autoConnect) {
        await this.tryAutoConnect(services)
      }

      return this.getState()
    } catch (err) {
      this.state = {
        ...this.state,
        scanning: false,
        lastError: err instanceof Error ? err.message : String(err)
      }
      this.emitState()
      return this.getState()
    }
  }

  private async tryAutoConnect(services: MdnsAdbService[]): Promise<void> {
    if (!this.adbPath) return
    const now = Date.now()

    // 若同一无线 IP 同时存在多个已连端口（例如 :5555 与系统无线调试 TLS 端口），自动断开 :5555 去重
    const portsByIp = new Map<string, string[]>()
    for (const serial of this.getConnectedSerials()) {
      const m = serial.match(/^(\d+\.\d+\.\d+\.\d+):(\d+)$/)
      if (!m) continue
      const list = portsByIp.get(m[1]) ?? []
      list.push(serial)
      portsByIp.set(m[1], list)
    }

    const connectedIps = new Set<string>(portsByIp.keys())
    for (const [ip, serials] of portsByIp.entries()) {
      if (serials.length > 1) {
        const port5555 = `${ip}:5555`
        if (serials.includes(port5555)) {
          await this.disconnect(port5555)
        }
      }
    }

    // 优先连接非 5555 的系统原生无线调试 TLS 端口，再考虑 5555
    const ordered = [...services].sort((a, b) => {
      if (a.serviceType !== b.serviceType) {
        return a.serviceType === 'connect' ? -1 : 1
      }
      if (a.port === 5555 && b.port !== 5555) return 1
      if (a.port !== 5555 && b.port === 5555) return -1
      return 0
    })

    for (const svc of ordered) {
      if (svc.serviceType !== 'connect' || svc.alreadyConnected) continue
      if (connectedIps.has(svc.ip)) continue
      const lastAttempt = this.autoConnectCooldown.get(svc.address) ?? 0
      if (now - lastAttempt < AUTO_CONNECT_COOLDOWN_MS) continue
      this.autoConnectCooldown.set(svc.address, now)
      const res = await this.connect(svc.address)
      if (res.ok) {
        connectedIps.add(svc.ip)
      }
    }
  }

  async connect(address: string): Promise<ActionResult> {
    if (!this.adbPath) return { ok: false, error: '未检测到有效 adb' }
    const target = address.trim()
    if (!target) return { ok: false, error: '请输入有效的 IP:端口' }

    try {
      const { stdout, stderr } = await execAdb(this.adbPath, ['connect', target], 8000)
      const text = `${stdout} ${stderr}`.trim()
      if (/connected to|already connected/i.test(text)) {
        return { ok: true, message: `已连接 ${target}` }
      }
      if (/no route to host/i.test(text)) {
        return {
          ok: false,
          error: `${text}（若「本地网络」权限已开启仍报此错，通常是后台 ADB 守护进程网络状态过期，请点击右上角「重启 ADB」后重试）`
        }
      }
      return { ok: false, error: text || `无法连接 ${target}` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async disconnect(address: string): Promise<ActionResult> {
    if (!this.adbPath) return { ok: false, error: '未检测到有效 adb' }
    const target = address.trim()
    if (!target) return { ok: false, error: '无效的设备地址' }

    try {
      const { stdout, stderr } = await execAdb(this.adbPath, ['disconnect', target], 5000)
      const text = `${stdout} ${stderr}`.trim()
      return { ok: true, message: text || `已断开 ${target}` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async pair(address: string, code: string): Promise<ActionResult> {
    if (!this.adbPath) return { ok: false, error: '未检测到有效 adb' }
    const target = address.trim()
    const pin = code.trim()
    if (!target || !pin) return { ok: false, error: '请输入配对地址和 6 位配对码' }

    try {
      const { stdout, stderr } = await execAdb(this.adbPath, ['pair', target, pin], 10000)
      const text = `${stdout} ${stderr}`.trim()
      if (/successfully paired/i.test(text)) {
        // 配对成功后立即触发一次扫描，若手机已开启无线调试则自动连入
        setTimeout(() => {
          void this.scan()
        }, 600)
        return { ok: true, message: `配对成功 (${target})` }
      }
      return { ok: false, error: text || '配对失败，请确认配对码未过期' }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async switchUsbToWireless(serial: string): Promise<ActionResult> {
    if (!this.adbPath) return { ok: false, error: '未检测到有效 adb' }
    try {
      const { stdout: routeOut } = await execAdb(this.adbPath, ['-s', serial, 'shell', 'ip', 'route'], 5000)
      const ipMatch = routeOut.match(/\bsrc\s+(\d+\.\d+\.\d+\.\d+)\b/)
      if (!ipMatch) {
        return { ok: false, error: '未检测到设备 Wi-Fi 局域网 IP，请确认设备已连接同一 Wi-Fi' }
      }
      const ip = ipMatch[1]
      await execAdb(this.adbPath, ['-s', serial, 'tcpip', '5555'], 8000)
      await new Promise((resolve) => setTimeout(resolve, 1200))
      const res = await this.connect(`${ip}:5555`)
      if (!res.ok) return res
      return { ok: true, message: `已切换为无线连接 (${ip}:5555)，现在可以拔掉 USB 线` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private emitState(): void {
    this.emit('updated', this.getState())
  }
}
