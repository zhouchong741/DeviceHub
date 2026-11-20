import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { AppConfig, ColorSchemePreference, GridCols, QualityPreset } from '../types'

const DEFAULT_CONFIG: AppConfig = {
  quality: '720p',
  gridCols: 3,
  colorScheme: 'system'
}

const VALID_QUALITIES = new Set<QualityPreset>(['540p', '720p', '1080p'])
const VALID_COLS = new Set<GridCols>([2, 3, 4])
const VALID_SCHEMES = new Set<ColorSchemePreference>(['system', 'light', 'dark'])

function getConfigFilePath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

function sanitizeConfig(raw: Partial<AppConfig> | null | undefined): AppConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CONFIG }
  }
  return {
    adbPath: typeof raw.adbPath === 'string' && raw.adbPath.trim() ? raw.adbPath.trim() : undefined,
    quality: VALID_QUALITIES.has(raw.quality as QualityPreset) ? (raw.quality as QualityPreset) : DEFAULT_CONFIG.quality,
    gridCols: VALID_COLS.has(raw.gridCols as GridCols) ? (raw.gridCols as GridCols) : DEFAULT_CONFIG.gridCols,
    colorScheme: VALID_SCHEMES.has(raw.colorScheme as ColorSchemePreference)
      ? (raw.colorScheme as ColorSchemePreference)
      : DEFAULT_CONFIG.colorScheme
  }
}

export function getConfig(): AppConfig {
  try {
    const filePath = getConfigFilePath()
    if (!fs.existsSync(filePath)) {
      return { ...DEFAULT_CONFIG }
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    return sanitizeConfig(JSON.parse(content) as Partial<AppConfig>)
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  const next = sanitizeConfig({ ...getConfig(), ...patch })
  try {
    const filePath = getConfigFilePath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf-8')
  } catch (err) {
    console.error('[config] Failed to persist config.json:', err)
  }
  return next
}
