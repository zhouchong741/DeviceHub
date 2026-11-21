import { Cpu, Link2, Moon, PanelLeft, Sun, Upload, Wifi } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDeviceStore } from '../store/useDeviceStore'
import type { GridCols, QualityPreset } from '../types/droidwall'

const QUALITY_OPTIONS: { value: QualityPreset; label: string }[] = [
  { value: '540p', label: '540p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' }
]

const COL_OPTIONS: GridCols[] = [2, 3, 4]

function getResolvedDark(): boolean {
  const content = document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')
  if (content === 'dark') return true
  if (content === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function Toolbar() {
  const sidebarCollapsed = useDeviceStore((s) => s.sidebarCollapsed)
  const quality = useDeviceStore((s) => s.quality)
  const gridCols = useDeviceStore((s) => s.gridCols)
  const colorScheme = useDeviceStore((s) => s.colorScheme)
  const syncControlEnabled = useDeviceStore((s) => s.syncControlEnabled)
  const devices = useDeviceStore((s) => s.devices)
  const focusedSerial = useDeviceStore((s) => s.focusedSerial)
  const wirelessState = useDeviceStore((s) => s.wirelessState)
  const avds = useDeviceStore((s) => s.avds)
  const activeModal = useDeviceStore((s) => s.activeModal)
  const toggleSidebar = useDeviceStore((s) => s.toggleSidebar)
  const setQuality = useDeviceStore((s) => s.setQuality)
  const setGridCols = useDeviceStore((s) => s.setGridCols)
  const toggleSyncControl = useDeviceStore((s) => s.toggleSyncControl)
  const pickAndDropFiles = useDeviceStore((s) => s.pickAndDropFiles)
  const dropFilesToDevices = useDeviceStore((s) => s.dropFilesToDevices)
  const setActiveModal = useDeviceStore((s) => s.setActiveModal)
  const toggleColorScheme = useDeviceStore((s) => s.toggleColorScheme)

  const onlineSerials = devices.filter((d) => d.state === 'device').map((d) => d.serial)
  const dropTargets = focusedSerial && onlineSerials.includes(focusedSerial) ? [focusedSerial] : onlineSerials
  const connectedWifiDevices = devices.filter((d) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(d.serial))
  const connectedWifiIps = new Set(connectedWifiDevices.map((d) => d.serial.split(':')[0]))
  const wirelessCount =
    connectedWifiDevices.length +
    wirelessState.services.filter(
      (s) => !s.alreadyConnected && !(s.serviceType === 'connect' && connectedWifiIps.has(s.ip))
    ).length

  const toolbarRef = useRef<HTMLDivElement>(null)
  const [isDark, setIsDark] = useState(getResolvedDark)

  useEffect(() => {
    setIsDark(getResolvedDark())
  }, [colorScheme])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setIsDark(getResolvedDark())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // 仅当运行时原生不支持 focusgroup 时挂接 roving-tabindex 键盘导航
  useEffect(() => {
    if ('focusGroup' in HTMLElement.prototype) return
    const bar = toolbarRef.current
    if (!bar) return

    const getItems = (): HTMLButtonElement[] =>
      Array.from(bar.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.offsetParent !== null)

    const syncTabIndex = (active?: HTMLElement | null): void => {
      const items = getItems()
      items.forEach((b, i) => {
        b.tabIndex = active ? (b === active ? 0 : -1) : i === 0 ? 0 : -1
      })
    }

    syncTabIndex()

    const onFocusIn = (e: FocusEvent): void => {
      if (e.target instanceof HTMLButtonElement) {
        syncTabIndex(e.target)
      }
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      const items = getItems()
      const idx = items.indexOf(document.activeElement as HTMLButtonElement)
      if (idx === -1) return
      const rtl = getComputedStyle(bar).direction === 'rtl'
      let next: number | null = null
      if (e.key === 'ArrowRight') next = (idx + (rtl ? -1 : 1) + items.length) % items.length
      else if (e.key === 'ArrowLeft') next = (idx + (rtl ? 1 : -1) + items.length) % items.length
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = items.length - 1

      if (next !== null) {
        e.preventDefault()
        items[next].focus()
      }
    }

    bar.addEventListener('focusin', onFocusIn)
    bar.addEventListener('keydown', onKeyDown)
    return () => {
      bar.removeEventListener('focusin', onFocusIn)
      bar.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <header className="h-[40px] shrink-0 flex items-center justify-between pl-[78px] pr-3 titlebar-drag">
      {/* 左侧：紧跟原生红黄绿按钮右侧的侧栏切换键 + 标题（位置恒定） */}
      <div className="titlebar-nodrag flex items-center gap-1">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-pressed={sidebarCollapsed}
          aria-label="收起或展开侧边栏"
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          className="tb-btn tb-btn-icon"
        >
          <PanelLeft className="w-4 h-4" strokeWidth={1.6} aria-hidden="true" />
        </button>
        <span className="text-[12.5px] font-medium text-[var(--text-secondary)] tracking-tight pl-1">
          DroidWall
        </span>
      </div>

      {/* 右侧：轻量控制工具栏 */}
      <div
        ref={toolbarRef}
        role="toolbar"
        {...({ focusgroup: 'toolbar wrap' } as Record<string, string>)}
        aria-label="DroidWall 控制栏"
        className="titlebar-nodrag flex items-center gap-0.5"
      >
        <div role="group" aria-label="投屏画质" className="flex items-center gap-0.5">
          {QUALITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={quality === opt.value}
              onClick={() => void setQuality(opt.value)}
              className="tb-btn mono-num"
            >
              {opt.label}
            </button>
          ))}
        </div>

        <span role="separator" aria-orientation="vertical" className="tb-sep" />

        <div role="group" aria-label="网格列数" className="flex items-center gap-0.5">
          {COL_OPTIONS.map((cols) => (
            <button
              key={cols}
              type="button"
              aria-pressed={gridCols === cols}
              onClick={() => void setGridCols(cols)}
              className="tb-btn mono-num"
            >
              {cols}列
            </button>
          ))}
        </div>

        <span role="separator" aria-orientation="vertical" className="tb-sep" />

        <button
          type="button"
          onClick={() => void toggleSyncControl()}
          aria-pressed={syncControlEnabled}
          aria-label="一控多群控同步"
          title={
            syncControlEnabled
              ? '群控同步已开启：在任意投屏设备上操作将同步至全部运行中设备'
              : '开启群控同步（一控多）'
          }
          className={`tb-btn inline-flex items-center gap-1 ${
            syncControlEnabled ? 'text-[var(--accent-blue)]' : ''
          }`}
        >
          <Link2 className="w-3.5 h-3.5" strokeWidth={1.7} aria-hidden="true" />
          <span>群控</span>
        </button>

        <button
          type="button"
          aria-disabled={dropTargets.length === 0 ? 'true' : undefined}
          onClick={() => void pickAndDropFiles()}
          onDragOver={(e) => {
            if (dropTargets.length === 0 || !e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dropTargets.length === 0) return
            const paths = Array.from(e.dataTransfer.files)
              .map((f) => window.droidWall.getPathForFile(f))
              .filter(Boolean)
            if (paths.length > 0) {
              void dropFilesToDevices(dropTargets, paths)
            }
          }}
          aria-label="安装 APK 或推送文件"
          title={
            dropTargets.length === 0
              ? '暂无在线设备'
              : focusedSerial
              ? '点击选择或拖入文件，安装/推送到当前专注设备'
              : `点击选择或拖入文件，批量安装/推送到全部 ${dropTargets.length} 台在线设备`
          }
          className="tb-btn inline-flex items-center gap-1"
        >
          <Upload className="w-3.5 h-3.5" strokeWidth={1.7} aria-hidden="true" />
          <span>分发</span>
        </button>

        <button
          type="button"
          aria-pressed={activeModal === 'wireless'}
          onClick={() => setActiveModal(activeModal === 'wireless' ? 'none' : 'wireless')}
          aria-label="无线 ADB 自动发现"
          title="无线 ADB 自动发现与多设备连接"
          className="tb-btn inline-flex items-center gap-1"
        >
          <Wifi className="w-3.5 h-3.5" strokeWidth={1.7} aria-hidden="true" />
          <span>无线{wirelessCount > 0 ? ` (${wirelessCount})` : ''}</span>
        </button>

        <button
          type="button"
          aria-pressed={activeModal === 'emulator'}
          onClick={() => setActiveModal(activeModal === 'emulator' ? 'none' : 'emulator', 'list')}
          aria-label="模拟器管理"
          title="创建、启动与彻底删除 Android 模拟器"
          className="tb-btn inline-flex items-center gap-1"
        >
          <Cpu className="w-3.5 h-3.5" strokeWidth={1.7} aria-hidden="true" />
          <span>模拟器{avds.length > 0 ? ` (${avds.length})` : ''}</span>
        </button>

        <span role="separator" aria-orientation="vertical" className="tb-sep" />

        <button
          type="button"
          onClick={() => void toggleColorScheme()}
          aria-label="切换浅色或深色外观"
          title="切换浅色 / 深色外观"
          className="tb-btn tb-btn-icon"
        >
          {isDark ? (
            <Sun className="w-4 h-4" strokeWidth={1.6} aria-hidden="true" />
          ) : (
            <Moon className="w-4 h-4" strokeWidth={1.6} aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  )
}
