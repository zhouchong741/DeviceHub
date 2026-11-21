import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { captureScreenshot, execAdb, installApk, pushToDownload } from './adb/executor'
import { locateAdb } from './adb/locator'
import { AdbDeviceTracker } from './adb/tracker'
import { WirelessAdbManager } from './adb/wireless'
import { getConfig, updateConfig } from './config/store'
import { EmulatorManager } from './emulator/manager'
import { SessionManager } from './mirror/session-manager'
import { MirrorWsGateway } from './mirror/ws-gateway'
import type {
  AdbStatus,
  AppConfig,
  CreateAvdRequest,
  FileDropItemResult,
  MirrorState,
  QualityPreset,
  WirelessDiscoveryState
} from './types'

let mainWindow: BrowserWindow | null = null
let adbStatus: AdbStatus = {
  found: false,
  path: null,
  version: null,
  source: 'none',
  serverRunning: false
}

const tracker = new AdbDeviceTracker()
const wirelessManager = new WirelessAdbManager()
const emulatorManager = new EmulatorManager()
const sessionManager = new SessionManager()
const wsGateway = new MirrorWsGateway(sessionManager)

let isQuitting = false
let shutdownDone = false

async function performShutdownAndQuit(): Promise<void> {
  if (shutdownDone) {
    app.quit()
    return
  }
  try {
    await Promise.race([
      shutdownServices(),
      new Promise<void>((resolve) => setTimeout(resolve, 2500))
    ])
  } finally {
    shutdownDone = true
    app.quit()
  }
}

function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

async function initializeAdb(customPath?: string): Promise<AdbStatus> {
  const cfg = getConfig()
  const status = await locateAdb(customPath ?? cfg.adbPath)
  adbStatus = status

  if (status.found && status.path) {
    sessionManager.setAdbPath(status.path)
    emulatorManager.setAdbPath(status.path)
    tracker.start(status.path)
    wirelessManager.start(status.path)
  } else {
    sessionManager.setAdbPath(null)
    emulatorManager.setAdbPath(null)
    tracker.stop()
    wirelessManager.start(null)
  }

  sendToRenderer('adb:status', adbStatus)
  return adbStatus
}

function createMainWindow(): void {
  const isMac = process.platform === 'darwin'

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'DroidWall',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 13, y: 13 },
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const,
          backgroundColor: '#00000000'
        }
      : {
          backgroundColor: '#121419'
        }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow = win
}

function registerIpcHandlers(): void {
  ipcMain.handle('adb:get-status', () => adbStatus)

  ipcMain.handle('adb:refresh', async () => {
    return initializeAdb()
  })

  ipcMain.handle('adb:restart-server', async () => {
    if (!adbStatus.path) {
      return { ok: false, error: '未检测到有效 adb' }
    }
    try {
      await sessionManager.stopAll()
      tracker.stop()
      wirelessManager.stop()
      try {
        await execAdb(adbStatus.path, ['kill-server'], 5000)
      } catch {
        // ignore if server wasn't running
      }
      await execAdb(adbStatus.path, ['start-server'], 10000)
      await initializeAdb(adbStatus.path)
      return { ok: true, message: 'ADB 后台服务已重启' }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('adb:pick-path', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: '选择 Android SDK 中的 adb 可执行文件',
      properties: ['openFile', 'showHiddenFiles'],
      message: '通常位于 ~/Library/Android/sdk/platform-tools/adb'
    })
    if (result.canceled || result.filePaths.length === 0) {
      return adbStatus
    }
    const chosen = result.filePaths[0]
    const nextStatus = await initializeAdb(chosen)
    if (nextStatus.found && nextStatus.path) {
      updateConfig({ adbPath: nextStatus.path })
    }
    return nextStatus
  })

  ipcMain.handle('devices:list', () => tracker.getDevices())
  ipcMain.handle('mirror:states', () => sessionManager.getAllStates())
  ipcMain.handle('mirror:get-ws-url', (_e, serial: string) => wsGateway.getWsUrl(serial))

  ipcMain.handle('mirror:start', async (_e, serial: string) => {
    return sessionManager.startMirror(serial)
  })

  ipcMain.handle('mirror:stop', async (_e, serial: string) => {
    await sessionManager.stopMirror(serial)
  })

  ipcMain.handle('mirror:start-all', async () => {
    const online = tracker.getDevices().filter((d) => d.state === 'device')
    await Promise.allSettled(online.map((d) => sessionManager.startMirror(d.serial)))
  })

  ipcMain.handle('mirror:stop-all', async () => {
    await sessionManager.stopAll()
  })

  ipcMain.handle('mirror:set-quality', async (_e, quality: QualityPreset) => {
    const next = updateConfig({ quality })
    await sessionManager.setQuality(next.quality)
    return next
  })

  ipcMain.handle('mirror:get-sync-control', () => sessionManager.isSyncControlEnabled())

  ipcMain.handle('mirror:set-sync-control', (_e, enabled: boolean) => {
    sessionManager.setSyncControlEnabled(Boolean(enabled))
    return sessionManager.isSyncControlEnabled()
  })

  ipcMain.handle('device:screenshot', async (_e, serial: string) => {
    if (!adbStatus.path) {
      return { ok: false, error: '未检测到有效 adb' }
    }
    const dev = tracker.getDevices().find((d) => d.serial === serial)
    const label = dev?.marketName || dev?.model || serial
    return captureScreenshot(adbStatus.path, serial, label)
  })

  ipcMain.handle('device:pick-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: '选择要安装或推送的文件（支持多选 .apk 或普通文件）',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle('device:drop-files', async (_e, serials: string[], filePaths: string[]) => {
    const adbPath = adbStatus.path
    if (!adbPath) {
      return { ok: false, results: [], error: '未检测到有效 adb' }
    }
    const onlineSet = new Set(tracker.getDevices().filter((d) => d.state === 'device').map((d) => d.serial))
    const targetSerials = Array.from(new Set(serials)).filter((s) => onlineSet.has(s))
    if (targetSerials.length === 0) {
      return { ok: false, results: [], error: '没有处于在线状态的可用设备' }
    }

    const validPaths = Array.from(new Set(filePaths)).filter((p) => typeof p === 'string' && p.length > 0 && fs.existsSync(p))
    if (validPaths.length === 0) {
      return { ok: false, results: [], error: '未检测到有效的本地文件' }
    }

    const results: FileDropItemResult[] = []
    await Promise.all(
      targetSerials.map(async (serial) => {
        for (const localPath of validPaths) {
          const fileName = path.basename(localPath)
          const isApk = fileName.toLowerCase().endsWith('.apk')
          if (isApk) {
            const res = await installApk(adbPath, serial, localPath)
            results.push({ serial, fileName, kind: 'apk', ok: res.ok, error: res.error })
          } else {
            const res = await pushToDownload(adbPath, serial, localPath)
            results.push({
              serial,
              fileName,
              kind: 'file',
              ok: res.ok,
              remotePath: res.remotePath,
              error: res.error
            })
          }
        }
      })
    )

    return {
      ok: results.every((r) => r.ok),
      results
    }
  })

  ipcMain.handle('shell:show-in-folder', (_e, filePath: string) => {
    if (typeof filePath === 'string' && filePath.trim()) {
      shell.showItemInFolder(filePath)
    }
  })

  ipcMain.handle('config:get', () => getConfig())

  ipcMain.handle('config:update', (_e, patch: Partial<AppConfig>) => {
    const next = updateConfig(patch)
    if (patch.colorScheme) {
      nativeTheme.themeSource = next.colorScheme
    }
    return next
  })

  // 无线 ADB 自动发现与连接
  ipcMain.handle('wireless:get-state', () => wirelessManager.getState())
  ipcMain.handle('wireless:scan', () => wirelessManager.scan())
  ipcMain.handle('wireless:set-auto-connect', (_e, enabled: boolean) => wirelessManager.setAutoConnect(Boolean(enabled)))
  ipcMain.handle('wireless:connect', (_e, address: string) => wirelessManager.connect(address))
  ipcMain.handle('wireless:disconnect', (_e, address: string) => wirelessManager.disconnect(address))
  ipcMain.handle('wireless:pair', (_e, address: string, code: string) => wirelessManager.pair(address, code))
  ipcMain.handle('wireless:usb-to-wireless', (_e, serial: string) => wirelessManager.switchUsbToWireless(serial))

  // 模拟器 AVD 管理
  ipcMain.handle('emulator:get-env', () => emulatorManager.getEnvStatus())
  ipcMain.handle('emulator:list', () => emulatorManager.listAvds(tracker.getDevices()))
  ipcMain.handle('emulator:create', (_e, req: CreateAvdRequest) => emulatorManager.createAvd(req))
  ipcMain.handle('emulator:start', (_e, name: string, headless: boolean) => emulatorManager.startAvd(name, headless))
  ipcMain.handle('emulator:stop', (_e, name: string, runningSerial?: string) =>
    emulatorManager.stopAvd(name, runningSerial)
  )
  ipcMain.handle('emulator:wipe', (_e, name: string) => emulatorManager.wipeAvdData(name))
  ipcMain.handle('emulator:delete', (_e, name: string, runningSerial?: string) =>
    emulatorManager.deleteAvd(name, runningSerial)
  )
}

async function shutdownServices(): Promise<void> {
  wirelessManager.stop()
  await sessionManager.stopAll()
  tracker.stop()
  await wsGateway.stop()
}

app.whenReady().then(async () => {
  const cfg = getConfig()
  nativeTheme.themeSource = cfg.colorScheme
  sessionManager.setQuality(cfg.quality).catch(() => undefined)

  wirelessManager.setConnectedSerialsProvider(() => new Set(tracker.getDevices().map((d) => d.serial)))
  wirelessManager.on('updated', (state: WirelessDiscoveryState) => {
    sendToRenderer('wireless:updated', state)
  })

  tracker.on('devices-updated', (devices) => {
    for (const dev of devices) {
      if (dev.state === 'device' && dev.serial.startsWith('emulator-')) {
        void emulatorManager.ensureNetworkReady(dev.serial)
      }
    }
    sendToRenderer('devices:updated', devices)
    sendToRenderer('wireless:updated', wirelessManager.getState())
  })
  tracker.on('device-removed', (serial: string) => {
    emulatorManager.clearNetworkReady(serial)
    void sessionManager.handleDeviceRemoved(serial)
  })
  tracker.on('server-status', (running: boolean) => {
    adbStatus = { ...adbStatus, serverRunning: running }
    sendToRenderer('adb:status', adbStatus)
  })

  sessionManager.on('state', (state: MirrorState) => {
    sendToRenderer('mirror:state', state)
  })

  await wsGateway.start()
  registerIpcHandlers()
  createMainWindow()
  void initializeAdb()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || isQuitting) {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (shutdownDone) return
  event.preventDefault()
  if (isQuitting) return
  isQuitting = true
  void performShutdownAndQuit()
})

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.quit()
  })
}
