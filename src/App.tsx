import { useEffect } from 'react'
import { DeviceWall } from './components/DeviceWall'
import { EmulatorModal } from './components/EmulatorModal'
import { Sidebar } from './components/Sidebar'
import { Toast } from './components/Toast'
import { Toolbar } from './components/Toolbar'
import { WirelessModal } from './components/WirelessModal'
import { useDeviceStore } from './store/useDeviceStore'

export function App() {
  const bootstrap = useDeviceStore((s) => s.bootstrap)
  const hudMessage = useDeviceStore((s) => s.hudMessage)
  const sidebarCollapsed = useDeviceStore((s) => s.sidebarCollapsed)

  useEffect(() => {
    let cleanup: (() => void) | undefined
    void bootstrap().then((fn) => {
      cleanup = fn
    })
    return () => {
      cleanup?.()
    }
  }, [bootstrap])

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[var(--shell-bg)]">
      <Toolbar />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar />

        <main
          className={`content-canvas relative flex-1 flex flex-col min-w-0 overflow-hidden mb-2 mr-2 ${
            sidebarCollapsed ? 'ml-2' : ''
          }`}
        >
          <Toast />
          <DeviceWall />
          <WirelessModal />
          <EmulatorModal />

          <p role="status" className="sr-only">
            {hudMessage}
          </p>
        </main>
      </div>
    </div>
  )
}
