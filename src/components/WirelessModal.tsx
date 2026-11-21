import { RefreshCw, RotateCcw, Wifi, X } from 'lucide-react'
import { useState } from 'react'
import { useDeviceStore } from '../store/useDeviceStore'

function isWirelessSerial(serial: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+:\d+$/.test(serial)
}

export function WirelessModal() {
  const activeModal = useDeviceStore((s) => s.activeModal)
  const wirelessState = useDeviceStore((s) => s.wirelessState)
  const devices = useDeviceStore((s) => s.devices)
  const setActiveModal = useDeviceStore((s) => s.setActiveModal)
  const scanWireless = useDeviceStore((s) => s.scanWireless)
  const restartAdbServer = useDeviceStore((s) => s.restartAdbServer)
  const setWirelessAutoConnect = useDeviceStore((s) => s.setWirelessAutoConnect)
  const connectWireless = useDeviceStore((s) => s.connectWireless)
  const disconnectWireless = useDeviceStore((s) => s.disconnectWireless)
  const pairWireless = useDeviceStore((s) => s.pairWireless)
  const switchUsbToWireless = useDeviceStore((s) => s.switchUsbToWireless)

  const [manualAddr, setManualAddr] = useState('')
  const [pairingCodes, setPairingCodes] = useState<Record<string, string>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)

  if (activeModal !== 'wireless') return null

  const connectedWifiDevices = devices.filter((d) => isWirelessSerial(d.serial))
  const connectedWifiIps = new Set(connectedWifiDevices.map((d) => d.serial.split(':')[0]))
  const usbDevices = devices.filter((d) => d.state === 'device' && !isWirelessSerial(d.serial) && !d.serial.startsWith('emulator-'))

  const handleManualConnect = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!manualAddr.trim() || busyKey) return
    setBusyKey('manual')
    try {
      const ok = await connectWireless(manualAddr)
      if (ok) setManualAddr('')
    } finally {
      setBusyKey(null)
    }
  }

  const handlePair = async (address: string): Promise<void> => {
    const code = pairingCodes[address]?.trim()
    if (!code || busyKey) return
    setBusyKey(`pair:${address}`)
    try {
      const ok = await pairWireless(address, code)
      if (ok) {
        setPairingCodes((prev) => {
          const next = { ...prev }
          delete next[address]
          return next
        })
      }
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm"
      onClick={() => setActiveModal('none')}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="无线 ADB 自动发现与多设备连接"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[760px] max-h-[620px] rounded-[18px] border border-[var(--action-pill-border)] bg-[var(--shell-bg)] backdrop-blur-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* 顶栏 */}
        <div className="px-5 py-3.5 border-b border-[var(--shell-divider)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[9px] bg-[var(--accent-blue-soft)] text-[var(--accent-blue)] flex items-center justify-center">
              <Wifi className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-[var(--text-primary)]">无线 ADB 自动发现与多设备</div>
              <div className="text-[11.5px] text-[var(--text-secondary)]">
                自动扫描局域网 mDNS 无线调试广播，支持配对码配对与 USB 一键转无线
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void restartAdbServer()}
              title="若已开启本地网络仍报 No route to host，点击重启后台 ADB 守护进程"
              className="sidebar-primary-btn px-3 py-1.5 rounded-[8px] text-[12px] font-medium text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.7} />
              <span>重启 ADB</span>
            </button>
            <button
              type="button"
              onClick={() => void scanWireless()}
              className="sidebar-primary-btn px-3 py-1.5 rounded-[8px] text-[12px] font-medium text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${wirelessState.scanning ? 'animate-spin' : ''}`} strokeWidth={1.7} />
              <span>重新扫描</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveModal('none')}
              aria-label="关闭"
              className="tb-btn tb-btn-icon"
            >
              <X className="w-4 h-4" strokeWidth={1.7} />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="p-5 overflow-y-auto glass-scroller space-y-3.5">
          {/* mDNS 自动发现状态条 */}
          <div className="px-3.5 py-2.5 rounded-xl bg-[var(--action-pill-bg)] border border-[var(--shell-divider)] flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
                  wirelessState.supported
                    ? 'bg-[var(--accent-green)]/12 text-[var(--accent-green)]'
                    : 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {wirelessState.supported ? 'mDNS 自动发现运行中' : wirelessState.lastError || 'mDNS 不可用'}
              </span>
              <span className="px-2.5 py-1 rounded-full text-[11px] bg-[var(--tint-hover)] text-[var(--text-secondary)]">
                发现 {wirelessState.services.length} 个广播 · 已连无线 {connectedWifiDevices.length} 台
              </span>
            </div>

            <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={wirelessState.autoConnect}
                onChange={(e) => void setWirelessAutoConnect(e.target.checked)}
                className="accent-[var(--accent-blue)] cursor-pointer"
              />
              发现已配对设备时自动连接
            </label>
          </div>

          {/* 手动 IP:Port 直连 */}
          <form onSubmit={(e) => void handleManualConnect(e)} className="flex items-center gap-2">
            <input
              type="text"
              value={manualAddr}
              onChange={(e) => setManualAddr(e.target.value)}
              placeholder="手动输入 IP:端口（如 192.168.1.88:5555）"
              className="mono-num flex-1 px-3 py-2 rounded-[9px] border border-[var(--action-pill-border)] bg-[var(--canvas-surface)] text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
            />
            <button
              type="submit"
              disabled={!manualAddr.trim() || busyKey === 'manual'}
              className="px-3.5 py-2 rounded-[9px] bg-[var(--accent-blue)] text-white text-[12px] font-medium hover:brightness-110 disabled:opacity-50 cursor-pointer"
            >
              {busyKey === 'manual' ? '连接中...' : '连接设备'}
            </button>
          </form>

          {/* 列表 */}
          <div className="space-y-2.5">
            {connectedWifiDevices.map((dev) => (
              <div
                key={dev.serial}
                className="px-3.5 py-3 rounded-xl bg-[var(--action-pill-bg)] border border-[var(--shell-divider)] flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                      {dev.marketName || dev.model || dev.serial}
                    </span>
                    <span className="text-[10.5px] font-medium px-2 py-0.5 rounded-md bg-[var(--accent-green)]/15 text-[var(--accent-green)]">
                      已连接 · 可直接投屏
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11.5px] text-[var(--text-secondary)]">
                    <span className="mono-num">{dev.serial}</span>
                    {dev.androidVersion && <span>Android {dev.androidVersion}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void disconnectWireless(dev.serial)}
                  className="px-3 py-1.5 rounded-[8px] border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 text-[var(--accent-red)] text-[11.5px] font-medium hover:bg-[var(--accent-red)]/20 cursor-pointer shrink-0"
                >
                  断开
                </button>
              </div>
            ))}

            {wirelessState.services
              .filter((s) => !s.alreadyConnected && !(s.serviceType === 'connect' && connectedWifiIps.has(s.ip)))
              .map((svc) => (
                <div
                  key={`${svc.serviceType}:${svc.address}`}
                  className="px-3.5 py-3 rounded-xl bg-[var(--action-pill-bg)] border border-[var(--shell-divider)] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                        {svc.instanceName}
                      </span>
                      <span
                        className={`text-[10.5px] font-medium px-2 py-0.5 rounded-md ${
                          svc.serviceType === 'pairing'
                            ? 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]'
                            : 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]'
                        }`}
                      >
                        {svc.serviceType === 'pairing' ? '发现配对广播' : '可无线直连'}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11.5px] text-[var(--text-secondary)]">
                      <span className="mono-num">{svc.address}</span>
                      <span>
                        {svc.serviceType === 'pairing' ? '_adb-tls-pairing._tcp' : '_adb-tls-connect._tcp'}
                      </span>
                    </div>
                  </div>

                  {svc.serviceType === 'pairing' ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="text"
                        value={pairingCodes[svc.address] ?? ''}
                        onChange={(e) => setPairingCodes((p) => ({ ...p, [svc.address]: e.target.value }))}
                        placeholder="6位配对码"
                        className="mono-num w-24 px-2.5 py-1.5 rounded-[8px] border border-[var(--action-pill-border)] bg-[var(--canvas-surface)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
                      />
                      <button
                        type="button"
                        disabled={!pairingCodes[svc.address]?.trim() || busyKey === `pair:${svc.address}`}
                        onClick={() => void handlePair(svc.address)}
                        className="px-3 py-1.5 rounded-[8px] bg-[var(--accent-blue)] text-white text-[11.5px] font-medium hover:brightness-110 disabled:opacity-50 cursor-pointer"
                      >
                        配对并连接
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void connectWireless(svc.address)}
                      className="px-3 py-1.5 rounded-[8px] bg-[var(--accent-blue)] text-white text-[11.5px] font-medium hover:brightness-110 cursor-pointer shrink-0"
                    >
                      连接
                    </button>
                  )}
                </div>
              ))}

            {usbDevices.map((dev) => (
              <div
                key={`usb-${dev.serial}`}
                className="px-3.5 py-3 rounded-xl bg-[var(--action-pill-bg)] border border-[var(--shell-divider)] flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                      {dev.marketName || dev.model || dev.serial}
                    </span>
                    <span className="text-[10.5px] font-medium px-2 py-0.5 rounded-md bg-[var(--tint-hover)] text-[var(--text-secondary)]">
                      当前通过 USB 连接
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11.5px] text-[var(--text-secondary)]">
                    <span className="mono-num">{dev.serial}</span>
                    <span>支持切换为 TCP/IP 5555 无线模式</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void switchUsbToWireless(dev.serial)}
                  className="sidebar-primary-btn px-3 py-1.5 rounded-[8px] text-[11.5px] font-medium text-[var(--text-primary)] cursor-pointer shrink-0"
                >
                  转为无线连接
                </button>
              </div>
            ))}

            {connectedWifiDevices.length === 0 &&
              wirelessState.services.length === 0 &&
              usbDevices.length === 0 && (
                <div className="py-10 text-center text-[12px] text-[var(--text-tertiary)] leading-relaxed">
                  暂未发现局域网无线调试设备
                  <br />
                  请在手机「开发者选项 → 无线调试」中开启开关，或连接 USB 后一键转为无线
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}
