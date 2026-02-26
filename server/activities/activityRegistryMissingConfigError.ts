import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

export function isMissingDiscoveredConfigError(err: unknown, configPath: string): boolean {
  if (fs.existsSync(configPath)) {
    return false
  }

  if (!(err instanceof Error)) {
    return false
  }

  const missingConfigError = err as Error & { code?: unknown; path?: unknown }
  const errorCode = missingConfigError.code
  if (errorCode !== 'ERR_MODULE_NOT_FOUND' && errorCode !== 'ENOENT') {
    return false
  }

  const configUrl = pathToFileURL(configPath).href
  if (missingConfigError.path === configPath) {
    return true
  }

  return err.message.includes(configPath) || err.message.includes(configUrl)
}
