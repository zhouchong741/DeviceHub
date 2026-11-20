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
