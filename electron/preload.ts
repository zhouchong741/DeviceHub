import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AdbStatus,
  AndroidDevice,
  AppConfig,
  MirrorState,
  QualityPreset,
  ScreenshotResult
} from './types'

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
  listDevices: () => ipcRenderer.invoke('devices:list'),
  getMirrorStates: () => ipcRenderer.invoke('mirror:states'),
  getMirrorWsUrl: (serial) => ipcRenderer.invoke('mirror:get-ws-url', serial),
  startMirror: (serial) => ipcRenderer.invoke('mirror:start', serial),
  stopMirror: (serial) => ipcRenderer.invoke('mirror:stop', serial),
  startAllMirrors: () => ipcRenderer.invoke('mirror:start-all'),
  stopAllMirrors: () => ipcRenderer.invoke('mirror:stop-all'),
  setQuality: (quality) => ipcRenderer.invoke('mirror:set-quality', quality),
  takeScreenshot: (serial) => ipcRenderer.invoke('device:screenshot', serial),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:show-in-folder', filePath),
  getConfig: () => ipcRenderer.invoke('config:get'),
  updateConfig: (patch) => ipcRenderer.invoke('config:update', patch),
  onDevicesUpdated: (cb) => subscribe('devices:updated', cb),
  onMirrorState: (cb) => subscribe('mirror:state', cb),
  onAdbStatus: (cb) => subscribe('adb:status', cb)
}

contextBridge.exposeInMainWorld('droidWall', api)
