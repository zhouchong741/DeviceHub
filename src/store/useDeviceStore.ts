import { create } from 'zustand'
import type {
  ActionResult,
  AdbStatus,
  AndroidDevice,
  AvdInfo,
  ColorSchemePreference,
  CreateAvdRequest,
  EmulatorEnvStatus,
  GridCols,
  MirrorState,
  QualityPreset,
  WirelessDiscoveryState
} from '../types/droidwall'

export type ToastTone = 'success' | 'info' | 'warn' | 'error'

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
  actionLabel?: string
  actionFilePath?: string
}

interface DeviceStoreState {
  adbStatus: AdbStatus
  devices: AndroidDevice[]
  mirrorStates: Record<string, MirrorState>
  quality: QualityPreset
  gridCols: GridCols
  colorScheme: ColorSchemePreference
  sidebarCollapsed: boolean
  focusedSerial: string | null
  syncControlEnabled: boolean
  transferringSerials: Record<string, boolean>
  wirelessState: WirelessDiscoveryState
  emulatorEnv: EmulatorEnvStatus
  avds: AvdInfo[]
  creatingAvd: boolean
  startingAvdNames: Record<string, boolean>
  activeModal: 'none' | 'wireless' | 'emulator'
  emulatorModalTab: 'list' | 'create'
  hudMessage: string
  toast: ToastItem | null

  bootstrap: () => Promise<() => void>
  setActiveModal: (modal: 'none' | 'wireless' | 'emulator', emuTab?: 'list' | 'create') => void
  setEmulatorModalTab: (tab: 'list' | 'create') => void
  scanWireless: () => Promise<void>
  setWirelessAutoConnect: (enabled: boolean) => Promise<void>
  connectWireless: (address: string) => Promise<boolean>
  disconnectWireless: (address: string) => Promise<void>
  pairWireless: (address: string, code: string) => Promise<boolean>
  switchUsbToWireless: (serial: string) => Promise<void>
  refreshEmulators: () => Promise<void>
  createAvd: (req: CreateAvdRequest) => Promise<boolean>
  startAvd: (name: string, headless: boolean) => Promise<void>
  stopAvd: (name: string, runningSerial?: string) => Promise<void>
  wipeAvdData: (name: string) => Promise<void>
  deleteAvd: (name: string, runningSerial?: string) => Promise<void>
  setGridCols: (cols: GridCols) => Promise<void>
  setQuality: (quality: QualityPreset) => Promise<void>
  toggleSyncControl: () => Promise<void>
  toggleColorScheme: () => Promise<void>
  toggleSidebar: () => void
  toggleFocus: (serial: string) => void
  setHudMessage: (msg: string) => void
  showToast: (payload: Omit<ToastItem, 'id'>) => void
  dismissToast: () => void
  pickAdbPath: () => Promise<void>
  refreshAdb: () => Promise<void>
  restartAdbServer: () => Promise<void>
  startMirror: (serial: string) => Promise<void>
  stopMirror: (serial: string) => Promise<void>
  toggleAllMirrors: () => Promise<void>
  takeScreenshot: (serial: string) => Promise<void>
  pickAndDropFiles: (serials?: string[]) => Promise<void>
  dropFilesToDevices: (serials: string[], filePaths: string[]) => Promise<void>
}

function getResolvedColorScheme(): 'light' | 'dark' {
  const meta = document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')
  if (meta === 'light' || meta === 'dark') return meta
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyColorSchemeMeta(pref: ColorSchemePreference): void {
  const meta = document.querySelector('meta[name="color-scheme"]')
  if (!meta) return
  if (pref === 'system') {
    meta.setAttribute('content', 'light dark')
    try {
      localStorage.removeItem('droidwall-color-scheme')
    } catch {}
  } else {
    meta.setAttribute('content', pref)
    try {
      localStorage.setItem('droidwall-color-scheme', pref)
    } catch {}
  }
}

export const useDeviceStore = create<DeviceStoreState>((set, get) => ({
  adbStatus: {
    found: false,
    path: null,
    version: null,
    source: 'none',
    serverRunning: false
  },
  devices: [],
  mirrorStates: {},
  quality: '720p',
  gridCols: 3,
  colorScheme: 'system',
  sidebarCollapsed: false,
  focusedSerial: null,
  syncControlEnabled: false,
  transferringSerials: {},
  wirelessState: {
    supported: false,
    scanning: false,
    autoConnect: true,
    services: []
  },
  emulatorEnv: {
    sdkRoot: null,
    emulatorPath: null,
    avdmanagerPath: null,
    systemImages: [],
    totalAvdBytes: 0
  },
  avds: [],
  creatingAvd: false,
  startingAvdNames: {},
  activeModal: 'none',
  emulatorModalTab: 'list',
  hudMessage: 'DroidWall 已就绪，连接 Android 真机后即可一键投屏控制。',
  toast: null,

  bootstrap: async () => {
    const [config, adbStatus, devices, states, syncControlEnabled, wirelessState, emulatorEnv, avds] = await Promise.all([
      window.droidWall.getConfig(),
      window.droidWall.getAdbStatus(),
      window.droidWall.listDevices(),
      window.droidWall.getMirrorStates(),
      window.droidWall.getSyncControl(),
      window.droidWall.getWirelessState(),
      window.droidWall.getEmulatorEnv(),
      window.droidWall.listAvds()
    ])

    applyColorSchemeMeta(config.colorScheme)

    const mirrorMap: Record<string, MirrorState> = {}
    for (const s of states) {
      mirrorMap[s.serial] = s
    }

    set({
      adbStatus,
      devices,
      mirrorStates: mirrorMap,
      quality: config.quality,
      gridCols: config.gridCols,
      colorScheme: config.colorScheme,
      syncControlEnabled,
      wirelessState,
      emulatorEnv,
      avds,
      hudMessage: adbStatus.found
        ? `ADB 已接入 (${adbStatus.version || 'ready'})，发现 ${devices.length} 台设备`
        : adbStatus.error || '未找到 adb，请在左下角手动指定路径'
    })

    const unsubDevices = window.droidWall.onDevicesUpdated((nextDevices) => {
      set((state) => {
        const nextFocused =
          state.focusedSerial && nextDevices.some((d) => d.serial === state.focusedSerial)
            ? state.focusedSerial
            : null
        return { devices: nextDevices, focusedSerial: nextFocused }
      })
      void get().refreshEmulators()
    })

    const unsubMirror = window.droidWall.onMirrorState((nextState) => {
      set((state) => ({
        mirrorStates: {
          ...state.mirrorStates,
          [nextState.serial]: nextState
        }
      }))
    })

    const unsubAdb = window.droidWall.onAdbStatus((nextAdb) => {
      set({ adbStatus: nextAdb })
    })

    const unsubWireless = window.droidWall.onWirelessUpdated((nextWireless) => {
      set({ wirelessState: nextWireless })
    })

    return () => {
      unsubDevices()
      unsubMirror()
      unsubAdb()
      unsubWireless()
    }
  },

  setGridCols: async (cols) => {
    set({ gridCols: cols, focusedSerial: null, hudMessage: `网格布局已切换为 ${cols} 列` })
    await window.droidWall.updateConfig({ gridCols: cols })
  },

  setQuality: async (quality) => {
    set({ quality, hudMessage: `正在切换画质预设至 ${quality}...` })
    await window.droidWall.setQuality(quality)
    set({ hudMessage: `画质预设已切换为 ${quality}` })
  },

  toggleSyncControl: async () => {
    const next = !get().syncControlEnabled
    const confirmed = await window.droidWall.setSyncControl(next)
    const msg = confirmed
      ? '已开启一控多群控同步：任意投屏设备操作将同步到全部运行中设备'
      : '已关闭群控同步，恢复单机独立控制'
    set({
      syncControlEnabled: confirmed,
      hudMessage: msg,
      toast: {
        id: Date.now() + Math.random(),
        message: confirmed ? '已开启群控同步' : '已关闭群控同步',
        tone: confirmed ? 'info' : 'success'
      }
    })
  },

  toggleColorScheme: async () => {
    const current = getResolvedColorScheme()
    const target: 'light' | 'dark' = current === 'dark' ? 'light' : 'dark'
    const system: 'light' | 'dark' = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    const pref: ColorSchemePreference = target === system ? 'system' : target

    applyColorSchemeMeta(pref)
    set({
      colorScheme: pref,
      hudMessage: target === 'dark' ? '已切换至深色液态玻璃外观' : '已切换至浅色液态玻璃外观'
    })
    await window.droidWall.updateConfig({ colorScheme: pref })
  },

  toggleSidebar: () => {
    set((s) => ({
      sidebarCollapsed: !s.sidebarCollapsed,
      hudMessage: !s.sidebarCollapsed ? '已收起设备侧边栏' : '已展开设备侧边栏'
    }))
  },

  toggleFocus: (serial) => {
    set((s) => {
      const next = s.focusedSerial === serial ? null : serial
      return {
        focusedSerial: next,
        hudMessage: next ? `已进入 ${serial} 专注放大视图` : '已恢复多屏网格视图'
      }
    })
  },

  setHudMessage: (msg) => set({ hudMessage: msg }),

  showToast: (payload) =>
    set({
      toast: { ...payload, id: Date.now() + Math.random() },
      hudMessage: payload.message
    }),

  dismissToast: () => set({ toast: null }),

  pickAdbPath: async () => {
    const next = await window.droidWall.pickAdbPath()
    const msg = next.found
      ? `已定位本机 ADB: ${next.path}`
      : next.error || '所选文件不是有效的 adb 可执行程序'
    set({
      adbStatus: next,
      hudMessage: msg,
      toast: {
        id: Date.now() + Math.random(),
        message: msg,
        tone: next.found ? 'info' : 'error'
      }
    })
  },

  refreshAdb: async () => {
    const next = await window.droidWall.refreshAdb()
    const msg = next.found
      ? `ADB 服务正常 · 127.0.0.1:5037 (v${next.version || 'ready'})`
      : next.error || '未检测到 ADB'
    set({
      adbStatus: next,
      hudMessage: msg,
      toast: {
        id: Date.now() + Math.random(),
        message: msg,
        tone: next.found ? 'success' : 'error'
      }
    })
  },

  restartAdbServer: async () => {
    set({ hudMessage: '正在重启 ADB 后台守护进程...' })
    const res = await window.droidWall.restartAdbServer()
    notifyActionResult(set, res)
    if (res.ok) {
      setTimeout(() => void get().scanWireless(), 600)
    }
  },

  startMirror: async (serial) => {
    set({ hudMessage: `正在启动 ${serial} 投屏会话...` })
    try {
      const state = await window.droidWall.startMirror(serial)
      set((s) => ({
        mirrorStates: { ...s.mirrorStates, [serial]: state },
        hudMessage: state.error ? `投屏失败: ${state.error}` : `${serial} 投屏已连接`,
        ...(state.error
          ? {
              toast: {
                id: Date.now() + Math.random(),
                message: `投屏失败: ${state.error}`,
                tone: 'error' as const
              }
            }
          : {})
      }))
    } catch (err) {
      const msg = `投屏启动失败: ${err instanceof Error ? err.message : String(err)}`
      set({
        hudMessage: msg,
        toast: { id: Date.now() + Math.random(), message: msg, tone: 'error' }
      })
    }
  },

  stopMirror: async (serial) => {
    await window.droidWall.stopMirror(serial)
    set({ hudMessage: `已断开 ${serial} 投屏会话` })
  },

  toggleAllMirrors: async () => {
    const { devices, mirrorStates } = get()
    const online = devices.filter((d) => d.state === 'device')
    if (online.length === 0) {
      const msg = '当前没有处于可投屏状态的在线真机'
      set({
        hudMessage: msg,
        toast: { id: Date.now() + Math.random(), message: msg, tone: 'warn' }
      })
      return
    }
    const anyActive = online.some((d) => {
      const st = mirrorStates[d.serial]?.status
      return st === 'running' || st === 'starting'
    })
    if (anyActive) {
      set({ hudMessage: '正在停止全部投屏会话...' })
      await window.droidWall.stopAllMirrors()
      set({ hudMessage: '已断开全部真机投屏' })
    } else {
      set({ hudMessage: `正在并发启动 ${online.length} 台真机投屏...` })
      await window.droidWall.startAllMirrors()
      set({ hudMessage: `已向 ${online.length} 台真机发起投屏` })
    }
  },

  takeScreenshot: async (serial) => {
    const res = await window.droidWall.takeScreenshot(serial)
    if (res.ok && res.filePath) {
      const shortPath = res.filePath.replace(/^\/Users\/[^/]+/, '~')
      const msg = `已保存截图 · ${shortPath}`
      set({
        hudMessage: msg,
        toast: {
          id: Date.now() + Math.random(),
          message: msg,
          tone: 'success',
          actionLabel: '在 Finder 中显示',
          actionFilePath: res.filePath
        }
      })
    } else {
      const msg = `截图失败: ${res.error || '未知错误'}`
      set({
        hudMessage: msg,
        toast: {
          id: Date.now() + Math.random(),
          message: msg,
          tone: 'error'
        }
      })
    }
  },

  pickAndDropFiles: async (serials) => {
    const { devices, focusedSerial, dropFilesToDevices } = get()
    const onlineSerials = devices.filter((d) => d.state === 'device').map((d) => d.serial)
    const targets =
      serials && serials.length > 0
        ? serials.filter((s) => onlineSerials.includes(s))
        : focusedSerial && onlineSerials.includes(focusedSerial)
        ? [focusedSerial]
        : onlineSerials

    if (targets.length === 0) {
      const msg = '当前没有处于在线状态的可用设备'
      set({
        hudMessage: msg,
        toast: { id: Date.now() + Math.random(), message: msg, tone: 'warn' }
      })
      return
    }

    const filePaths = await window.droidWall.pickFilesToDrop()
    if (filePaths.length > 0) {
      await dropFilesToDevices(targets, filePaths)
    }
  },

  dropFilesToDevices: async (serials, filePaths) => {
    if (serials.length === 0 || filePaths.length === 0) return

    set((s) => {
      const next = { ...s.transferringSerials }
      for (const serial of serials) next[serial] = true
      return {
        transferringSerials: next,
        hudMessage: `正在向 ${serials.length} 台设备处理 ${filePaths.length} 个文件...`
      }
    })

    try {
      const res = await window.droidWall.dropFiles(serials, filePaths)
      const okCount = res.results.filter((r) => r.ok).length
      const failCount = res.results.length - okCount

      let msg = res.error || ''
      let tone: ToastTone = 'error'

      if (res.results.length > 0) {
        if (failCount === 0) {
          const allApk = res.results.every((r) => r.kind === 'apk')
          const allFile = res.results.every((r) => r.kind === 'file')
          const verb = allApk ? '安装完成' : allFile ? '已推送至 /sdcard/Download' : '分发完成'
          msg = `${verb}（共 ${okCount} 项）`
          tone = 'success'
        } else if (okCount > 0) {
          const firstErr = res.results.find((r) => !r.ok)?.error
          msg = `部分完成：${okCount} 成功，${failCount} 失败${firstErr ? ` (${firstErr})` : ''}`
          tone = 'warn'
        } else {
          const firstErr = res.results[0]?.error || '执行失败'
          msg = `操作失败：${firstErr}`
          tone = 'error'
        }
      }

      set({
        hudMessage: msg,
        toast: {
          id: Date.now() + Math.random(),
          message: msg,
          tone
        }
      })
    } finally {
      set((s) => {
        const next = { ...s.transferringSerials }
        for (const serial of serials) delete next[serial]
        return { transferringSerials: next }
      })
    }
  },

  setActiveModal: (modal, emuTab) => {
    set((s) => ({
      activeModal: modal,
      emulatorModalTab: emuTab ?? s.emulatorModalTab
    }))
    if (modal === 'wireless') {
      void get().scanWireless()
    } else if (modal === 'emulator') {
      void get().refreshEmulators()
    }
  },

  setEmulatorModalTab: (tab) => set({ emulatorModalTab: tab }),

  scanWireless: async () => {
    const next = await window.droidWall.scanWireless()
    set({ wirelessState: next })
  },

  setWirelessAutoConnect: async (enabled) => {
    const next = await window.droidWall.setWirelessAutoConnect(enabled)
    set({ wirelessState: next })
  },

  connectWireless: async (address) => {
    const res = await window.droidWall.connectWireless(address)
    notifyActionResult(set, res)
    if (res.ok) void get().scanWireless()
    return res.ok
  },

  disconnectWireless: async (address) => {
    const res = await window.droidWall.disconnectWireless(address)
    notifyActionResult(set, res)
    if (res.ok) void get().scanWireless()
  },

  pairWireless: async (address, code) => {
    const res = await window.droidWall.pairWireless(address, code)
    notifyActionResult(set, res)
    if (res.ok) void get().scanWireless()
    return res.ok
  },

  switchUsbToWireless: async (serial) => {
    set({ hudMessage: `正在将 ${serial} 切换为无线连接...` })
    const res = await window.droidWall.switchUsbToWireless(serial)
    notifyActionResult(set, res)
    if (res.ok) void get().scanWireless()
  },

  refreshEmulators: async () => {
    const [emulatorEnv, avds] = await Promise.all([
      window.droidWall.getEmulatorEnv(),
      window.droidWall.listAvds()
    ])
    set((s) => {
      const nextStarting = { ...s.startingAvdNames }
      for (const avd of avds) {
        if (avd.status === 'running') {
          delete nextStarting[avd.name]
        }
      }
      return { emulatorEnv, avds, startingAvdNames: nextStarting }
    })
  },

  createAvd: async (req) => {
    const cleanName = req.name.trim()
    set((s) => ({
      creatingAvd: true,
      hudMessage: `正在创建模拟器 ${cleanName}...`,
      ...(req.startAfterCreate ? { startingAvdNames: { ...s.startingAvdNames, [cleanName]: true } } : {})
    }))
    try {
      const res = await window.droidWall.createAvd(req)
      notifyActionResult(set, res)
      await get().refreshEmulators()
      if (!res.ok || !req.startAfterCreate) {
        set((s) => {
          const next = { ...s.startingAvdNames }
          delete next[cleanName]
          return { startingAvdNames: next }
        })
      } else {
        setTimeout(() => {
          set((s) => {
            const next = { ...s.startingAvdNames }
            delete next[cleanName]
            return { startingAvdNames: next }
          })
          void get().refreshEmulators()
        }, 25000)
      }
      return res.ok
    } finally {
      set({ creatingAvd: false })
    }
  },

  startAvd: async (name, headless) => {
    set((s) => ({
      startingAvdNames: { ...s.startingAvdNames, [name]: true },
      hudMessage: `正在启动模拟器 ${name}...`
    }))
    const res = await window.droidWall.startAvd(name, headless)
    notifyActionResult(set, res)
    if (!res.ok) {
      set((s) => {
        const next = { ...s.startingAvdNames }
        delete next[name]
        return { startingAvdNames: next }
      })
      return
    }
    setTimeout(() => void get().refreshEmulators(), 2000)
    setTimeout(() => void get().refreshEmulators(), 6000)
    setTimeout(() => {
      set((s) => {
        const next = { ...s.startingAvdNames }
        delete next[name]
        return { startingAvdNames: next }
      })
      void get().refreshEmulators()
    }, 25000)
  },

  stopAvd: async (name, runningSerial) => {
    const res = await window.droidWall.stopAvd(name, runningSerial)
    notifyActionResult(set, res)
    setTimeout(() => void get().refreshEmulators(), 1000)
  },

  wipeAvdData: async (name) => {
    const res = await window.droidWall.wipeAvdData(name)
    notifyActionResult(set, res)
    await get().refreshEmulators()
  },

  deleteAvd: async (name, runningSerial) => {
    const res = await window.droidWall.deleteAvd(name, runningSerial)
    notifyActionResult(set, res)
    await get().refreshEmulators()
  }
}))

function notifyActionResult(
  set: (partial: Partial<DeviceStoreState>) => void,
  res: ActionResult
): void {
  const msg = res.ok ? res.message || '操作成功' : res.error || '操作失败'
  set({
    hudMessage: msg,
    toast: {
      id: Date.now() + Math.random(),
      message: msg,
      tone: res.ok ? 'success' : 'error'
    }
  })
}
