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

export interface FileDropItemResult {
  serial: string
  fileName: string
  kind: 'apk' | 'file'
  ok: boolean
  remotePath?: string
  error?: string
}

export interface FileDropBatchResult {
  ok: boolean
  results: FileDropItemResult[]
  error?: string
}

export interface EmulatorSystemImage {
  id: string
  apiLevel: number
  tag: string
  abi: string
  label: string
}

export interface AvdInfo {
  name: string
  target: string
  abi: string
  resolution: string
  path: string
  sizeBytes: number
  runningSerial?: string
  status: 'running' | 'stopped'
}

export interface EmulatorEnvStatus {
  sdkRoot: string | null
  emulatorPath: string | null
  avdmanagerPath: string | null
  systemImages: EmulatorSystemImage[]
  totalAvdBytes: number
}

export type DeviceTemplateId = 'pixel_7' | 'phone_1080' | 'tablet'

export interface CreateAvdRequest {
  name: string
  systemImageId: string
  deviceTemplate: DeviceTemplateId
  ramMb: number
  dataPartitionGb: number
  headless: boolean
  startAfterCreate: boolean
}

export interface ActionResult {
  ok: boolean
  message?: string
  error?: string
}

export interface MdnsAdbService {
  instanceName: string
  serviceType: 'connect' | 'pairing'
  ip: string
  port: number
  address: string
  alreadyConnected: boolean
}

export interface WirelessDiscoveryState {
  supported: boolean
  scanning: boolean
  autoConnect: boolean
  services: MdnsAdbService[]
  lastError?: string
}

export interface DroidWallApi {
  getAdbStatus: () => Promise<AdbStatus>
  pickAdbPath: () => Promise<AdbStatus>
  refreshAdb: () => Promise<AdbStatus>
  restartAdbServer: () => Promise<ActionResult>
  listDevices: () => Promise<AndroidDevice[]>
  getMirrorStates: () => Promise<MirrorState[]>
  getMirrorWsUrl: (serial: string) => Promise<string>
  startMirror: (serial: string) => Promise<MirrorState>
  stopMirror: (serial: string) => Promise<void>
  startAllMirrors: () => Promise<void>
  stopAllMirrors: () => Promise<void>
  setQuality: (quality: QualityPreset) => Promise<AppConfig>
  getSyncControl: () => Promise<boolean>
  setSyncControl: (enabled: boolean) => Promise<boolean>
  takeScreenshot: (serial: string) => Promise<ScreenshotResult>
  pickFilesToDrop: () => Promise<string[]>
  dropFiles: (serials: string[], filePaths: string[]) => Promise<FileDropBatchResult>
  getPathForFile: (file: File) => string
  showItemInFolder: (filePath: string) => Promise<void>
  getConfig: () => Promise<AppConfig>
  updateConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>
  getWirelessState: () => Promise<WirelessDiscoveryState>
  scanWireless: () => Promise<WirelessDiscoveryState>
  setWirelessAutoConnect: (enabled: boolean) => Promise<WirelessDiscoveryState>
  connectWireless: (address: string) => Promise<ActionResult>
  disconnectWireless: (address: string) => Promise<ActionResult>
  pairWireless: (address: string, code: string) => Promise<ActionResult>
  switchUsbToWireless: (serial: string) => Promise<ActionResult>
  getEmulatorEnv: () => Promise<EmulatorEnvStatus>
  listAvds: () => Promise<AvdInfo[]>
  createAvd: (req: CreateAvdRequest) => Promise<ActionResult>
  startAvd: (name: string, headless: boolean) => Promise<ActionResult>
  stopAvd: (name: string, runningSerial?: string) => Promise<ActionResult>
  wipeAvdData: (name: string) => Promise<ActionResult>
  deleteAvd: (name: string, runningSerial?: string) => Promise<ActionResult>
  onDevicesUpdated: (cb: (devices: AndroidDevice[]) => void) => () => void
  onMirrorState: (cb: (state: MirrorState) => void) => () => void
  onAdbStatus: (cb: (status: AdbStatus) => void) => () => void
  onWirelessUpdated: (cb: (state: WirelessDiscoveryState) => void) => () => void
}

declare global {
  interface Window {
    droidWall: DroidWallApi
  }
}
