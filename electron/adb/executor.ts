import { execFile, spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'
import type { ScreenshotResult } from '../types'

const execFileAsync = promisify(execFile)

export async function execAdb(
  adbPath: string,
  args: string[],
  timeoutMs = 15000
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(adbPath, args, {
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024
  })
  return { stdout, stderr }
}

export async function pushFile(
  adbPath: string,
  serial: string,
  localPath: string,
  remotePath: string
): Promise<void> {
  await execAdb(adbPath, ['-s', serial, 'push', localPath, remotePath], 30000)
}

export async function forwardPort(
  adbPath: string,
  serial: string,
  localPort: number,
  remoteAbstract: string
): Promise<void> {
  await execAdb(adbPath, ['-s', serial, 'forward', `tcp:${localPort}`, `localabstract:${remoteAbstract}`], 10000)
}

export async function removeForward(adbPath: string, serial: string, localPort: number): Promise<void> {
  try {
    await execAdb(adbPath, ['-s', serial, 'forward', '--remove', `tcp:${localPort}`], 5000)
  } catch {
    // 设备拔出或端口已被清理时忽略错误
  }
}

export function captureScreenshot(
  adbPath: string,
  serial: string,
  deviceLabel: string
): Promise<ScreenshotResult> {
  return new Promise((resolve) => {
    const child = spawn(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'])
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ ok: false, error: '截图超时，请检查设备响应状态。' })
    }, 15000)

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk))

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: err.message })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString('utf-8').trim()
        resolve({ ok: false, error: stderr || `screencap exited with code ${code}` })
        return
      }
      const png = Buffer.concat(chunks)
      if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) {
        resolve({ ok: false, error: '未获取到有效的 PNG 截图数据。' })
        return
      }

      try {
        const dir = path.join(os.homedir(), 'Pictures', 'DroidWall')
        fs.mkdirSync(dir, { recursive: true })
        const safeLabel = (deviceLabel || serial).replace(/[^a-zA-Z0-9._-]+/g, '_')
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const filePath = path.join(dir, `${safeLabel}_${stamp}.png`)
        fs.writeFileSync(filePath, png)
        resolve({ ok: true, filePath })
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
  })
}
