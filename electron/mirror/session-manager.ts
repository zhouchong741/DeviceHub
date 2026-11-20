import { EventEmitter } from 'events'
import type { MirrorState, QualityPreset } from '../types'
import { DeviceSession } from './device-session'

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, DeviceSession>()
  private adbPath: string | null = null
  private quality: QualityPreset = '720p'

  setAdbPath(adbPath: string | null): void {
    this.adbPath = adbPath
  }

  getQuality(): QualityPreset {
    return this.quality
  }

  getSession(serial: string): DeviceSession | undefined {
    return this.sessions.get(serial)
  }

  getAllStates(): MirrorState[] {
    return Array.from(this.sessions.values()).map((s) => s.getState())
  }

  async startMirror(serial: string): Promise<MirrorState> {
    if (!this.adbPath) {
      throw new Error('尚未检测到有效的 adb 路径')
    }

    const existing = this.sessions.get(serial)
    if (existing) {
      const cur = existing.getState()
      if (cur.status === 'starting' || cur.status === 'running') {
        return cur
      }
      await existing.stop()
      existing.removeAllListeners()
      this.sessions.delete(serial)
    }

    const session = new DeviceSession(serial, this.adbPath, this.quality)
    this.sessions.set(serial, session)

    session.on('state', (state: MirrorState) => {
      this.emit('state', state)
    })
    this.emit('session-created', session)

    await session.start()
    return session.getState()
  }

  async stopMirror(serial: string): Promise<void> {
    const session = this.sessions.get(serial)
    if (!session) return
    await session.stop()
    session.removeAllListeners()
    this.sessions.delete(serial)
    this.emit('state', {
      serial,
      status: 'idle',
      videoWidth: 0,
      videoHeight: 0,
      fps: 0,
      bitrateKbps: 0,
      displayPower: true
    } satisfies MirrorState)
  }

  async setQuality(quality: QualityPreset): Promise<void> {
    if (this.quality === quality) return
    this.quality = quality

    const runningSerials = Array.from(this.sessions.entries())
      .filter(([, s]) => {
        const st = s.getState().status
        return st === 'running' || st === 'starting'
      })
      .map(([serial]) => serial)

    await Promise.all(runningSerials.map((serial) => this.stopMirror(serial)))
    await Promise.all(runningSerials.map((serial) => this.startMirror(serial)))
  }

  async handleDeviceRemoved(serial: string): Promise<void> {
    await this.stopMirror(serial)
  }

  async stopAll(): Promise<void> {
    const serials = Array.from(this.sessions.keys())
    await Promise.all(serials.map((serial) => this.stopMirror(serial)))
  }
}
