import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import * as path from 'path'
import { captureScreenshot } from './adb/executor'
import { locateAdb } from './adb/locator'
import { AdbDeviceTracker } from './adb/tracker'
import { getConfig, updateConfig } from './config/store'
import { SessionManager } from './mirror/session-manager'
import { MirrorWsGateway } from './mirror/ws-gateway'
import type { AdbStatus, AppConfig, MirrorState, QualityPreset } from './types'

let mainWindow: BrowserWindow | null = null
let adbStatus: AdbStatus = {
  found: false,
  path: null,
  version: null,
  source: 'none',
  serverRunning: false
}

const tracker = new AdbDeviceTracker()
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
    tracker.start(status.path)
  } else {
    sessionManager.setAdbPath(null)
    tracker.stop()
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

  ipcMain.handle('device:screenshot', async (_e, serial: string) => {
    if (!adbStatus.path) {
      return { ok: false, error: '未检测到有效 adb' }
    }
    const dev = tracker.getDevices().find((d) => d.serial === serial)
    const label = dev?.marketName || dev?.model || serial
    return captureScreenshot(adbStatus.path, serial, label)
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
}

async function shutdownServices(): Promise<void> {
  await sessionManager.stopAll()
  tracker.stop()
  await wsGateway.stop()
}

app.whenReady().then(async () => {
  const cfg = getConfig()
  nativeTheme.themeSource = cfg.colorScheme
  sessionManager.setQuality(cfg.quality).catch(() => undefined)

  tracker.on('devices-updated', (devices) => {
    sendToRenderer('devices:updated', devices)
  })
  tracker.on('device-removed', (serial: string) => {
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
