import { execFile, spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'
import type {
  ActionResult,
  AndroidDevice,
  AvdInfo,
  CreateAvdRequest,
  DeviceTemplateId,
  EmulatorEnvStatus,
  EmulatorSystemImage
} from '../types'
import { execAdb } from '../adb/executor'

const execFileAsync = promisify(execFile)

const TEMPLATE_SPECS: Record<DeviceTemplateId, { width: number; height: number; density: number }> = {
  pixel_7: { width: 1080, height: 2400, density: 420 },
  phone_1080: { width: 1080, height: 1920, density: 420 },
  tablet: { width: 1600, height: 2560, density: 320 }
}

function getAvdHome(): string {
  return process.env.ANDROID_AVD_HOME || path.join(os.homedir(), '.android', 'avd')
}

function resolveSdkRoot(adbPath: string | null): string | null {
  const candidates: string[] = []
  if (adbPath) {
    // .../sdk/platform-tools/adb -> .../sdk
    candidates.push(path.resolve(path.dirname(adbPath), '..'))
  }
  if (process.env.ANDROID_HOME) candidates.push(process.env.ANDROID_HOME)
  if (process.env.ANDROID_SDK_ROOT) candidates.push(process.env.ANDROID_SDK_ROOT)
  candidates.push(path.join(os.homedir(), 'Library', 'Android', 'sdk'))

  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) return dir
  }
  return null
}

function findAvdManager(sdkRoot: string | null): string | null {
  if (!sdkRoot) return null
  const candidates: string[] = []
  const cmdlineDir = path.join(sdkRoot, 'cmdline-tools')
  if (fs.existsSync(cmdlineDir)) {
    for (const sub of fs.readdirSync(cmdlineDir)) {
      candidates.push(path.join(cmdlineDir, sub, 'bin', 'avdmanager'))
    }
  }
  candidates.push(path.join(sdkRoot, 'tools', 'bin', 'avdmanager'))

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function findEmulatorBinary(sdkRoot: string | null): string | null {
  if (!sdkRoot) return null
  const p = path.join(sdkRoot, 'emulator', 'emulator')
  return fs.existsSync(p) ? p : null
}

function scanSystemImages(sdkRoot: string | null): EmulatorSystemImage[] {
  if (!sdkRoot) return []
  const sysRoot = path.join(sdkRoot, 'system-images')
  if (!fs.existsSync(sysRoot)) return []

  const images: EmulatorSystemImage[] = []
  for (const apiDir of fs.readdirSync(sysRoot)) {
    const apiMatch = apiDir.match(/^android-(\d+)$/)
    if (!apiMatch) continue
    const apiLevel = Number(apiMatch[1])
    const apiPath = path.join(sysRoot, apiDir)
    if (!fs.statSync(apiPath).isDirectory()) continue

    for (const tag of fs.readdirSync(apiPath)) {
      const tagPath = path.join(apiPath, tag)
      if (!fs.statSync(tagPath).isDirectory()) continue

      for (const abi of fs.readdirSync(tagPath)) {
        const abiPath = path.join(tagPath, abi)
        if (!fs.statSync(abiPath).isDirectory()) continue
        const hasSystemImg =
          fs.existsSync(path.join(abiPath, 'system.img')) || fs.existsSync(path.join(abiPath, 'userdata.img'))
        if (!hasSystemImg) continue

        const id = `system-images;${apiDir};${tag};${abi}`
        images.push({
          id,
          apiLevel,
          tag,
          abi,
          label: `API ${apiLevel} · ${tag} · ${abi}`
        })
      }
    }
  }

  const hostIsArm = process.arch === 'arm64'
  const abiScore = (abi: string): number => {
    if (hostIsArm) {
      if (abi === 'arm64-v8a') return 0
      return 2
    }
    if (abi === 'x86_64') return 0
    if (abi === 'x86') return 1
    return 2
  }

  return images.sort((a, b) => {
    const scoreDiff = abiScore(a.abi) - abiScore(b.abi)
    if (scoreDiff !== 0) return scoreDiff
    return b.apiLevel - a.apiLevel
  })
}

function getDirSizeBytes(targetPath: string): number {
  if (!fs.existsSync(targetPath)) return 0
  let total = 0
  const stack = [targetPath]
  while (stack.length > 0) {
    const cur = stack.pop()!
    let st: fs.Stats
    try {
      st = fs.lstatSync(cur)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      try {
        for (const entry of fs.readdirSync(cur)) {
          stack.push(path.join(cur, entry))
        }
      } catch {
        // ignore unreadable entries
      }
    } else if (st.isFile()) {
      total += st.size
    }
  }
  return total
}

function parseIniKeyValues(filePath: string): Record<string, string> {
  const map: Record<string, string> = {}
  if (!fs.existsSync(filePath)) return map
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    map[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
  }
  return map
}

function upsertIniValues(filePath: string, updates: Record<string, string>): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8').split(/\r?\n/) : []
  const handled = new Set<string>()
  const nextLines = existing.map((line) => {
    const idx = line.indexOf('=')
    if (idx === -1) return line
    const key = line.slice(0, idx).trim()
    if (key in updates) {
      handled.add(key)
      return `${key}=${updates[key]}`
    }
    return line
  })
  for (const [k, v] of Object.entries(updates)) {
    if (!handled.has(k)) {
      nextLines.push(`${k}=${v}`)
    }
  }
  fs.writeFileSync(filePath, `${nextLines.filter((l, i, arr) => i < arr.length - 1 || l !== '').join('\n')}\n`, 'utf-8')
}

async function getMacSystemHttpProxy(): Promise<{ host: string; port: number } | null> {
  if (process.platform !== 'darwin') return null
  try {
    const { stdout } = await execFileAsync('scutil', ['--proxy'], { timeout: 3000 })
    const enabled = /HTTPEnable\s*:\s*1\b/.test(stdout)
    const hostMatch = stdout.match(/HTTPProxy\s*:\s*(\S+)/)
    const portMatch = stdout.match(/HTTPPort\s*:\s*(\d+)/)
    if (!enabled || !hostMatch || !portMatch) return null
    const port = Number(portMatch[1])
    if (!Number.isFinite(port) || port <= 0) return null
    return { host: hostMatch[1], port }
  } catch {
    return null
  }
}

export class EmulatorManager {
  private adbPath: string | null = null
  private spawnedProcs = new Map<string, ChildProcess>()
  private configuredNetworkSerials = new Set<string>()

  setAdbPath(adbPath: string | null): void {
    this.adbPath = adbPath
  }

  /**
   * 模拟器开机就绪后关闭系统默认的 Google Captive Portal 检测，
   * 并自动同步宿主机 macOS 系统 HTTP 代理（127.0.0.1 -> 10.0.2.2）。
   */
  async ensureNetworkReady(serial: string): Promise<void> {
    if (!this.adbPath || !serial.startsWith('emulator-') || this.configuredNetworkSerials.has(serial)) {
      return
    }
    this.configuredNetworkSerials.add(serial)
    try {
      const proxy = await getMacSystemHttpProxy()
      const proxyCmd = proxy
        ? `settings put global http_proxy ${proxy.host === '127.0.0.1' || proxy.host === 'localhost' ? '10.0.2.2' : proxy.host}:${proxy.port};`
        : ''

      const { stdout } = await execAdb(this.adbPath, ['-s', serial, 'shell', 'settings get global captive_portal_mode'], 4000)
      if (stdout.trim() === '0') {
        if (proxyCmd) {
          await execAdb(this.adbPath, ['-s', serial, 'shell', proxyCmd], 4000)
        }
        return
      }
      await execAdb(
        this.adbPath,
        ['-s', serial, 'shell', `${proxyCmd} settings put global captive_portal_mode 0; svc wifi disable; sleep 1; svc wifi enable`],
        8000
      )
    } catch {
      this.configuredNetworkSerials.delete(serial)
    }
  }

  clearNetworkReady(serial: string): void {
    this.configuredNetworkSerials.delete(serial)
  }

  getEnvStatus(): EmulatorEnvStatus {
    const sdkRoot = resolveSdkRoot(this.adbPath)
    const emulatorPath = findEmulatorBinary(sdkRoot)
    const avdmanagerPath = findAvdManager(sdkRoot)
    const systemImages = scanSystemImages(sdkRoot)

    const avdHome = getAvdHome()
    let totalAvdBytes = 0
    if (fs.existsSync(avdHome)) {
      for (const entry of fs.readdirSync(avdHome)) {
        if (entry.endsWith('.avd')) {
          totalAvdBytes += getDirSizeBytes(path.join(avdHome, entry))
        }
      }
    }

    return { sdkRoot, emulatorPath, avdmanagerPath, systemImages, totalAvdBytes }
  }

  async listAvds(devices: AndroidDevice[]): Promise<AvdInfo[]> {
    const avdHome = getAvdHome()
    if (!fs.existsSync(avdHome)) return []

    const runningMap = new Map<string, string>()
    if (this.adbPath) {
      const emuSerials = devices.filter((d) => d.serial.startsWith('emulator-')).map((d) => d.serial)
      await Promise.all(
        emuSerials.map(async (serial) => {
          try {
            const { stdout } = await execAdb(this.adbPath!, ['-s', serial, 'emu', 'avd', 'name'], 3000)
            const avdName = stdout.split(/\r?\n/)[0]?.trim()
            if (avdName) runningMap.set(avdName, serial)
          } catch {
            // 模拟器尚在启动或不可查询
          }
        })
      )
    }

    const entries = fs.readdirSync(avdHome).filter((f) => f.endsWith('.ini'))
    const list: AvdInfo[] = []

    for (const iniFile of entries) {
      const name = iniFile.slice(0, -4)
      const iniMap = parseIniKeyValues(path.join(avdHome, iniFile))
      const avdDir = iniMap.path || path.join(avdHome, `${name}.avd`)
      if (!fs.existsSync(avdDir)) continue

      const cfg = parseIniKeyValues(path.join(avdDir, 'config.ini'))
      const sysDir = cfg['image.sysdir.1'] || ''
      const apiMatch = sysDir.match(/android-(\d+)/)
      const target = iniMap.target || (apiMatch ? `Android API ${apiMatch[1]}` : 'Android AVD')
      const abi = cfg['abi.type'] || 'x86_64'
      const w = cfg['hw.lcd.width'] || '1080'
      const h = cfg['hw.lcd.height'] || '2400'
      const dpi = cfg['hw.lcd.density'] ? ` · ${cfg['hw.lcd.density']}dpi` : ''

      const runningSerial = runningMap.get(name)
      const sizeBytes = getDirSizeBytes(avdDir) + (fs.existsSync(path.join(avdHome, iniFile)) ? fs.statSync(path.join(avdHome, iniFile)).size : 0)

      list.push({
        name,
        target,
        abi,
        resolution: `${w}×${h}${dpi}`,
        path: avdDir,
        sizeBytes,
        runningSerial,
        status: runningSerial ? 'running' : 'stopped'
      })
    }

    return list.sort((a, b) => a.name.localeCompare(b.name))
  }

  async createAvd(req: CreateAvdRequest): Promise<ActionResult> {
    const cleanName = req.name.trim()
    if (!/^[a-zA-Z0-9._-]+$/.test(cleanName)) {
      return { ok: false, error: '名称仅支持英文字母、数字、点、下划线和连字符' }
    }
    const env = this.getEnvStatus()
    if (!env.sdkRoot) {
      return { ok: false, error: '未检测到 Android SDK 目录' }
    }
    if (!req.systemImageId) {
      return { ok: false, error: '请选择可用的系统镜像' }
    }

    // 解析 systemImageId: system-images;android-34;google_apis;x86_64
    const parts = req.systemImageId.split(';')
    if (parts.length !== 4 || parts[0] !== 'system-images') {
      return { ok: false, error: `无效的系统镜像标识: ${req.systemImageId}` }
    }
    const [, apiDir, tag, abi] = parts
    const imageDir = path.join(env.sdkRoot, 'system-images', apiDir, tag, abi)
    if (!fs.existsSync(imageDir)) {
      return { ok: false, error: `未找到系统镜像目录: ${imageDir}` }
    }

    try {
      const avdHome = getAvdHome()
      const avdDir = path.join(avdHome, `${cleanName}.avd`)
      const iniPath = path.join(avdHome, `${cleanName}.ini`)
      fs.mkdirSync(avdDir, { recursive: true })

      // 写入 <name>.ini
      const iniContent = [
        'avd.ini.encoding=UTF-8',
        `path=${avdDir}`,
        `path.rel=avd/${cleanName}.avd`,
        `target=${apiDir}`
      ].join('\n')
      fs.writeFileSync(iniPath, `${iniContent}\n`, 'utf-8')

      // 若系统镜像包含初始 userdata.img，则拷贝一份到 AVD 目录
      const srcUserdata = path.join(imageDir, 'userdata.img')
      if (fs.existsSync(srcUserdata)) {
        fs.copyFileSync(srcUserdata, path.join(avdDir, 'userdata.img'))
      }

      const spec = TEMPLATE_SPECS[req.deviceTemplate] ?? TEMPLATE_SPECS.pixel_7
      const cpuArch = abi === 'arm64-v8a' ? 'arm64' : abi === 'armeabi-v7a' ? 'arm' : abi
      const tagDisplay =
        tag === 'google_apis_playstore' ? 'Google Play' : tag === 'google_apis' ? 'Google APIs' : 'Default'
      const configPath = path.join(avdDir, 'config.ini')

      upsertIniValues(configPath, {
        AvdId: cleanName,
        'PlayStore.enabled': tag === 'google_apis_playstore' ? 'true' : 'false',
        'abi.type': abi,
        'avd.ini.displayname': cleanName,
        'avd.ini.encoding': 'UTF-8',
        'disk.dataPartition.size': `${req.dataPartitionGb}G`,
        'hw.accelerometer': 'yes',
        'hw.audioInput': 'yes',
        'hw.battery': 'yes',
        'hw.camera.back': 'virtualscene',
        'hw.camera.front': 'emulated',
        'hw.cpu.arch': cpuArch,
        'hw.cpu.ncore': '4',
        'hw.device.name': req.deviceTemplate,
        'hw.gps': 'yes',
        'hw.gpu.enabled': 'yes',
        'hw.gpu.mode': 'auto',
        'hw.initialOrientation': 'Portrait',
        'hw.keyboard': 'yes',
        'hw.lcd.density': String(spec.density),
        'hw.lcd.height': String(spec.height),
        'hw.lcd.width': String(spec.width),
        'hw.mainKeys': 'no',
        'hw.ramSize': String(req.ramMb),
        'hw.sdCard': 'yes',
        'hw.sensors.orientation': 'yes',
        'hw.sensors.proximity': 'yes',
        'image.sysdir.1': `system-images/${apiDir}/${tag}/${abi}/`,
        'tag.display': tagDisplay,
        'tag.id': tag,
        'vm.heapSize': '256'
      })

      if (req.startAfterCreate) {
        const startRes = await this.startAvd(cleanName, req.headless)
        if (!startRes.ok) {
          return { ok: true, message: `已创建 ${cleanName}，但启动失败: ${startRes.error}` }
        }
      }

      return { ok: true, message: `模拟器 ${cleanName} 创建成功` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async startAvd(name: string, headless: boolean): Promise<ActionResult> {
    const env = this.getEnvStatus()
    if (!env.emulatorPath) {
      return {
        ok: false,
        error: '未检测到 Android SDK Emulator（请通过 Android Studio SDK Manager 或 sdkmanager "emulator" 安装）'
      }
    }

    const args = ['-avd', name, '-dns-server', '223.5.5.5,114.114.114.114']
    const proxy = await getMacSystemHttpProxy()
    if (proxy) {
      args.push('-http-proxy', `http://${proxy.host}:${proxy.port}`)
    }
    if (headless) {
      args.push('-no-window', '-no-audio', '-no-boot-anim')
    }

    try {
      const proc = spawn(env.emulatorPath, args, {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...(env.sdkRoot ? { ANDROID_HOME: env.sdkRoot, ANDROID_SDK_ROOT: env.sdkRoot } : {})
        }
      })

      let output = ''
      const onData = (d: Buffer): void => {
        if (output.length < 4096) output += d.toString('utf-8')
      }
      proc.stdout?.on('data', onData)
      proc.stderr?.on('data', onData)

      const earlyResult = await new Promise<ActionResult>((resolve) => {
        let settled = false
        const finish = (res: ActionResult): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          proc.stdout?.off('data', onData)
          proc.stderr?.off('data', onData)
          proc.stdout?.destroy()
          proc.stderr?.destroy()
          resolve(res)
        }

        const timer = setTimeout(() => {
          proc.unref()
          this.spawnedProcs.set(name, proc)
          proc.once('exit', () => {
            if (this.spawnedProcs.get(name) === proc) {
              this.spawnedProcs.delete(name)
            }
          })
          finish({
            ok: true,
            message: headless ? `正在后台无头启动 ${name}，请稍候设备自动上线...` : `正在启动模拟器 ${name}...`
          })
        }, 2200)

        proc.once('error', (err) => {
          finish({ ok: false, error: err.message })
        })

        proc.once('exit', (code) => {
          const fatalLine = output
            .split(/\r?\n/)
            .find((l) => /FATAL|ERROR/i.test(l))
            ?.trim()
          finish({
            ok: false,
            error: fatalLine || output.trim() || `模拟器启动失败 (exit code ${code ?? 'unknown'})`
          })
        })
      })

      return earlyResult
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async stopAvd(name: string, runningSerial?: string): Promise<ActionResult> {
    try {
      if (runningSerial && this.adbPath) {
        await execAdb(this.adbPath, ['-s', runningSerial, 'emu', 'kill'], 6000)
      }
      const proc = this.spawnedProcs.get(name)
      if (proc && !proc.killed) {
        proc.kill('SIGTERM')
      }
      this.spawnedProcs.delete(name)
      return { ok: true, message: `已停止模拟器 ${name}` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async wipeAvdData(name: string): Promise<ActionResult> {
    const avdDir = path.join(getAvdHome(), `${name}.avd`)
    if (!fs.existsSync(avdDir)) {
      return { ok: false, error: `未找到模拟器目录: ${avdDir}` }
    }
    try {
      const removable = ['userdata-qemu.img', 'userdata-qemu.img.qcow2', 'cache.img', 'cache.img.qcow2', 'encryptionkey.img', 'encryptionkey.img.qcow2']
      for (const file of removable) {
        fs.rmSync(path.join(avdDir, file), { force: true })
      }
      fs.rmSync(path.join(avdDir, 'snapshots'), { recursive: true, force: true })
      return { ok: true, message: `已清空 ${name} 的用户数据` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async deleteAvd(name: string, runningSerial?: string): Promise<ActionResult> {
    if (runningSerial) {
      await this.stopAvd(name, runningSerial)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    const env = this.getEnvStatus()
    if (env.avdmanagerPath) {
      try {
        await execFileAsync(env.avdmanagerPath, ['delete', 'avd', '-n', name], { timeout: 10000 })
      } catch {
        // 即使 avdmanager 删除失败，下方仍强制清理目录与 ini
      }
    }

    const avdHome = getAvdHome()
    const avdDir = path.join(avdHome, `${name}.avd`)
    const iniFile = path.join(avdHome, `${name}.ini`)
    const freedBytes = getDirSizeBytes(avdDir) + (fs.existsSync(iniFile) ? fs.statSync(iniFile).size : 0)

    try {
      fs.rmSync(avdDir, { recursive: true, force: true })
      fs.rmSync(iniFile, { force: true })
      const freedGb = (freedBytes / (1024 * 1024 * 1024)).toFixed(2)
      return { ok: true, message: `已彻底删除 ${name} 并释放 ${freedGb} GB 磁盘空间` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
