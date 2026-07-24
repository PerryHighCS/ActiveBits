import type {
  ActivityConfig,
  ActivityCreateSessionBootstrapConfig,
  ActivityCreateSessionBootstrapSessionStorageEntry,
  ActivityClientRoute,
  ActivityDeepLinkOption,
  ActivityDeepLinkOptionChoice,
  ActivityUtility,
  ActivityStandaloneEntryConfig,
  ActivityDeepLinkPreflightConfig,
} from './activity.js'
import type {
  ActivityWaitingRoomConfig,
  WaitingRoomCustomFieldConfig,
  WaitingRoomFieldConfig,
  WaitingRoomSerializableValue,
  WaitingRoomSelectFieldConfig,
  WaitingRoomTextFieldConfig,
} from './waitingRoom.js'

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

function isSerializableValue(value: unknown): value is WaitingRoomSerializableValue {
  if (value == null) {
    return true
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isSerializableValue(entry))
  }
  if (!isRecord(value)) {
    return false
  }
  return Object.values(value).every((entry) => isSerializableValue(entry))
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
    const optionType = typeof typeValue === 'string' ? typeValue : 'text'
    if (
      typeValue !== undefined
      && typeValue !== 'select'
      && typeValue !== 'text'
      && typeValue !== 'number'
      && typeValue !== 'checkbox'
      && typeValue !== 'multiselect'
    ) {
      throw new Error(`${optionContext}: "type" must be "select", "text", "number", "checkbox", or "multiselect" when provided`)
    }

    const validatorValue = optionValue.validator
    if (validatorValue !== undefined && validatorValue !== 'url') {
      throw new Error(`${optionContext}: "validator" must be "url" when provided`)
    }

    const options = parseDeepLinkOptionChoices(optionValue.options, optionContext)
    const defaultValue = optionValue.defaultValue
    if (
      defaultValue !== undefined
      && typeof defaultValue !== 'string'
      && typeof defaultValue !== 'number'
      && typeof defaultValue !== 'boolean'
      && !Array.isArray(defaultValue)
    ) {
      throw new Error(`${optionContext}: "defaultValue" must be a string, number, boolean, or string array when provided`)
    }
    if (Array.isArray(defaultValue) && !defaultValue.every((entry) => typeof entry === 'string')) {
      throw new Error(`${optionContext}: "defaultValue" string arrays may only contain strings`)
    }
    if (Array.isArray(defaultValue) && optionType !== 'multiselect') {
      throw new Error(`${optionContext}: "defaultValue" string arrays are only supported when "type" is "multiselect"`)
    }
    if (defaultValue !== undefined && optionType === 'multiselect' && !Array.isArray(defaultValue)) {
      throw new Error(`${optionContext}: "defaultValue" must be a string array when "type" is "multiselect"`)
    }
    if (
      defaultValue !== undefined
      && optionType === 'checkbox'
      && defaultValue !== true
      && defaultValue !== false
      && defaultValue !== 'true'
      && defaultValue !== 'false'
    ) {
      throw new Error(`${optionContext}: "defaultValue" must be a boolean or "true"/"false" string when "type" is "checkbox"`)
    }
    if (defaultValue !== undefined && optionType === 'number' && (typeof defaultValue !== 'number' || !Number.isFinite(defaultValue))) {
      throw new Error(`${optionContext}: "defaultValue" must be a finite number when "type" is "number"`)
    }
    if (
      defaultValue !== undefined
      && (optionType === 'select' || optionType === 'text')
      && typeof defaultValue !== 'string'
    ) {
      throw new Error(`${optionContext}: "defaultValue" must be a string when "type" is "${optionType}"`)
    }
    const min = optionValue.min
    if (min !== undefined && (typeof min !== 'number' || !Number.isFinite(min))) {
      throw new Error(`${optionContext}: "min" must be a finite number when provided`)
    }
    const max = optionValue.max
    if (max !== undefined && (typeof max !== 'number' || !Number.isFinite(max))) {
      throw new Error(`${optionContext}: "max" must be a finite number when provided`)
    }
    const step = optionValue.step
    if (step !== undefined && (typeof step !== 'number' || !Number.isFinite(step) || step <= 0)) {
      throw new Error(`${optionContext}: "step" must be a positive finite number when provided`)
    }
    if (optionType !== 'number' && (min !== undefined || max !== undefined || step !== undefined)) {
      throw new Error(`${optionContext}: "min", "max", and "step" are only supported when "type" is "number"`)
    }
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      throw new Error(`${optionContext}: "min" must be less than or equal to "max"`)
    }
    if (
      typeof min === 'number'
      && typeof max === 'number'
      && typeof step === 'number'
      && max > min
      && step > max - min
    ) {
      throw new Error(`${optionContext}: "step" must be less than or equal to the configured range`)
    }
    parsed[optionKey] = {
      ...(label !== undefined ? { label } : {}),
      ...(typeValue !== undefined ? { type: typeValue } : {}),
      ...(validatorValue !== undefined ? { validator: validatorValue } : {}),
      ...(options !== undefined ? { options } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(step !== undefined ? { step } : {}),
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

function parseCreateSessionBootstrapHistoryState(
  raw: unknown,
  context: string,
): string[] | undefined {
  if (raw == null) {
    return undefined
  }
  if (!Array.isArray(raw)) {
    throw new Error(`${context}: "historyState" must be an array when provided`)
  }

  return raw.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(`${context}.historyState[${index}] must be a non-empty string`)
    }
    return entry.trim()
  })
}

function parseCreateSessionBootstrapSelectedOptionsToSessionData(
  raw: unknown,
  context: string,
): string[] | undefined {
  if (raw == null) {
    return undefined
  }
  if (!Array.isArray(raw)) {
    throw new Error(`${context}: "selectedOptionsToSessionData" must be an array when provided`)
  }

  return raw.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(`${context}.selectedOptionsToSessionData[${index}] must be a non-empty string`)
    }
    return entry.trim()
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
  const historyState = parseCreateSessionBootstrapHistoryState(raw.historyState, `${context}.createSessionBootstrap`)
  const selectedOptionsToSessionData = parseCreateSessionBootstrapSelectedOptionsToSessionData(
    raw.selectedOptionsToSessionData,
    `${context}.createSessionBootstrap`,
  )
  return {
    ...(sessionStorage !== undefined ? { sessionStorage } : {}),
    ...(historyState !== undefined ? { historyState } : {}),
    ...(selectedOptionsToSessionData !== undefined ? { selectedOptionsToSessionData } : {}),
  }
}

function parseManageLayout(
  raw: unknown,
  context: string,
  fieldName: 'manageLayout' | 'standaloneLayout' | 'studentLayout' = 'manageLayout',
): ActivityConfig['manageLayout'] {
  if (raw == null) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error(`${context}: "${fieldName}" must be an object when provided`)
  }

  const expandShell = readOptionalBoolean(raw, 'expandShell', `${context}.${fieldName}`)
  return {
    ...(expandShell !== undefined ? { expandShell } : {}),
  }
}

function parseEmbeddedRuntime(raw: unknown, context: string): ActivityConfig['embeddedRuntime'] {
  if (raw == null) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error(`${context}: "embeddedRuntime" must be an object when provided`)
  }

  const instructorGatedRaw = raw.instructorGated
  if (instructorGatedRaw !== undefined && instructorGatedRaw !== null) {
    if (instructorGatedRaw !== 'runtime' && instructorGatedRaw !== 'waiting-room') {
      throw new Error(
        `${context}.embeddedRuntime: "instructorGated" must be "runtime" or "waiting-room" when provided`,
      )
    }
  }
  const instructorGated =
    instructorGatedRaw === 'runtime' || instructorGatedRaw === 'waiting-room'
      ? instructorGatedRaw
      : undefined
  return {
    ...(instructorGated !== undefined ? { instructorGated } : {}),
  }
}

function parseUtilities(raw: unknown, context: string): ActivityUtility[] | undefined {
  if (raw == null) {
    return undefined
  }
  if (!Array.isArray(raw)) {
    throw new Error(`${context}: "utilities" must be an array when provided`)
  }

  return raw.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`${context}.utilities[${index}] must be an object`)
    }

    const action = entry.action
    if (action !== 'copy-url' && action !== 'go-to-url') {
      throw new Error(`${context}.utilities[${index}]: "action" must be "copy-url" or "go-to-url"`)
    }

    const surfaces = entry.surfaces
    if (surfaces !== undefined) {
      if (!Array.isArray(surfaces) || surfaces.some((surface) => surface !== 'manage' && surface !== 'home')) {
        throw new Error(`${context}.utilities[${index}]: "surfaces" must contain only "manage" or "home"`)
      }
    }

    const renderTarget = entry.renderTarget
    if (renderTarget !== undefined && renderTarget !== 'student' && renderTarget !== 'util') {
      throw new Error(`${context}.utilities[${index}]: "renderTarget" must be "student" or "util" when provided`)
    }

    return {
      id: readRequiredString(entry, 'id', `${context}.utilities[${index}]`),
      label: readRequiredString(entry, 'label', `${context}.utilities[${index}]`),
      action,
      path: readRequiredString(entry, 'path', `${context}.utilities[${index}]`),
      ...(readOptionalString(entry, 'description', `${context}.utilities[${index}]`) !== undefined
        ? { description: readOptionalString(entry, 'description', `${context}.utilities[${index}]`) }
        : {}),
      ...(readOptionalString(entry, 'standaloneSessionId', `${context}.utilities[${index}]`) !== undefined
        ? { standaloneSessionId: readOptionalString(entry, 'standaloneSessionId', `${context}.utilities[${index}]`) }
        : {}),
      ...(surfaces !== undefined ? { surfaces: surfaces as Array<'manage' | 'home'> } : {}),
      ...(renderTarget !== undefined ? { renderTarget } : {}),
    }
  })
}

function parseStandaloneEntry(raw: unknown, context: string): ActivityStandaloneEntryConfig | undefined {
  if (raw == null) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error(`${context}: "standaloneEntry" must be an object when provided`)
  }

  const enabled = raw.enabled
  if (typeof enabled !== 'boolean') {
    throw new Error(`${context}.standaloneEntry: "enabled" must be a boolean`)
  }

  const supportsDirectPath = readOptionalBoolean(raw, 'supportsDirectPath', `${context}.standaloneEntry`)
  const supportsPermalink = readOptionalBoolean(raw, 'supportsPermalink', `${context}.standaloneEntry`)
  const showOnHome = readOptionalBoolean(raw, 'showOnHome', `${context}.standaloneEntry`)
  const title = readOptionalString(raw, 'title', `${context}.standaloneEntry`)
  const description = readOptionalString(raw, 'description', `${context}.standaloneEntry`)

  return {
    enabled,
    ...(supportsDirectPath !== undefined ? { supportsDirectPath } : {}),
    ...(supportsPermalink !== undefined ? { supportsPermalink } : {}),
    ...(showOnHome !== undefined ? { showOnHome } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
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
  if ('persistentLinkBuilderMode' in raw && raw.persistentLinkBuilderMode != null) {
    throw new Error(`${context}.manageDashboard: "persistentLinkBuilderMode" is no longer supported`)
  }

  return {
    ...(customPersistentLinkBuilder !== undefined ? { customPersistentLinkBuilder } : {}),
  }
}

function parseWaitingRoomField(raw: unknown, context: string): WaitingRoomFieldConfig {
  if (!isRecord(raw)) {
    throw new Error(`${context}: waiting-room field must be an object`)
  }

  const id = readRequiredString(raw, 'id', context)
  const label = readOptionalString(raw, 'label', context)
  const helpText = readOptionalString(raw, 'helpText', context)
  const required = readOptionalBoolean(raw, 'required', context)
  const type = raw.type

  const shared = {
    id,
    ...(label !== undefined ? { label } : {}),
    ...(helpText !== undefined ? { helpText } : {}),
    ...(required !== undefined ? { required } : {}),
  }

  if (type === 'text') {
    const placeholder = readOptionalString(raw, 'placeholder', context)
    const defaultValue = raw.defaultValue
    if (defaultValue !== undefined && typeof defaultValue !== 'string') {
      throw new Error(`${context}: "defaultValue" must be a string when type is "text"`)
    }

    const parsed: WaitingRoomTextFieldConfig = {
      ...shared,
      type: 'text',
      ...(placeholder !== undefined ? { placeholder } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    }
    return parsed
  }

  if (type === 'select') {
    const options = parseDeepLinkOptionChoices(raw.options, context)
    if (!options || options.length === 0) {
      throw new Error(`${context}: "options" must contain at least one choice when type is "select"`)
    }
    const defaultValue = raw.defaultValue
    if (defaultValue !== undefined && typeof defaultValue !== 'string') {
      throw new Error(`${context}: "defaultValue" must be a string when type is "select"`)
    }

    const parsed: WaitingRoomSelectFieldConfig = {
      ...shared,
      type: 'select',
      options,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    }
    return parsed
  }

  if (type === 'custom') {
    const component = readRequiredString(raw, 'component', context)
    const props = raw.props
    if (props !== undefined && (!isRecord(props) || !isSerializableValue(props))) {
      throw new Error(`${context}: "props" must be a serializable object when type is "custom"`)
    }

    const defaultValue = raw.defaultValue
    if (defaultValue !== undefined && !isSerializableValue(defaultValue)) {
      throw new Error(`${context}: "defaultValue" must be serializable when type is "custom"`)
    }

    const parsed: WaitingRoomCustomFieldConfig = {
      ...shared,
      type: 'custom',
      component,
      ...(props !== undefined ? { props } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    }
    return parsed
  }

  throw new Error(`${context}: "type" must be "text", "select", or "custom"`)
}

function parseWaitingRoom(raw: unknown, context: string): ActivityWaitingRoomConfig | undefined {
  if (raw == null) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error(`${context}: "waitingRoom" must be an object when provided`)
  }
  if (!Array.isArray(raw.fields)) {
    throw new Error(`${context}.waitingRoom: "fields" must be an array`)
  }

  return {
    fields: raw.fields.map((field, index) => parseWaitingRoomField(field, `${context}.waitingRoom.fields[${index}]`)),
  }
}

const RESERVED_CLIENT_ROUTE_IDS = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype'])

function parseClientRoutes(raw: unknown, context: string): ActivityClientRoute[] | undefined {
  if (raw == null) return undefined
  if (!Array.isArray(raw)) throw new Error(`${context}: "clientRoutes" must be an array when provided`)

  const ids = new Set<string>()
  const paths = new Set<string>()
  const reservedPaths = ['/', '/api', '/ws', '/status', '/manage', '/launch', '/session-ended', '/activity', '/solo', '/util']
  return raw.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${context}.clientRoutes[${index}] must be an object`)
    const id = readRequiredString(entry, 'id', `${context}.clientRoutes[${index}]`)
    const path = readRequiredString(entry, 'path', `${context}.clientRoutes[${index}]`)
    if (RESERVED_CLIENT_ROUTE_IDS.has(id)) {
      throw new Error(`${context}.clientRoutes[${index}]: "id" is reserved`)
    }
    if (!path.startsWith('/')) throw new Error(`${context}.clientRoutes[${index}]: "path" must start with "/"`)
    if (/[?#\\:*]/.test(path)) throw new Error(`${context}.clientRoutes[${index}]: "path" must be a static pathname without "?", "#", "\\", ":", or "*"`)
    if (reservedPaths.some((reserved) => path === reserved || (reserved !== '/' && path.startsWith(`${reserved}/`)))) {
      throw new Error(`${context}.clientRoutes[${index}]: "path" uses a reserved shared-app route prefix`)
    }
    if (ids.has(id)) throw new Error(`${context}.clientRoutes: route ids must be unique`)
    if (paths.has(path)) throw new Error(`${context}.clientRoutes: route paths must be unique`)
    ids.add(id)
    paths.add(path)
    return { id, path }
  })
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
    standaloneEntry: (() => {
      const standaloneEntry = parseStandaloneEntry(rawConfig.standaloneEntry, context)
      if (!standaloneEntry) {
        throw new Error(`${context}: "standaloneEntry" must be provided`)
      }
      return standaloneEntry
    })(),
  }

  const title = readOptionalString(rawConfig, 'title', context)
  const clientEntry = readOptionalString(rawConfig, 'clientEntry', context)
  const serverEntry = readOptionalString(rawConfig, 'serverEntry', context)
  const isDev = readOptionalBoolean(rawConfig, 'isDev', context)
  const utilMode = readOptionalBoolean(rawConfig, 'utilMode', context)
  const deepLinkOptions = parseDeepLinkOptions(rawConfig.deepLinkOptions, context)
  const deepLinkGenerator = parseDeepLinkGenerator(rawConfig.deepLinkGenerator, context)
  const createSessionBootstrap = parseCreateSessionBootstrap(rawConfig.createSessionBootstrap, context)
  const utilities = parseUtilities(rawConfig.utilities, context)
  const manageDashboard = parseManageDashboard(rawConfig.manageDashboard, context)
  const manageLayout = parseManageLayout(rawConfig.manageLayout, context, 'manageLayout')
  const standaloneLayout = parseManageLayout(rawConfig.standaloneLayout, context, 'standaloneLayout')
  const studentLayout = parseManageLayout(rawConfig.studentLayout, context, 'studentLayout')
  const embeddedRuntime = parseEmbeddedRuntime(rawConfig.embeddedRuntime, context)
  const reportEndpoint = readOptionalString(rawConfig, 'reportEndpoint', context)
  const waitingRoom = parseWaitingRoom(rawConfig.waitingRoom, context)
  const clientRoutes = parseClientRoutes(rawConfig.clientRoutes, context)

  if (utilities?.some((utility) => utility.renderTarget === 'util') && utilMode !== true) {
    throw new Error(`${context}: utilities with "renderTarget: util" require "utilMode: true"`)
  }

  assignOptionalField(parsed, 'title', title)
  assignOptionalField(parsed, 'clientEntry', clientEntry)
  assignOptionalField(parsed, 'serverEntry', serverEntry)
  assignOptionalField(parsed, 'isDev', isDev)
  assignOptionalField(parsed, 'utilMode', utilMode)
  assignOptionalField(parsed, 'deepLinkOptions', deepLinkOptions)
  assignOptionalField(parsed, 'deepLinkGenerator', deepLinkGenerator)
  assignOptionalField(parsed, 'createSessionBootstrap', createSessionBootstrap)
  assignOptionalField(parsed, 'utilities', utilities)
  assignOptionalField(parsed, 'manageDashboard', manageDashboard)
  assignOptionalField(parsed, 'manageLayout', manageLayout)
  assignOptionalField(parsed, 'standaloneLayout', standaloneLayout)
  assignOptionalField(parsed, 'studentLayout', studentLayout)
  assignOptionalField(parsed, 'embeddedRuntime', embeddedRuntime)
  assignOptionalField(parsed, 'reportEndpoint', reportEndpoint)
  assignOptionalField(parsed, 'waitingRoom', waitingRoom)
  assignOptionalField(parsed, 'clientRoutes', clientRoutes)

  return parsed
}

export default {
  parseActivityConfig,
}
