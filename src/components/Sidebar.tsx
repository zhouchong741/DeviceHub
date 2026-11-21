import { FolderOpen, Pause, Play, RefreshCw } from 'lucide-react'
import { useDeviceStore } from '../store/useDeviceStore'
import { formatBytes } from './EmulatorModal'

export function Sidebar() {
  const adbStatus = useDeviceStore((s) => s.adbStatus)
  const devices = useDeviceStore((s) => s.devices)
  const avds = useDeviceStore((s) => s.avds)
  const startingAvdNames = useDeviceStore((s) => s.startingAvdNames)
  const mirrorStates = useDeviceStore((s) => s.mirrorStates)
  const sidebarCollapsed = useDeviceStore((s) => s.sidebarCollapsed)
  const focusedSerial = useDeviceStore((s) => s.focusedSerial)
  const toggleFocus = useDeviceStore((s) => s.toggleFocus)
  const toggleAllMirrors = useDeviceStore((s) => s.toggleAllMirrors)
  const startMirror = useDeviceStore((s) => s.startMirror)
  const stopMirror = useDeviceStore((s) => s.stopMirror)
  const setActiveModal = useDeviceStore((s) => s.setActiveModal)
  const pickAdbPath = useDeviceStore((s) => s.pickAdbPath)
  const refreshAdb = useDeviceStore((s) => s.refreshAdb)

  if (sidebarCollapsed) return null

  const onlineDevices = devices.filter((d) => d.state === 'device')
  const anyActive = onlineDevices.some((d) => {
    const st = mirrorStates[d.serial]?.status
    return st === 'running' || st === 'starting'
  })

  return (
    <aside
      aria-label="设备侧边栏"
      className="w-[236px] shrink-0 flex flex-col justify-between px-2.5 pt-1 pb-2.5 overflow-hidden"
    >
      <div className="flex flex-col flex-1 min-h-0">
        {/* Antigravity "+ New Conversation" 同款全宽圆角细边框主按钮 */}
        <button
          type="button"
          aria-disabled={onlineDevices.length === 0 ? 'true' : undefined}
          onClick={() => {
            if (onlineDevices.length === 0) return
            void toggleAllMirrors()
          }}
          className="sidebar-primary-btn w-full px-3 py-2 rounded-[10px] flex items-center gap-2 text-[13px] font-medium text-[var(--text-primary)] cursor-pointer shrink-0 disabled:opacity-50"
          title={anyActive ? '停止全部正在投屏的设备' : '一键投屏所有在线真机'}
        >
          {anyActive ? (
            <Pause className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <Play className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden="true" />
          )}
          <span>{anyActive ? '暂停全部投屏' : '一键全部投屏'}</span>
        </button>

        {/* 设备列表 */}
        <div className="mt-3.5 px-1.5 flex items-center justify-between shrink-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            已连接设备 (<span className="mono-num">{devices.length}</span>)
          </span>
          <button
            type="button"
            onClick={() => setActiveModal('wireless')}
            className="text-[11px] font-medium text-[var(--accent-blue)] hover:underline cursor-pointer"
          >
            + 无线
          </button>
        </div>

        <div className="mt-1.5 flex-1 overflow-y-auto glass-scroller space-y-0.5 pr-0.5">
          {devices.length === 0 ? (
            <div className="px-2.5 py-6 text-center rounded-[10px] bg-[var(--tint-hover)] text-[11.5px] text-[var(--text-tertiary)] leading-relaxed">
              暂未检测到 Android 真机
              <br />
              请通过 USB 连接并开启调试
            </div>
          ) : (
            devices.map((dev) => {
              const mirror = mirrorStates[dev.serial]
              const status = mirror?.status ?? 'idle'
              const isMirroring = status === 'running' || status === 'starting'
              const isUnauth = dev.state === 'unauthorized'
              const isOffline = dev.state === 'offline' || dev.state === 'unknown'
              const displayName = dev.marketName || dev.model || dev.serial
              const isFocused = focusedSerial === dev.serial

              const dotColor = isUnauth
                ? 'bg-[var(--accent-amber)]'
                : isOffline
                ? 'bg-[var(--accent-red)]'
                : isMirroring
                ? 'bg-[var(--accent-green)]'
                : 'bg-[var(--text-tertiary)]'

              const resText =
                mirror && mirror.videoWidth > 0
                  ? `${mirror.videoWidth}×${mirror.videoHeight}`
                  : dev.physicalWidth && dev.physicalHeight
                  ? `${dev.physicalWidth}×${dev.physicalHeight}`
                  : dev.serial

              return (
                <div
                  key={dev.serial}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (dev.state === 'device') {
                      if (isMirroring) toggleFocus(dev.serial)
                      else void startMirror(dev.serial)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      if (dev.state === 'device') {
                        if (isMirroring) toggleFocus(dev.serial)
                        else void startMirror(dev.serial)
                      }
                    }
                  }}
                  className={`sidebar-row rounded-[9px] px-2.5 py-2 cursor-pointer border ${
                    isFocused
                      ? 'bg-[var(--tint-active)] border-[var(--action-pill-border)]'
                      : 'border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
                      <span className="text-[12.5px] font-medium truncate text-[var(--text-primary)]">
                        {displayName}
                      </span>
                    </div>

                    {isUnauth ? (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--accent-amber)]/15 text-[var(--accent-amber)] shrink-0">
                        未授权
                      </span>
                    ) : isOffline ? (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--accent-red)]/15 text-[var(--accent-red)] shrink-0">
                        离线
                      </span>
                    ) : isMirroring ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          void stopMirror(dev.serial)
                        }}
                        className="text-[10.5px] font-medium text-[var(--accent-green)] hover:underline shrink-0 cursor-pointer"
                      >
                        {status === 'starting' ? '连接中' : '投屏中'}
                      </button>
                    ) : (
                      <span className="text-[10.5px] text-[var(--text-tertiary)] shrink-0">就绪</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-1 pl-4 text-[11px] text-[var(--text-tertiary)]">
                    <span className="mono-num truncate">{resText}</span>
                    <span className="truncate ml-2">
                      {dev.androidVersion ? `Android ${dev.androidVersion}` : dev.model}
                    </span>
                  </div>
                </div>
              )
            })
          )}

          {/* 模拟器 AVD 快速分组 */}
          <div className="pt-3 px-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              模拟器 AVD (<span className="mono-num">{avds.length}</span>)
            </span>
            <button
              type="button"
              onClick={() => setActiveModal('emulator', 'create')}
              className="text-[11px] font-medium text-[var(--accent-blue)] hover:underline cursor-pointer"
            >
              + 新建
            </button>
          </div>

          {avds.length === 0 ? (
            <button
              type="button"
              onClick={() => setActiveModal('emulator', 'create')}
              className="w-full px-2.5 py-2.5 text-center rounded-[10px] bg-[var(--tint-hover)] text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              暂无模拟器 · 点击新建或管理
            </button>
          ) : (
            avds.map((avd) => (
              <div
                key={avd.name}
                role="button"
                tabIndex={0}
                onClick={() => setActiveModal('emulator', 'list')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setActiveModal('emulator', 'list')
                  }
                }}
                className="sidebar-row rounded-[9px] px-2.5 py-2 cursor-pointer border border-transparent"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        avd.status === 'running'
                          ? 'bg-[var(--accent-green)]'
                          : startingAvdNames[avd.name]
                          ? 'bg-[var(--accent-blue)] animate-pulse'
                          : 'bg-[var(--text-tertiary)]'
                      }`}
                    />
                    <span className="text-[12.5px] font-medium truncate text-[var(--text-primary)]">{avd.name}</span>
                  </div>
                  <span
                    className={`text-[10.5px] shrink-0 ${
                      avd.status === 'running'
                        ? 'text-[var(--accent-green)] font-medium'
                        : startingAvdNames[avd.name]
                        ? 'text-[var(--accent-blue)] font-medium'
                        : 'text-[var(--text-tertiary)]'
                    }`}
                  >
                    {avd.status === 'running' ? '运行中' : startingAvdNames[avd.name] ? '启动中' : '已关机'}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1 pl-4 text-[11px] text-[var(--text-tertiary)]">
                  <span className="mono-num truncate">{avd.runningSerial || avd.resolution.split(' · ')[0]}</span>
                  <span className="mono-num shrink-0 ml-2">{formatBytes(avd.sizeBytes)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 底部轻盈扁平 ADB 状态行 */}
      <div className="pt-2 mt-2 border-t border-[var(--shell-divider)] px-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              adbStatus.found && adbStatus.serverRunning
                ? 'bg-[var(--accent-green)]'
                : adbStatus.found
                ? 'bg-[var(--accent-amber)]'
                : 'bg-[var(--accent-red)]'
            }`}
          />
          <div className="min-w-0">
            <div className="text-[11.5px] font-medium truncate text-[var(--text-primary)]">
              {adbStatus.found ? 'Android SDK ADB' : '未检测到 ADB'}
            </div>
            <div className="mono-num text-[10px] truncate text-[var(--text-tertiary)]" title={adbStatus.path ?? ''}>
              {adbStatus.found ? `v${adbStatus.version ?? '?'} · 5037` : '点击右侧手动选择'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => void pickAdbPath()}
            title="手动选择 adb 可执行文件"
            aria-label="手动选择 adb 可执行文件"
            className="nav-btn w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-secondary)] cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" strokeWidth={1.6} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void refreshAdb()}
            title="刷新 ADB 状态"
            aria-label="刷新 ADB 状态"
            className="nav-btn w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-secondary)] cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  )
}
