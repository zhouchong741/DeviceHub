import { Upload, Usb } from 'lucide-react'
import { useState } from 'react'
import { useDeviceStore } from '../store/useDeviceStore'
import { DeviceCard } from './DeviceCard'

export function DeviceWall() {
  const devices = useDeviceStore((s) => s.devices)
  const gridCols = useDeviceStore((s) => s.gridCols)
  const focusedSerial = useDeviceStore((s) => s.focusedSerial)
  const dropFilesToDevices = useDeviceStore((s) => s.dropFilesToDevices)
  const [isWallDragOver, setIsWallDragOver] = useState(false)

  const onlineSerials = devices.filter((d) => d.state === 'device').map((d) => d.serial)

  const visibleDevices = focusedSerial
    ? devices.filter((d) => d.serial === focusedSerial)
    : devices

  if (devices.length === 0) {
    return (
      <section aria-label="真机多屏墙" className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-sm text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-[var(--glass-tint-hover)] border border-[var(--glass-border)] flex items-center justify-center text-[var(--text-secondary)]">
            <Usb className="w-6 h-6" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div className="text-[14px] font-semibold text-[var(--text-primary)]">等待 Android 真机接入</div>
          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
            请使用 USB 数据线将手机连接至 Mac，并在手机「开发者选项」中启用「USB 调试」。检测到设备后将自动在此展示。
          </p>
        </div>
      </section>
    )
  }

  const gridClass = focusedSerial
    ? 'grid-cols-1 max-w-5xl mx-auto w-full'
    : gridCols === 2
    ? 'grid-cols-1 sm:grid-cols-2 max-w-5xl mx-auto w-full'
    : gridCols === 3
    ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 w-full'
    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 w-full'

  const handleWallDragOver = (e: React.DragEvent<HTMLElement>): void => {
    if (onlineSerials.length === 0) return
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!isWallDragOver) setIsWallDragOver(true)
  }

  const handleWallDragLeave = (e: React.DragEvent<HTMLElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsWallDragOver(false)
    }
  }

  const handleWallDrop = (e: React.DragEvent<HTMLElement>): void => {
    e.preventDefault()
    setIsWallDragOver(false)
    if (onlineSerials.length === 0) return
    const filePaths = Array.from(e.dataTransfer.files)
      .map((f) => window.droidWall.getPathForFile(f))
      .filter(Boolean)
    if (filePaths.length > 0) {
      const targets = focusedSerial && onlineSerials.includes(focusedSerial) ? [focusedSerial] : onlineSerials
      void dropFilesToDevices(targets, filePaths)
    }
  }

  return (
    <section
      aria-label="真机多屏墙"
      onDragOver={handleWallDragOver}
      onDragLeave={handleWallDragLeave}
      onDrop={handleWallDrop}
      className="relative flex-1 overflow-y-auto glass-scroller p-4"
    >
      <div className={`grid grid-flow-dense gap-4 items-start ${gridClass}`}>
        {visibleDevices.map((device) => (
          <DeviceCard
            key={device.serial}
            device={device}
            focused={focusedSerial === device.serial}
          />
        ))}
      </div>

      {isWallDragOver && (
        <div className="pointer-events-none absolute inset-3 rounded-2xl border-2 border-dashed border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 backdrop-blur-sm flex flex-col items-center justify-center gap-2 z-20">
          <Upload className="w-7 h-7 text-[var(--accent-blue)]" strokeWidth={1.7} aria-hidden="true" />
          <div className="text-[13px] font-semibold text-[var(--text-primary)]">
            释放以批量分发至 {focusedSerial ? '当前专注设备' : `全部 ${onlineSerials.length} 台在线设备`}
          </div>
          <div className="text-[11.5px] text-[var(--text-secondary)]">
            支持 .apk 自动安装，其余文件推送至 /sdcard/Download
          </div>
        </div>
      )}
    </section>
  )
}
