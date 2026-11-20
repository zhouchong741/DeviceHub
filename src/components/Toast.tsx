import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDeviceStore } from '../store/useDeviceStore'

export function Toast() {
  const toast = useDeviceStore((s) => s.toast)
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const scheduleHide = useCallback(
    (delayMs: number) => {
      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        setOpen(false)
      }, delayMs)
    },
    [clearTimer]
  )

  useEffect(() => {
    if (!toast) {
      setOpen(false)
      clearTimer()
      return
    }
    setOpen(true)
    scheduleHide(2800)
    return clearTimer
  }, [toast, clearTimer, scheduleHide])

  const renderIcon = () => {
    if (!toast) return null
    if (toast.tone === 'success') {
      return <CheckCircle2 className="w-3.5 h-3.5 text-[var(--accent-green)]" strokeWidth={2} aria-hidden="true" />
    }
    if (toast.tone === 'warn') {
      return <AlertTriangle className="w-3.5 h-3.5 text-[var(--accent-amber)]" strokeWidth={2} aria-hidden="true" />
    }
    if (toast.tone === 'error') {
      return <AlertCircle className="w-3.5 h-3.5 text-[var(--accent-red)]" strokeWidth={2} aria-hidden="true" />
    }
    return <Info className="w-3.5 h-3.5 text-[var(--accent-blue)]" strokeWidth={2} aria-hidden="true" />
  }

  return (
    <div
      data-open={open ? 'true' : 'false'}
      role="status"
      aria-live="polite"
      onMouseEnter={clearTimer}
      onMouseLeave={() => {
        if (open) scheduleHide(1400)
      }}
      className="floating-toast z-30 rounded-full px-3.5 py-1.5 flex items-center gap-2.5 max-w-[90%] text-[12px]"
    >
      <span className="shrink-0 flex items-center">{renderIcon()}</span>
      <span className="text-[var(--text-primary)] truncate">{toast?.message ?? ''}</span>
      {toast?.actionLabel && toast.actionFilePath && (
        <button
          type="button"
          onClick={() => {
            void window.droidWall.showItemInFolder(toast.actionFilePath!)
            setOpen(false)
            clearTimer()
          }}
          className="shrink-0 text-[11.5px] font-medium text-[var(--accent-blue)] hover:underline cursor-pointer"
        >
          {toast.actionLabel}
        </button>
      )}
    </div>
  )
}
