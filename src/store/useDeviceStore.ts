import { create } from 'zustand'
import type {
  AdbStatus,
  AndroidDevice,
  ColorSchemePreference,
  GridCols,
  MirrorState,
  QualityPreset
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
  hudMessage: string
  toast: ToastItem | null

  bootstrap: () => Promise<() => void>
  setGridCols: (cols: GridCols) => Promise<void>
  setQuality: (quality: QualityPreset) => Promise<void>
  toggleColorScheme: () => Promise<void>
  toggleSidebar: () => void
  toggleFocus: (serial: string) => void
  setHudMessage: (msg: string) => void
  showToast: (payload: Omit<ToastItem, 'id'>) => void
  dismissToast: () => void
  pickAdbPath: () => Promise<void>
  refreshAdb: () => Promise<void>
  startMirror: (serial: string) => Promise<void>
  stopMirror: (serial: string) => Promise<void>
  toggleAllMirrors: () => Promise<void>
  takeScreenshot: (serial: string) => Promise<void>
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
  hudMessage: 'DroidWall 已就绪，连接 Android 真机后即可一键投屏控制。',
  toast: null,

  bootstrap: async () => {
    const [config, adbStatus, devices, states] = await Promise.all([
      window.droidWall.getConfig(),
      window.droidWall.getAdbStatus(),
      window.droidWall.listDevices(),
      window.droidWall.getMirrorStates()
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
      hudMessage: adbStatus.found
        ? `ADB 已接入 (${adbStatus.version || 'ready'})，发现 ${devices.length} 台真机`
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

    return () => {
      unsubDevices()
      unsubMirror()
      unsubAdb()
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
  }
}))
