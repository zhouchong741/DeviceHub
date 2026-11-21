import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type {
  ActionResult,
  AdbStatus,
  AndroidDevice,
  AppConfig,
  AvdInfo,
  CreateAvdRequest,
  EmulatorEnvStatus,
  FileDropBatchResult,
  MirrorState,
  QualityPreset,
  ScreenshotResult,
  WirelessDiscoveryState
} from './types'

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

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: DroidWallApi = {
  getAdbStatus: () => ipcRenderer.invoke('adb:get-status'),
  pickAdbPath: () => ipcRenderer.invoke('adb:pick-path'),
  refreshAdb: () => ipcRenderer.invoke('adb:refresh'),
  restartAdbServer: () => ipcRenderer.invoke('adb:restart-server'),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  getMirrorStates: () => ipcRenderer.invoke('mirror:states'),
  getMirrorWsUrl: (serial) => ipcRenderer.invoke('mirror:get-ws-url', serial),
  startMirror: (serial) => ipcRenderer.invoke('mirror:start', serial),
  stopMirror: (serial) => ipcRenderer.invoke('mirror:stop', serial),
  startAllMirrors: () => ipcRenderer.invoke('mirror:start-all'),
  stopAllMirrors: () => ipcRenderer.invoke('mirror:stop-all'),
  setQuality: (quality) => ipcRenderer.invoke('mirror:set-quality', quality),
  getSyncControl: () => ipcRenderer.invoke('mirror:get-sync-control'),
  setSyncControl: (enabled) => ipcRenderer.invoke('mirror:set-sync-control', enabled),
  takeScreenshot: (serial) => ipcRenderer.invoke('device:screenshot', serial),
  pickFilesToDrop: () => ipcRenderer.invoke('device:pick-files'),
  dropFiles: (serials, filePaths) => ipcRenderer.invoke('device:drop-files', serials, filePaths),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:show-in-folder', filePath),
  getConfig: () => ipcRenderer.invoke('config:get'),
  updateConfig: (patch) => ipcRenderer.invoke('config:update', patch),
  getWirelessState: () => ipcRenderer.invoke('wireless:get-state'),
  scanWireless: () => ipcRenderer.invoke('wireless:scan'),
  setWirelessAutoConnect: (enabled) => ipcRenderer.invoke('wireless:set-auto-connect', enabled),
  connectWireless: (address) => ipcRenderer.invoke('wireless:connect', address),
  disconnectWireless: (address) => ipcRenderer.invoke('wireless:disconnect', address),
  pairWireless: (address, code) => ipcRenderer.invoke('wireless:pair', address, code),
  switchUsbToWireless: (serial) => ipcRenderer.invoke('wireless:usb-to-wireless', serial),
  getEmulatorEnv: () => ipcRenderer.invoke('emulator:get-env'),
  listAvds: () => ipcRenderer.invoke('emulator:list'),
  createAvd: (req) => ipcRenderer.invoke('emulator:create', req),
  startAvd: (name, headless) => ipcRenderer.invoke('emulator:start', name, headless),
  stopAvd: (name, runningSerial) => ipcRenderer.invoke('emulator:stop', name, runningSerial),
  wipeAvdData: (name) => ipcRenderer.invoke('emulator:wipe', name),
  deleteAvd: (name, runningSerial) => ipcRenderer.invoke('emulator:delete', name, runningSerial),
  onDevicesUpdated: (cb) => subscribe('devices:updated', cb),
  onMirrorState: (cb) => subscribe('mirror:state', cb),
  onAdbStatus: (cb) => subscribe('adb:status', cb),
  onWirelessUpdated: (cb) => subscribe('wireless:updated', cb)
}

contextBridge.exposeInMainWorld('droidWall', api)
