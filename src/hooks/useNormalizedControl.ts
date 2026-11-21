import { useCallback, useEffect, useRef } from 'react'
import type { OutgoingControlMessage } from './useMirrorStream'

// Android KeyEvent.KEYCODE_* 映射表
const KEYCODE_MAP: Record<string, number> = {
  Enter: 66,
  Backspace: 67,
  Tab: 61,
  Escape: 4,
  Delete: 112,
  ' ': 62,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Home: 122,
  End: 123
}

function getRatio(e: { clientX: number; clientY: number }, el: HTMLCanvasElement): { xRatio: number; yRatio: number } {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return { xRatio: 0, yRatio: 0 }
  }
  return {
    xRatio: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
    yRatio: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
  }
}

export function useNormalizedControl(
  enabled: boolean,
  sendControl: (msg: OutgoingControlMessage) => void,
  canvasRef: React.RefObject<HTMLCanvasElement | null>
) {
  const activePointerIdRef = useRef<number | null>(null)
  const lastRatioRef = useRef<{ xRatio: number; yRatio: number }>({ xRatio: 0, yRatio: 0 })
  const lastMoveTimeRef = useRef(0)

  const lastWheelTimeRef = useRef(0)

  // 将画布内的鼠标滚轮与触控板双指滑动转发为 scrcpy 滚动事件，同时阻止外层列表滚动
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (!enabled) return

      const now = performance.now()
      if (now - lastWheelTimeRef.current < 16) return
      lastWheelTimeRef.current = now

      const clampScroll = (delta: number): number => {
        if (Math.abs(delta) < 0.5) return 0
        const scaled = -delta / 24
        const rounded = scaled > 0 ? Math.ceil(scaled) : Math.floor(scaled)
        return Math.max(-16, Math.min(16, rounded))
      }

      const hScroll = clampScroll(e.deltaX)
      const vScroll = clampScroll(e.deltaY)
      if (hScroll === 0 && vScroll === 0) return

      const ratio = getRatio(e, el)
      sendControl({
        type: 'scroll',
        xRatio: ratio.xRatio,
        yRatio: ratio.yRatio,
        hScroll,
        vScroll
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
    }
  }, [canvasRef, enabled, sendControl])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!enabled) return
      if (e.pointerType === 'mouse' && e.button !== 0) return

      const canvas = e.currentTarget
      canvas.focus({ preventScroll: true })
      canvas.setPointerCapture(e.pointerId)
      activePointerIdRef.current = e.pointerId

      const ratio = getRatio(e, canvas)
      lastRatioRef.current = ratio
      sendControl({ type: 'touch', action: 'down', xRatio: ratio.xRatio, yRatio: ratio.yRatio })
    },
    [enabled, sendControl]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!enabled || activePointerIdRef.current !== e.pointerId) return
      const now = performance.now()
      if (now - lastMoveTimeRef.current < 12) return
      lastMoveTimeRef.current = now

      const ratio = getRatio(e, e.currentTarget)
      lastRatioRef.current = ratio
      sendControl({ type: 'touch', action: 'move', xRatio: ratio.xRatio, yRatio: ratio.yRatio })
    },
    [enabled, sendControl]
  )

  const finishPointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (activePointerIdRef.current !== e.pointerId) return
      activePointerIdRef.current = null
      const ratio = getRatio(e, e.currentTarget)
      lastRatioRef.current = ratio
      sendControl({ type: 'touch', action: 'up', xRatio: ratio.xRatio, yRatio: ratio.yRatio })
    },
    [sendControl]
  )

  const onLostPointerCapture = useCallback(() => {
    if (activePointerIdRef.current === null) return
    activePointerIdRef.current = null
    const { xRatio, yRatio } = lastRatioRef.current
    sendControl({ type: 'touch', action: 'up', xRatio, yRatio })
  }, [sendControl])

  const onKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (!enabled || e.nativeEvent.isComposing) return

      // Cmd+V 同步粘贴 Mac 剪贴板（原生支持中文）
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        try {
          const text = await navigator.clipboard.readText()
          if (text) {
            sendControl({ type: 'clipboard', text, paste: true })
          }
        } catch {
          // 忽略剪贴板权限拒绝
        }
        return
      }

      const mapped = KEYCODE_MAP[e.key]
      if (mapped !== undefined) {
        e.preventDefault()
        sendControl({ type: 'key', action: 'down', keycode: mapped })
        sendControl({ type: 'key', action: 'up', keycode: mapped })
        return
      }

      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) {
        e.preventDefault()
        sendControl({ type: 'text', text: e.key })
      }
    },
    [enabled, sendControl]
  )

  const onCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLCanvasElement>) => {
      if (!enabled || !e.data) return
      sendControl({ type: 'text', text: e.data })
    },
    [enabled, sendControl]
  )

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    onLostPointerCapture,
    onKeyDown,
    onCompositionEnd
  }
}
