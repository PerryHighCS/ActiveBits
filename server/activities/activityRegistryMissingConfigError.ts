import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * Determines whether an error represents a discovered activity config that disappeared before loading.
 * This detects a harmless filesystem race (for example concurrent tests creating/removing temp activities)
 * so the registry can skip the config instead of treating it as a fatal load failure.
 *
 * @param err - The error thrown while attempting to load/import the discovered config.
 * @param configPath - Absolute path to the config file that was discovered earlier.
 * @returns `true` when the file is now missing and the error matches a missing-file/module failure.
 */
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
