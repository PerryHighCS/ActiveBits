import type {
  ActivityConfig,
  ActivityCreateSessionBootstrapConfig,
  ActivityCreateSessionBootstrapSessionStorageEntry,
  ActivityDeepLinkOption,
  ActivityDeepLinkOptionChoice,
  ActivityDeepLinkPreflightConfig,
} from './activity.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function readRequiredString(source: Record<string, unknown>, key: string, context: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${context}: "${key}" must be a non-empty string`)
  }
  return value.trim()
}

function readOptionalString(source: Record<string, unknown>, key: string, context: string): string | undefined {
  if (!(key in source) || source[key] == null) {
    return undefined
  }
  const value = source[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${context}: "${key}" must be a non-empty string when provided`)
  }
  return value.trim()
}

function readRequiredStringAllowEmpty(source: Record<string, unknown>, key: string, context: string): string {
  const value = source[key]
  if (typeof value !== 'string') {
    throw new Error(`${context}: "${key}" must be a string`)
  }
  return value
}

function readOptionalBoolean(source: Record<string, unknown>, key: string, context: string): boolean | undefined {
  if (!(key in source) || source[key] == null) {
    return undefined
  }
  if (typeof source[key] !== 'boolean') {
    throw new Error(`${context}: "${key}" must be a boolean when provided`)
  }
  return source[key] as boolean
}

function parseSoloModeMeta(raw: unknown, context: string): ActivityConfig['soloModeMeta'] {
  if (raw == null) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error(`${context}: "soloModeMeta" must be an object when provided`)
  }

  const parsed: NonNullable<ActivityConfig['soloModeMeta']> = {}
  const title = readOptionalString(raw, 'title', `${context}.soloModeMeta`)
  const description = readOptionalString(raw, 'description', `${context}.soloModeMeta`)
  const buttonText = readOptionalString(raw, 'buttonText', `${context}.soloModeMeta`)

  if (title !== undefined) parsed.title = title
  if (description !== undefined) parsed.description = description
  if (buttonText !== undefined) parsed.buttonText = buttonText

  return parsed
}

function parseDeepLinkOptionChoices(raw: unknown, context: string): ActivityDeepLinkOptionChoice[] | undefined {
  if (raw == null) {
    return undefined
  }
  if (!Array.isArray(raw)) {
    throw new Error(`${context}: "options" must be an array when provided`)
  }

  return raw.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`${context}: "options[${index}]" must be an object`)
    }
    return {
      value: readRequiredStringAllowEmpty(entry, 'value', `${context}.options[${index}]`),
      label: readRequiredString(entry, 'label', `${context}.options[${index}]`),
    }
  })
}

function parseDeepLinkOptions(raw: unknown, context: string): Record<string, ActivityDeepLinkOption> | undefined {
  if (raw == null) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error(`${context}: "deepLinkOptions" must be an object when provided`)
  }

  const parsed: Record<string, ActivityDeepLinkOption> = {}

  for (const [optionKey, optionValue] of Object.entries(raw)) {
    if (optionKey.trim().length === 0) {
      throw new Error(`${context}.deepLinkOptions: option keys must be non-empty`)
    }
    if (!isRecord(optionValue)) {
      throw new Error(`${context}.deepLinkOptions.${optionKey}: option config must be an object`)
    }

    const optionContext = `${context}.deepLinkOptions.${optionKey}`
    const label = readOptionalString(optionValue, 'label', optionContext)
    const typeValue = optionValue.type
    if (typeValue !== undefined && typeValue !== 'select' && typeValue !== 'text') {
      throw new Error(`${optionContext}: "type" must be "select" or "text" when provided`)
    }

    const validatorValue = optionValue.validator
    if (validatorValue !== undefined && validatorValue !== 'url') {
      throw new Error(`${optionContext}: "validator" must be "url" when provided`)
    }

    const options = parseDeepLinkOptionChoices(optionValue.options, optionContext)
    parsed[optionKey] = {
      ...(label !== undefined ? { label } : {}),
      ...(typeValue !== undefined ? { type: typeValue } : {}),
      ...(validatorValue !== undefined ? { validator: validatorValue } : {}),
      ...(options !== undefined ? { options } : {}),
    }
  }

  return parsed
}

function parseDeepLinkPreflight(raw: unknown, context: string): ActivityDeepLinkPreflightConfig | undefined {
  if (raw == null) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error(`${context}: "preflight" must be an object when provided`)
  }

  if (raw.type !== 'reveal-sync-ping') {
    throw new Error(`${context}.preflight: "type" must be "reveal-sync-ping"`)
  }
  const optionKey = readRequiredString(raw, 'optionKey', `${context}.preflight`)
  const timeoutMs = raw.timeoutMs
  if (timeoutMs !== undefined) {
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(`${context}.preflight: "timeoutMs" must be a positive finite number when provided`)
    }
  }

  return {
    type: 'reveal-sync-ping',
    optionKey,
    ...(timeoutMs !== undefined ? { timeoutMs: Math.floor(timeoutMs) } : {}),
  }
}

function parseDeepLinkGenerator(raw: unknown, context: string): ActivityConfig['deepLinkGenerator'] {
  if (raw == null) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error(`${context}: "deepLinkGenerator" must be an object when provided`)
  }

  const endpoint = readRequiredString(raw, 'endpoint', `${context}.deepLinkGenerator`)
  const mode = raw.mode
  if (mode !== undefined && mode !== 'replace-url' && mode !== 'append-query') {
    throw new Error(`${context}.deepLinkGenerator: "mode" must be "replace-url" or "append-query" when provided`)
  }
  const expectsSelectedOptions = readOptionalBoolean(raw, 'expectsSelectedOptions', `${context}.deepLinkGenerator`)
  const preflight = parseDeepLinkPreflight(raw.preflight, `${context}.deepLinkGenerator`)

  return {
    endpoint,
    ...(mode !== undefined ? { mode } : {}),
    ...(expectsSelectedOptions !== undefined ? { expectsSelectedOptions } : {}),
    ...(preflight !== undefined ? { preflight } : {}),
  }
}

function parseCreateSessionBootstrapSessionStorage(
  raw: unknown,
  context: string,
): ActivityCreateSessionBootstrapSessionStorageEntry[] | undefined {
  if (raw == null) {
    return undefined
  }
  if (!Array.isArray(raw)) {
    throw new Error(`${context}: "sessionStorage" must be an array when provided`)
  }

  return raw.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`${context}.sessionStorage[${index}] must be an object`)
    }
    return {
      keyPrefix: readRequiredString(entry, 'keyPrefix', `${context}.sessionStorage[${index}]`),
      responseField: readRequiredString(entry, 'responseField', `${context}.sessionStorage[${index}]`),
    }
  })
}

function parseCreateSessionBootstrap(raw: unknown, context: string): ActivityCreateSessionBootstrapConfig | undefined {
  if (raw == null) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error(`${context}: "createSessionBootstrap" must be an object when provided`)
  }

  const sessionStorage = parseCreateSessionBootstrapSessionStorage(raw.sessionStorage, `${context}.createSessionBootstrap`)
  return {
    ...(sessionStorage !== undefined ? { sessionStorage } : {}),
  }
}

function parseManageLayout(raw: unknown, context: string): ActivityConfig['manageLayout'] {
  if (raw == null) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error(`${context}: "manageLayout" must be an object when provided`)
  }

  const expandShell = readOptionalBoolean(raw, 'expandShell', `${context}.manageLayout`)
  return {
    ...(expandShell !== undefined ? { expandShell } : {}),
  }
}

function parseManageDashboard(raw: unknown, context: string): ActivityConfig['manageDashboard'] {
  if (raw == null) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error(`${context}: "manageDashboard" must be an object when provided`)
  }

  const customPersistentLinkBuilder = readOptionalBoolean(raw, 'customPersistentLinkBuilder', `${context}.manageDashboard`)
  return {
    ...(customPersistentLinkBuilder !== undefined ? { customPersistentLinkBuilder } : {}),
  }
}

function assignOptionalField<K extends keyof ActivityConfig>(
  target: ActivityConfig,
  key: K,
  value: ActivityConfig[K] | undefined,
): void {
  if (value === undefined) {
    delete target[key]
    return
  }
  target[key] = value
}

export function parseActivityConfig(rawConfig: unknown, sourceLabel = 'activity.config'): ActivityConfig {
  if (!isRecord(rawConfig)) {
    throw new Error(`${sourceLabel}: default export must be an object`)
  }

  const context = sourceLabel
  const parsed: ActivityConfig = {
    ...rawConfig,
    id: readRequiredString(rawConfig, 'id', context),
    name: readRequiredString(rawConfig, 'name', context),
    description: readRequiredString(rawConfig, 'description', context),
    color: readRequiredString(rawConfig, 'color', context),
    soloMode: (() => {
      if (typeof rawConfig.soloMode !== 'boolean') {
        throw new Error(`${context}: "soloMode" must be a boolean`)
      }
      return rawConfig.soloMode
    })(),
  }

  const title = readOptionalString(rawConfig, 'title', context)
  const clientEntry = readOptionalString(rawConfig, 'clientEntry', context)
  const serverEntry = readOptionalString(rawConfig, 'serverEntry', context)
  const isDev = readOptionalBoolean(rawConfig, 'isDev', context)
  const soloModeMeta = parseSoloModeMeta(rawConfig.soloModeMeta, context)
  const deepLinkOptions = parseDeepLinkOptions(rawConfig.deepLinkOptions, context)
  const deepLinkGenerator = parseDeepLinkGenerator(rawConfig.deepLinkGenerator, context)
  const createSessionBootstrap = parseCreateSessionBootstrap(rawConfig.createSessionBootstrap, context)
  const manageDashboard = parseManageDashboard(rawConfig.manageDashboard, context)
  const manageLayout = parseManageLayout(rawConfig.manageLayout, context)

  assignOptionalField(parsed, 'title', title)
  assignOptionalField(parsed, 'clientEntry', clientEntry)
  assignOptionalField(parsed, 'serverEntry', serverEntry)
  assignOptionalField(parsed, 'isDev', isDev)
  assignOptionalField(parsed, 'soloModeMeta', soloModeMeta)
  assignOptionalField(parsed, 'deepLinkOptions', deepLinkOptions)
  assignOptionalField(parsed, 'deepLinkGenerator', deepLinkGenerator)
  assignOptionalField(parsed, 'createSessionBootstrap', createSessionBootstrap)
  assignOptionalField(parsed, 'manageDashboard', manageDashboard)
  assignOptionalField(parsed, 'manageLayout', manageLayout)

  return parsed
}

export default {
  parseActivityConfig,
}
