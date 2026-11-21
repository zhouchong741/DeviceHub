import { Cpu, Loader2, Play, RotateCcw, Square, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDeviceStore } from '../store/useDeviceStore'
import type { AvdInfo, DeviceTemplateId } from '../types/droidwall'

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 0.1) return `${gb.toFixed(1)} GB`
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`
}

export function EmulatorModal() {
  const activeModal = useDeviceStore((s) => s.activeModal)
  const emulatorModalTab = useDeviceStore((s) => s.emulatorModalTab)
  const emulatorEnv = useDeviceStore((s) => s.emulatorEnv)
  const avds = useDeviceStore((s) => s.avds)
  const creatingAvd = useDeviceStore((s) => s.creatingAvd)
  const startingAvdNames = useDeviceStore((s) => s.startingAvdNames)
  const setActiveModal = useDeviceStore((s) => s.setActiveModal)
  const setEmulatorModalTab = useDeviceStore((s) => s.setEmulatorModalTab)
  const createAvd = useDeviceStore((s) => s.createAvd)
  const startAvd = useDeviceStore((s) => s.startAvd)
  const stopAvd = useDeviceStore((s) => s.stopAvd)
  const wipeAvdData = useDeviceStore((s) => s.wipeAvdData)
  const deleteAvd = useDeviceStore((s) => s.deleteAvd)

  const [pendingDelete, setPendingDelete] = useState<AvdInfo | null>(null)
  const [busy, setBusy] = useState(false)

  // 新建表单状态
  const [name, setName] = useState('DroidWall_AVD_1')
  const [systemImageId, setSystemImageId] = useState('')
  const [deviceTemplate, setDeviceTemplate] = useState<DeviceTemplateId>('pixel_7')
  const [headless, setHeadless] = useState(true)
  const [ramMb, setRamMb] = useState(4096)
  const [dataPartitionGb, setDataPartitionGb] = useState(8)

  useEffect(() => {
    if (!systemImageId && emulatorEnv.systemImages.length > 0) {
      setSystemImageId(emulatorEnv.systemImages[0].id)
    }
  }, [emulatorEnv.systemImages, systemImageId])

  if (activeModal !== 'emulator') return null

  const handleCreate = async (startAfterCreate: boolean): Promise<void> => {
    if (busy || !name.trim() || !systemImageId) return
    setBusy(true)
    try {
      const ok = await createAvd({
        name: name.trim(),
        systemImageId,
        deviceTemplate,
        ramMb,
        dataPartitionGb,
        headless,
        startAfterCreate
      })
      if (ok) {
        setName(`DroidWall_AVD_${avds.length + 2}`)
        setEmulatorModalTab('list')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDelete || busy) return
    setBusy(true)
    try {
      await deleteAvd(pendingDelete.name, pendingDelete.runningSerial)
      setPendingDelete(null)
    } finally {
      setBusy(false)
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
        aria-label="模拟器管理中心"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[780px] max-h-[640px] rounded-[18px] border border-[var(--action-pill-border)] bg-[var(--shell-bg)] backdrop-blur-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* 顶栏 */}
        <div className="px-5 py-3.5 border-b border-[var(--shell-divider)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[9px] bg-[var(--accent-blue-soft)] text-[var(--accent-blue)] flex items-center justify-center">
              <Cpu className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-[var(--text-primary)]">模拟器管理中心</div>
              <div className="text-[11.5px] text-[var(--text-secondary)]">
                创建、后台无头启动、重置数据及彻底删除释放磁盘空间
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="inline-flex p-0.5 rounded-[9px] bg-[var(--tint-hover)] border border-[var(--shell-divider)]">
              <button
                type="button"
                onClick={() => setEmulatorModalTab('list')}
                className={`px-3 py-1 rounded-[7px] text-[12px] font-medium cursor-pointer ${
                  emulatorModalTab === 'list'
                    ? 'bg-[var(--tint-active)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                已创建 ({avds.length})
              </button>
              <button
                type="button"
                onClick={() => setEmulatorModalTab('create')}
                className={`px-3 py-1 rounded-[7px] text-[12px] font-medium cursor-pointer ${
                  emulatorModalTab === 'create'
                    ? 'bg-[var(--tint-active)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                + 新建模拟器
              </button>
            </div>

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

        {emulatorModalTab === 'list' ? (
          <div className="p-5 overflow-y-auto glass-scroller space-y-3.5">
            {/* 环境状态条 */}
            <div className="px-3.5 py-2.5 rounded-xl bg-[var(--action-pill-bg)] border border-[var(--shell-divider)] flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
                    emulatorEnv.avdmanagerPath
                      ? 'bg-[var(--accent-green)]/12 text-[var(--accent-green)]'
                      : 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {emulatorEnv.avdmanagerPath ? 'avdmanager 就绪' : '未检测到 avdmanager'}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
                    emulatorEnv.emulatorPath
                      ? 'bg-[var(--accent-green)]/12 text-[var(--accent-green)]'
                      : 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {emulatorEnv.emulatorPath ? 'emulator 就绪' : '缺少 SDK emulator（需安装后才能启动）'}
                </span>
                <span className="px-2.5 py-1 rounded-full text-[11px] bg-[var(--tint-hover)] text-[var(--text-secondary)]">
                  可用镜像 {emulatorEnv.systemImages.length} 个
                </span>
              </div>

              <div className="mono-num text-[11.5px] text-[var(--text-secondary)]">
                总占用：<strong className="text-[var(--text-primary)]">{formatBytes(emulatorEnv.totalAvdBytes)}</strong>
              </div>
            </div>

            {/* 彻底删除二次确认 */}
            {pendingDelete && (
              <div className="p-3.5 rounded-xl border border-[var(--accent-red)]/35 bg-[var(--accent-red)]/10 flex items-center justify-between gap-4">
                <div className="text-[12px] leading-relaxed text-[var(--text-primary)]">
                  确定要彻底删除 <strong className="text-[var(--accent-red)]">{pendingDelete.name}</strong> 吗？
                  <br />
                  将永久移除 <span className="mono-num">{pendingDelete.path}</span> 与配置，立即释放{' '}
                  <strong className="mono-num">{formatBytes(pendingDelete.sizeBytes)}</strong> 磁盘空间（不可恢复）。
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPendingDelete(null)}
                    className="sidebar-primary-btn px-3 py-1.5 rounded-[8px] text-[11.5px] font-medium cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleConfirmDelete()}
                    className="px-3 py-1.5 rounded-[8px] bg-[var(--accent-red)] text-white text-[11.5px] font-medium hover:brightness-110 disabled:opacity-50 cursor-pointer"
                  >
                    {busy ? '清理中...' : '确认彻底删除'}
                  </button>
                </div>
              </div>
            )}

            {/* AVD 列表 */}
            {avds.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <div className="text-[13px] font-medium text-[var(--text-secondary)]">暂无已创建的模拟器</div>
                <button
                  type="button"
                  onClick={() => setEmulatorModalTab('create')}
                  className="px-4 py-2 rounded-full bg-[var(--accent-blue)] text-white text-[12px] font-medium hover:brightness-110 cursor-pointer"
                >
                  + 立即新建模拟器
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {avds.map((avd) => (
                  <div
                    key={avd.name}
                    className="px-3.5 py-3 rounded-xl bg-[var(--action-pill-bg)] border border-[var(--shell-divider)] flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{avd.name}</span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10.5px] font-medium px-2 py-0.5 rounded-md ${
                            avd.status === 'running'
                              ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]'
                              : startingAvdNames[avd.name]
                              ? 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]'
                              : 'bg-[var(--tint-hover)] text-[var(--text-tertiary)]'
                          }`}
                        >
                          {avd.status !== 'running' && startingAvdNames[avd.name] && (
                            <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2} />
                          )}
                          {avd.status === 'running'
                            ? `运行中 · ${avd.runningSerial}`
                            : startingAvdNames[avd.name]
                            ? '启动中...'
                            : '已关机'}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 flex-wrap text-[11.5px] text-[var(--text-secondary)]">
                        <span>
                          {avd.target} ({avd.abi})
                        </span>
                        <span className="mono-num">{avd.resolution}</span>
                        <span className="mono-num px-1.5 py-0.5 rounded bg-[var(--tint-hover)] text-[var(--text-primary)] font-medium">
                          磁盘占用 {formatBytes(avd.sizeBytes)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {avd.status === 'running' ? (
                        <button
                          type="button"
                          onClick={() => void stopAvd(avd.name, avd.runningSerial)}
                          className="sidebar-primary-btn px-2.5 py-1.5 rounded-[8px] text-[11.5px] font-medium inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Square className="w-3 h-3" strokeWidth={1.8} />
                          <span>停止</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={Boolean(startingAvdNames[avd.name])}
                            onClick={() => void startAvd(avd.name, true)}
                            className="px-2.5 py-1.5 rounded-[8px] bg-[var(--accent-blue)] text-white text-[11.5px] font-medium inline-flex items-center gap-1 hover:brightness-110 disabled:opacity-60 cursor-pointer"
                            title="无头后台启动，画面直接接入 DroidWall"
                          >
                            {startingAvdNames[avd.name] ? (
                              <Loader2 className="w-3 h-3 animate-spin" strokeWidth={1.8} />
                            ) : (
                              <Play className="w-3 h-3" strokeWidth={1.8} />
                            )}
                            <span>{startingAvdNames[avd.name] ? '启动中...' : '后台启动'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void wipeAvdData(avd.name)}
                            className="sidebar-primary-btn px-2.5 py-1.5 rounded-[8px] text-[11.5px] font-medium inline-flex items-center gap-1 cursor-pointer"
                            title="清空应用和用户数据，保留系统"
                          >
                            <RotateCcw className="w-3 h-3" strokeWidth={1.7} />
                            <span>重置</span>
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => setPendingDelete(avd)}
                        className="px-2.5 py-1.5 rounded-[8px] border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 text-[var(--accent-red)] text-[11.5px] font-medium inline-flex items-center gap-1 hover:bg-[var(--accent-red)]/20 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" strokeWidth={1.7} />
                        <span>彻底删除</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* 新建模拟器 */
          <div className="p-5 overflow-y-auto glass-scroller space-y-4">
            <div className="grid grid-cols-2 gap-3.5">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">
                  模拟器名称（英文、数字、下划线）
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mono-num px-3 py-2 rounded-[9px] border border-[var(--action-pill-border)] bg-[var(--canvas-surface)] text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">
                  系统镜像（来自本地 SDK system-images）
                </span>
                <select
                  value={systemImageId}
                  onChange={(e) => setSystemImageId(e.target.value)}
                  className="px-3 py-2 rounded-[9px] border border-[var(--action-pill-border)] bg-[var(--canvas-surface)] text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
                >
                  {emulatorEnv.systemImages.length === 0 ? (
                    <option value="">未检测到可用系统镜像</option>
                  ) : (
                    emulatorEnv.systemImages.map((img) => (
                      <option key={img.id} value={img.id}>
                        {img.label}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">设备模板</span>
                <select
                  value={deviceTemplate}
                  onChange={(e) => setDeviceTemplate(e.target.value as DeviceTemplateId)}
                  className="px-3 py-2 rounded-[9px] border border-[var(--action-pill-border)] bg-[var(--canvas-surface)] text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
                >
                  <option value="pixel_7">Pixel 7 (1080×2400 · 420dpi)</option>
                  <option value="phone_1080">通用手机 (1080×1920 · 420dpi)</option>
                  <option value="tablet">Android 平板 (1600×2560 · 320dpi)</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">启动模式偏好</span>
                <select
                  value={headless ? 'headless' : 'window'}
                  onChange={(e) => setHeadless(e.target.value === 'headless')}
                  className="px-3 py-2 rounded-[9px] border border-[var(--action-pill-border)] bg-[var(--canvas-surface)] text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
                >
                  <option value="headless">无头模式 (-no-window，画面直接进 DroidWall)</option>
                  <option value="window">标准模式（显示原生模拟器窗口）</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">内存配额 (RAM)</span>
                <select
                  value={ramMb}
                  onChange={(e) => setRamMb(Number(e.target.value))}
                  className="px-3 py-2 rounded-[9px] border border-[var(--action-pill-border)] bg-[var(--canvas-surface)] text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
                >
                  <option value={2048}>2048 MB（轻量多开推荐）</option>
                  <option value={4096}>4096 MB（流畅标准）</option>
                  <option value={6144}>6144 MB</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">存储上限 (Data Partition)</span>
                <select
                  value={dataPartitionGb}
                  onChange={(e) => setDataPartitionGb(Number(e.target.value))}
                  className="px-3 py-2 rounded-[9px] border border-[var(--action-pill-border)] bg-[var(--canvas-surface)] text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
                >
                  <option value={4}>4 GB（测试够用，节省空间）</option>
                  <option value={8}>8 GB（推荐）</option>
                  <option value={16}>16 GB</option>
                </select>
              </label>
            </div>

            <div className="pt-3 border-t border-[var(--shell-divider)] flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
                {creatingAvd && <Loader2 className="w-3.5 h-3.5 text-[var(--accent-blue)] animate-spin" strokeWidth={2} />}
                {creatingAvd ? '正在生成 AVD 配置与初始化系统镜像，请稍候...' : '随用随删，彻底删除后 0 磁盘残留'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy || creatingAvd}
                  onClick={() => setEmulatorModalTab('list')}
                  className="sidebar-primary-btn px-3.5 py-1.5 rounded-[8px] text-[12px] font-medium disabled:opacity-50 cursor-pointer"
                >
                  返回列表
                </button>
                <button
                  type="button"
                  disabled={busy || creatingAvd || !name.trim() || !systemImageId}
                  onClick={() => void handleCreate(false)}
                  className="sidebar-primary-btn px-3.5 py-1.5 rounded-[8px] text-[12px] font-medium disabled:opacity-50 cursor-pointer"
                >
                  {creatingAvd ? '创建中...' : '仅创建'}
                </button>
                <button
                  type="button"
                  disabled={busy || creatingAvd || !name.trim() || !systemImageId || !emulatorEnv.emulatorPath}
                  onClick={() => void handleCreate(true)}
                  className="px-3.5 py-1.5 rounded-[8px] bg-[var(--accent-blue)] text-white text-[12px] font-medium hover:brightness-110 disabled:opacity-50 cursor-pointer"
                >
                  {busy || creatingAvd ? '创建并启动中...' : '创建并启动'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
