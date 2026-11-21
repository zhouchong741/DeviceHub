import {
  Camera,
  ChevronLeft,
  Circle,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Power,
  RotateCw,
  ShieldAlert,
  Square,
  Upload
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useMirrorStream } from '../hooks/useMirrorStream'
import { useNormalizedControl } from '../hooks/useNormalizedControl'
import { useDeviceStore } from '../store/useDeviceStore'
import type { AndroidDevice } from '../types/droidwall'

interface DeviceCardProps {
  device: AndroidDevice
  focused: boolean
}

export function DeviceCard({ device, focused }: DeviceCardProps) {
  const mirrorState = useDeviceStore((s) => s.mirrorStates[device.serial])
  const syncControlEnabled = useDeviceStore((s) => s.syncControlEnabled)
  const isTransferring = useDeviceStore((s) => Boolean(s.transferringSerials[device.serial]))
  const startMirror = useDeviceStore((s) => s.startMirror)
  const stopMirror = useDeviceStore((s) => s.stopMirror)
  const toggleFocus = useDeviceStore((s) => s.toggleFocus)
  const takeScreenshot = useDeviceStore((s) => s.takeScreenshot)
  const dropFilesToDevices = useDeviceStore((s) => s.dropFilesToDevices)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const status = mirrorState?.status ?? 'idle'

  const { videoSize, wsConnected, liveState, sendControl } = useMirrorStream(device.serial, status, canvasRef)

  const effectiveState = liveState ?? mirrorState
  const isRunning = status === 'running'
  const isStarting = status === 'starting'
  const isUnauth = device.state === 'unauthorized'
  const isOffline = device.state === 'offline' || device.state === 'unknown'
  const displayPower = effectiveState?.displayPower ?? true

  const controlHandlers = useNormalizedControl(isRunning && wsConnected, sendControl, canvasRef)

  const displayName = device.marketName || device.model || device.serial
  const osLabel = device.androidVersion ? `Android ${device.androidVersion}` : device.serial

  const aspectW =
    videoSize.width > 0
      ? videoSize.width
      : effectiveState?.videoWidth && effectiveState.videoWidth > 0
      ? effectiveState.videoWidth
      : device.physicalWidth ?? 9
  const aspectH =
    videoSize.height > 0
      ? videoSize.height
      : effectiveState?.videoHeight && effectiveState.videoHeight > 0
      ? effectiveState.videoHeight
      : device.physicalHeight ?? 19.5

  const screenRatio = Number((aspectW / aspectH).toFixed(4))
  const isLandscape = screenRatio > 1.15
  const cardMaxWidth = focused
    ? `min(100%, max(260px, calc((100vh - 155px) * ${screenRatio} + 12px)))`
    : isLandscape
    ? `min(100%, calc((100vh - 175px) * ${screenRatio} + 12px))`
    : `min(100%, max(238px, calc((100vh - 175px) * ${screenRatio} + 12px)))`

  const dotClass = isUnauth
    ? 'bg-[var(--accent-amber)]'
    : isOffline
    ? 'bg-[var(--accent-red)]'
    : isRunning
    ? 'bg-[var(--accent-green)]'
    : isStarting
    ? 'bg-[var(--accent-blue)] animate-pulse'
    : 'bg-[var(--text-tertiary)]'

  const handleDragOver = (e: React.DragEvent<HTMLElement>): void => {
    if (device.state !== 'device') return
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    if (!isDragOver) setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLElement>): void => {
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (device.state !== 'device') return
    const filePaths = Array.from(e.dataTransfer.files)
      .map((f) => window.droidWall.getPathForFile(f))
      .filter(Boolean)
    if (filePaths.length > 0) {
      void dropFilesToDevices([device.serial], filePaths)
    }
  }

  return (
    <article
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`device-card relative mx-auto w-full overflow-hidden flex flex-col transition-shadow ${
        !focused && isLandscape ? 'sm:col-span-2' : ''
      } ${isDragOver ? 'ring-2 ring-[var(--accent-blue)]' : ''}`}
      style={{ maxWidth: cardMaxWidth }}
    >
      {/* 卡片顶栏 */}
      <div className="px-3.5 py-2 flex items-center justify-between gap-2 border-b border-[var(--shell-divider)] bg-[var(--device-bar-bg)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold truncate text-[var(--text-primary)]">{displayName}</div>
            <div className="mono-num text-[10.5px] text-[var(--text-tertiary)] truncate">{osLabel}</div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isRunning && syncControlEnabled && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] mr-0.5">
              同步
            </span>
          )}
          {isRunning && (
            <span className="mono-num text-[10.5px] text-[var(--text-tertiary)] mr-1">
              {effectiveState?.fps ?? 0}fps
            </span>
          )}

          <button
            type="button"
            aria-disabled={device.state !== 'device' ? 'true' : undefined}
            onClick={() => {
              if (device.state !== 'device') return
              if (isRunning || isStarting) {
                void stopMirror(device.serial)
              } else {
                void startMirror(device.serial)
              }
            }}
            aria-label={isRunning || isStarting ? '停止投屏' : '开始投屏'}
            title={isRunning || isStarting ? '停止投屏' : '开始投屏'}
            className="nav-btn w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] cursor-pointer"
          >
            {isRunning || isStarting ? (
              <Pause className="w-3.5 h-3.5" strokeWidth={1.7} aria-hidden="true" />
            ) : (
              <Play className="w-3.5 h-3.5" strokeWidth={1.7} aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => toggleFocus(device.serial)}
            aria-label={focused ? '退出专注模式' : '专注放大'}
            title={focused ? '退出专注模式' : '专注放大'}
            className="nav-btn w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] cursor-pointer"
          >
            {focused ? (
              <Minimize2 className="w-3.5 h-3.5" strokeWidth={1.6} aria-hidden="true" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" strokeWidth={1.6} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* 屏幕区域：内边距 6px，内屏圆角 14px，同心几何且画面严丝合缝铺满 */}
      <div className="relative p-1.5 bg-[var(--device-well)] overscroll-contain">
        <div
          className="relative w-full overflow-hidden rounded-[14px] bg-black"
          style={{
            aspectRatio: `${aspectW} / ${aspectH}`
          }}
        >
          <canvas
            ref={canvasRef}
            tabIndex={0}
            aria-label={`${displayName} 实时投屏画布`}
            className="device-screen-canvas device-canvas-focus w-full h-full block cursor-pointer touch-none"
            {...controlHandlers}
          />

          {/* 非运行状态的语义遮罩引导 */}
          {!isRunning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-black/55 backdrop-blur-sm rounded-[14px] gap-3">
              {isUnauth ? (
                <>
                  <ShieldAlert className="w-7 h-7 text-[var(--accent-amber)]" strokeWidth={1.5} aria-hidden="true" />
                  <div className="space-y-1">
                    <div className="text-[12.5px] font-medium text-white">等待 USB 调试授权</div>
                    <div className="text-[11px] text-white/65">请在手机弹出框中点击「允许」</div>
                  </div>
                </>
              ) : isOffline ? (
                <div className="text-[12px] text-white/70">设备当前处于离线状态</div>
              ) : isStarting ? (
                <>
                  <Loader2 className="w-6 h-6 text-[var(--accent-blue)] animate-spin" strokeWidth={1.7} aria-hidden="true" />
                  <div className="text-[12px] text-white/85">正在建立 scrcpy v5.0.1 硬件视频流...</div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <div className="text-[12.5px] font-medium text-white">
                      {status === 'error' ? '投屏异常中断' : '真机已就绪'}
                    </div>
                    {effectiveState?.error && (
                      <div className="text-[11px] text-[var(--accent-red)] max-w-[220px] break-words">
                        {effectiveState.error}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void startMirror(device.serial)}
                    className="px-3.5 py-1.5 rounded-full bg-[var(--accent-blue)] text-white text-[12px] font-medium hover:brightness-110 transition cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden="true" />
                    <span>开始投屏</span>
                  </button>
                </>
              )}
            </div>
          )}

          {/* 小米 / HyperOS 注入权限告警条 */}
          {isRunning && effectiveState?.warning && (
            <div className="absolute inset-x-3 bottom-3 px-2.5 py-2 rounded-xl bg-black/80 border border-[var(--accent-amber)]/50 text-[11px] text-amber-200 leading-snug pointer-events-none">
              {effectiveState.warning}
            </div>
          )}

          {/* 拖拽安装 / 文件推送引导遮罩 */}
          {(isDragOver || isTransferring) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-black/65 backdrop-blur-md rounded-[14px] gap-2 pointer-events-none">
              {isTransferring ? (
                <>
                  <Loader2 className="w-6 h-6 text-[var(--accent-blue)] animate-spin" strokeWidth={1.7} aria-hidden="true" />
                  <div className="text-[12px] font-medium text-white">正在安装 / 传输文件...</div>
                </>
              ) : (
                <>
                  <Upload className="w-6 h-6 text-[var(--accent-blue)]" strokeWidth={1.7} aria-hidden="true" />
                  <div className="text-[12px] font-medium text-white">释放以安装 APK 或推送文件</div>
                  <div className="text-[10.5px] text-white/65">普通文件将保存至 /sdcard/Download</div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 卡片底部控制条 */}
      <div className="px-2.5 py-1.5 flex items-center justify-between bg-[var(--device-bar-bg)] border-t border-[var(--shell-divider)] text-[var(--text-secondary)]">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-disabled={!isRunning ? 'true' : undefined}
            onClick={() => isRunning && sendControl({ type: 'nav', key: 'back' })}
            aria-label="返回 Back"
            title="返回 (Back)"
            className="nav-btn w-8 h-7 rounded-full flex items-center justify-center cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={1.7} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-disabled={!isRunning ? 'true' : undefined}
            onClick={() => isRunning && sendControl({ type: 'nav', key: 'home' })}
            aria-label="桌面 Home"
            title="桌面 (Home)"
            className="nav-btn w-8 h-7 rounded-full flex items-center justify-center cursor-pointer"
          >
            <Circle className="w-3.5 h-3.5" strokeWidth={1.7} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-disabled={!isRunning ? 'true' : undefined}
            onClick={() => isRunning && sendControl({ type: 'nav', key: 'app_switch' })}
            aria-label="多任务 Recents"
            title="最近任务 (Recents)"
            className="nav-btn w-8 h-7 rounded-full flex items-center justify-center cursor-pointer"
          >
            <Square className="w-3.5 h-3.5" strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-disabled={!isRunning ? 'true' : undefined}
            onClick={() => isRunning && sendControl({ type: 'rotate' })}
            aria-label="旋转屏幕"
            title="旋转设备屏幕"
            className="nav-btn w-7 h-7 rounded-full flex items-center justify-center cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5" strokeWidth={1.6} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-disabled={!isRunning ? 'true' : undefined}
            onClick={() => isRunning && sendControl({ type: 'displayPower', on: !displayPower })}
            aria-label={displayPower ? '熄屏' : '亮屏'}
            title={displayPower ? '关闭手机背光 (息屏省电)' : '点亮手机屏幕'}
            className={`nav-btn w-7 h-7 rounded-full flex items-center justify-center cursor-pointer ${
              !displayPower && isRunning ? 'text-[var(--accent-blue)]' : ''
            }`}
          >
            <Power className="w-3.5 h-3.5" strokeWidth={1.6} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-disabled={device.state !== 'device' ? 'true' : undefined}
            onClick={() => device.state === 'device' && void takeScreenshot(device.serial)}
            aria-label="截图"
            title="保存高清原图至 ~/Pictures/DroidWall"
            className="nav-btn w-7 h-7 rounded-full flex items-center justify-center cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  )
}
