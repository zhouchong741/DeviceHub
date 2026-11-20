export type QualityPreset = '540p' | '720p' | '1080p'
export type GridCols = 2 | 3 | 4
export type ColorSchemePreference = 'system' | 'light' | 'dark'

export interface AppConfig {
  adbPath?: string
  quality: QualityPreset
  gridCols: GridCols
  colorScheme: ColorSchemePreference
}

export interface AdbStatus {
  found: boolean
  path: string | null
  version: string | null
  source: 'custom' | 'env' | 'android-studio' | 'homebrew' | 'none'
  serverRunning: boolean
  error?: string
}

export type DeviceConnectionState = 'device' | 'unauthorized' | 'offline' | 'recovery' | 'unknown'

export interface AndroidDevice {
  serial: string
  state: DeviceConnectionState
  model: string
  manufacturer?: string
  marketName?: string
  product?: string
  device?: string
  transportId?: string
  androidVersion?: string
  sdkVersion?: number
  physicalWidth?: number
  physicalHeight?: number
}

export type MirrorSessionStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error'

export interface MirrorState {
  serial: string
  status: MirrorSessionStatus
  videoWidth: number
  videoHeight: number
  fps: number
  bitrateKbps: number
  displayPower: boolean
  warning?: string
  error?: string
}

export interface ScreenshotResult {
  ok: boolean
  filePath?: string
  error?: string
}

export interface DroidWallApi {
  getAdbStatus: () => Promise<AdbStatus>
  pickAdbPath: () => Promise<AdbStatus>
  refreshAdb: () => Promise<AdbStatus>
  listDevices: () => Promise<AndroidDevice[]>
  getMirrorStates: () => Promise<MirrorState[]>
  getMirrorWsUrl: (serial: string) => Promise<string>
  startMirror: (serial: string) => Promise<MirrorState>
  stopMirror: (serial: string) => Promise<void>
  startAllMirrors: () => Promise<void>
  stopAllMirrors: () => Promise<void>
  setQuality: (quality: QualityPreset) => Promise<AppConfig>
  takeScreenshot: (serial: string) => Promise<ScreenshotResult>
  showItemInFolder: (filePath: string) => Promise<void>
  getConfig: () => Promise<AppConfig>
  updateConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>
  onDevicesUpdated: (cb: (devices: AndroidDevice[]) => void) => () => void
  onMirrorState: (cb: (state: MirrorState) => void) => () => void
  onAdbStatus: (cb: (status: AdbStatus) => void) => () => void
}

declare global {
  interface Window {
    droidWall: DroidWallApi
  }
}
