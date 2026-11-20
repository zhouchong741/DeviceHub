import { execFile } from 'child_process'
import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'
import type { AdbStatus } from '../types'

const execFileAsync = promisify(execFile)

interface CandidatePath {
  path: string
  source: AdbStatus['source']
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return false
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function readAdbVersion(adbPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(adbPath, ['version'], { timeout: 5000 })
    const versionMatch = stdout.match(/^Version\s+([^\s\r\n]+)/m)
    if (versionMatch) return versionMatch[1]
    const bridgeMatch = stdout.match(/version\s+([^\s\r\n]+)/i)
    return bridgeMatch ? bridgeMatch[1] : null
  } catch {
    return null
  }
}

export function isAdbServerListening(host = '127.0.0.1', port = 5037): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 800)

    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(false)
    })
  })
}

export async function ensureAdbServerStarted(adbPath: string): Promise<boolean> {
  const alreadyUp = await isAdbServerListening()
  if (alreadyUp) return true

  try {
    // 仅在 5037 未监听时启动，绝不执行 kill-server 以免影响 Android Studio
    await execFileAsync(adbPath, ['start-server'], { timeout: 12000 })
    return await isAdbServerListening()
  } catch {
    return false
  }
}

export async function locateAdb(customPath?: string): Promise<AdbStatus> {
  const candidates: CandidatePath[] = []

  if (customPath) {
    candidates.push({ path: customPath, source: 'custom' })
  }
  if (process.env.ANDROID_HOME) {
    candidates.push({
      path: path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb'),
      source: 'env'
    })
  }
  if (process.env.ANDROID_SDK_ROOT) {
    candidates.push({
      path: path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb'),
      source: 'env'
    })
  }

  candidates.push(
    {
      path: path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
      source: 'android-studio'
    },
    { path: '/opt/homebrew/bin/adb', source: 'homebrew' },
    { path: '/usr/local/bin/adb', source: 'homebrew' }
  )

  const seen = new Set<string>()
  for (const candidate of candidates) {
    const normalized = path.resolve(candidate.path)
    if (seen.has(normalized)) continue
    seen.add(normalized)

    if (!isExecutableFile(normalized)) continue
    const version = await readAdbVersion(normalized)
    if (!version) continue

    const serverRunning = await ensureAdbServerStarted(normalized)
    return {
      found: true,
      path: normalized,
      version,
      source: candidate.source,
      serverRunning
    }
  }

  return {
    found: false,
    path: null,
    version: null,
    source: 'none',
    serverRunning: false,
    error: '未在本机找到可执行的 adb，请确认已安装 Android Studio SDK 或手动选择 adb 路径。'
  }
}
