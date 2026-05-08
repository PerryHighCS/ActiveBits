import { isValidHttpUrl } from './urlValidationUtils'

export interface DeepLinkOptionChoice {
  value: string
  label: string
}

export interface DeepLinkOption {
  label?: string
  type?: 'select' | 'text' | 'number' | 'checkbox' | 'multiselect'
  options?: DeepLinkOptionChoice[]
  validator?: 'url'
  defaultValue?: string | number | boolean | string[]
  min?: number
  max?: number
  step?: number
}

export interface DeepLinkGeneratorConfig {
  endpoint: string
  mode: 'replace-url' | 'append-query'
  expectsSelectedOptions: boolean
  preflight: DeepLinkPreflightConfig | null
}

export interface DeepLinkPreflightConfig {
  type: 'reveal-sync-ping'
  optionKey: string
  timeoutMs: number
}

export interface DeepLinkPreflightResult {
  valid: boolean
  warning: string | null
}

export interface CreateSessionBootstrapSessionStorageEntry {
  keyPrefix: string
  responseField: string
}

export interface CreateSessionBootstrapConfig {
  sessionStorage: CreateSessionBootstrapSessionStorageEntry[]
  historyState?: string[]
}

export type DeepLinkOptions = Record<string, DeepLinkOption>
export type DeepLinkSelection = Record<string, string>
export type DeepLinkValidationErrors = Record<string, string>

export interface PersistentEntryPolicyOptionLike {
  value: 'instructor-required' | 'solo-allowed' | 'solo-only'
  label: string
  description: string
}

export interface BuildPersistentLinkRequestBodyParams {
  activityId: string
  teacherCode: string
  selectedOptions: Record<string, string>
  entryPolicy: PersistentEntryPolicyOptionLike['value']
  hash?: string
}

export interface ManageDashboardUtilityLike {
  label: string
  path: string
  description?: string
}

export function resolvePersistentLinkPreflightValue(
  optionKey: string | null | undefined,
  selection: Record<string, string>,
): string {
  return optionKey != null && typeof selection[optionKey] === 'string' ? selection[optionKey].trim() : ''
}

export function isPersistentLinkPreflightVerified(
  optionKey: string | null | undefined,
  selection: Record<string, string>,
  validatedValue: string | null,
): boolean {
  const normalizedValue = resolvePersistentLinkPreflightValue(optionKey, selection)
  return optionKey == null || normalizedValue.length === 0 || validatedValue === normalizedValue
}

const CREATE_SESSION_BOOTSTRAP_TTL_MS = 5 * 60 * 1000
const MAX_CREATE_SESSION_BOOTSTRAP_PAYLOADS = 100
const CREATE_SESSION_BOOTSTRAP_SESSION_STORAGE_PREFIX = 'create-session-bootstrap:'

interface CreateSessionBootstrapPayloadEntry {
  payload: Record<string, unknown>
  createdAtMs: number
}

const createSessionBootstrapPayloads = new Map<string, CreateSessionBootstrapPayloadEntry>()

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  return isObjectRecord(value) && !Array.isArray(value)
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function toOptionType(value: unknown): DeepLinkOption['type'] {
  return value === 'select'
    || value === 'number'
    || value === 'checkbox'
    || value === 'multiselect'
    || value === 'text'
    ? value
    : 'text'
}

function toDefaultOptionValue(value: unknown): DeepLinkOption['defaultValue'] | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value
  }
  return undefined
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeMultiselectValue(value: unknown, option: DeepLinkOption): string {
  const allowedValues = new Set((option.options ?? []).map((entry) => entry.value))
  const values = parseMultiselectValues(value)
    .filter((entry) => allowedValues.size === 0 || allowedValues.has(entry))

  return Array.from(new Set(values)).join(',')
}

export function parseMultiselectValues(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : toStringValue(value).split(',')
  return rawValues
    .map((entry) => toStringValue(entry).trim())
    .filter((entry) => entry.length > 0)
}

function normalizeDefaultDeepLinkValue(option: DeepLinkOption): string {
  if (option.defaultValue === undefined) {
    return ''
  }

  if (option.type === 'checkbox') {
    return option.defaultValue === true || option.defaultValue === 'true' ? 'true' : 'false'
  }

  if (option.type === 'multiselect') {
    return normalizeMultiselectValue(option.defaultValue, option)
  }

  return toStringValue(option.defaultValue)
}

function buildCreateSessionBootstrapStorageKey(activityId: string, sessionId: string): string {
  return `${CREATE_SESSION_BOOTSTRAP_SESSION_STORAGE_PREFIX}${activityId}:${sessionId}`
}

function persistCreateSessionBootstrapPayloadToSessionStorage(
  activityId: string,
  sessionId: string,
  payload: Record<string, unknown>,
  createdAtMs: number,
  nowMs = createdAtMs,
): void {
  if (typeof window === 'undefined' || window.sessionStorage == null) {
    return
  }

  const storageKey = buildCreateSessionBootstrapStorageKey(activityId, sessionId)
  const serializedEntry = JSON.stringify({
    createdAtMs,
    payload,
  } satisfies CreateSessionBootstrapPayloadEntry)

  try {
    window.sessionStorage.setItem(storageKey, serializedEntry)
  } catch {
    pruneCreateSessionBootstrapPayloadsFromSessionStorage(nowMs)

    try {
      window.sessionStorage.setItem(storageKey, serializedEntry)
    } catch (retryError) {
      console.warn('[ManageDashboard] Failed to persist same-tab bootstrap payload to sessionStorage:', retryError)
    }
  }
}

function clearCreateSessionBootstrapPayloadFromSessionStorage(
  activityId: string,
  sessionId: string,
): void {
  if (typeof window === 'undefined' || window.sessionStorage == null) {
    return
  }

  try {
    window.sessionStorage.removeItem(buildCreateSessionBootstrapStorageKey(activityId, sessionId))
  } catch {
    // Best-effort cleanup only; consume should still succeed from the in-memory cache.
  }
}

function removeCreateSessionBootstrapStorageEntry(
  storage: Pick<Storage, 'removeItem'>,
  storageKey: string,
): void {
  try {
    storage.removeItem(storageKey)
  } catch {
    // Best-effort cleanup only; callers should still be able to consume in-memory data.
  }
}

function pruneCreateSessionBootstrapPayloadsFromSessionStorage(nowMs: number): void {
  if (typeof window === 'undefined' || window.sessionStorage == null) {
    return
  }

  const storage = window.sessionStorage
  if (typeof storage.key !== 'function' || typeof storage.length !== 'number') {
    return
  }

  const matchingKeys: string[] = []

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (typeof key === 'string' && key.startsWith(CREATE_SESSION_BOOTSTRAP_SESSION_STORAGE_PREFIX)) {
      matchingKeys.push(key)
    }
  }

  const retainedEntries: Array<{ key: string, createdAtMs: number }> = []

  for (const key of matchingKeys) {
    try {
      const rawValue = storage.getItem(key)
      if (typeof rawValue !== 'string' || rawValue.length === 0) {
        storage.removeItem(key)
        continue
      }

      const parsed = JSON.parse(rawValue) as unknown
      if (
        !isPlainObjectRecord(parsed)
        || typeof parsed.createdAtMs !== 'number'
        || !Number.isFinite(parsed.createdAtMs)
        || !isPlainObjectRecord(parsed.payload)
      ) {
        storage.removeItem(key)
        continue
      }

      if (nowMs - parsed.createdAtMs > CREATE_SESSION_BOOTSTRAP_TTL_MS) {
        storage.removeItem(key)
        continue
      }

      retainedEntries.push({
        key,
        createdAtMs: parsed.createdAtMs,
      })
    } catch {
      try {
        storage.removeItem(key)
      } catch {
        // Best-effort cleanup only; keep pruning the remaining keys.
      }
    }
  }

  if (retainedEntries.length <= MAX_CREATE_SESSION_BOOTSTRAP_PAYLOADS) {
    return
  }

  retainedEntries
    .sort((left, right) => left.createdAtMs - right.createdAtMs)
    .slice(0, retainedEntries.length - MAX_CREATE_SESSION_BOOTSTRAP_PAYLOADS)
    .forEach(({ key }) => {
      try {
        storage.removeItem(key)
      } catch {
        // Best-effort cleanup only; a later consume path can still fall back to in-memory data.
      }
    })
}

function consumeCreateSessionBootstrapPayloadFromSessionStorage(
  activityId: string,
  sessionId: string,
  nowMs: number,
): Record<string, unknown> | null {
  if (typeof window === 'undefined' || window.sessionStorage == null) {
    return null
  }

  const storageKey = buildCreateSessionBootstrapStorageKey(activityId, sessionId)
  const rawValue = window.sessionStorage.getItem(storageKey)
  if (typeof rawValue !== 'string' || rawValue.length === 0) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (
      !isPlainObjectRecord(parsed)
      || typeof parsed.createdAtMs !== 'number'
      || !Number.isFinite(parsed.createdAtMs)
      || !isPlainObjectRecord(parsed.payload)
    ) {
      removeCreateSessionBootstrapStorageEntry(window.sessionStorage, storageKey)
      return null
    }

    removeCreateSessionBootstrapStorageEntry(window.sessionStorage, storageKey)
    if (nowMs - parsed.createdAtMs > CREATE_SESSION_BOOTSTRAP_TTL_MS) {
      return null
    }

    return parsed.payload
  } catch (error) {
    removeCreateSessionBootstrapStorageEntry(window.sessionStorage, storageKey)
    console.warn('[ManageDashboard] Failed to parse same-tab bootstrap payload from sessionStorage:', error)
    return null
  }
}

export function parseDeepLinkGenerator(rawDeepLinkGenerator: unknown): DeepLinkGeneratorConfig | null {
  if (!isObjectRecord(rawDeepLinkGenerator)) {
    return null
  }

  const endpoint = typeof rawDeepLinkGenerator.endpoint === 'string' ? rawDeepLinkGenerator.endpoint.trim() : ''
  if (!endpoint) {
    return null
  }

  const parsePreflight = (): DeepLinkPreflightConfig | null => {
    const rawPreflight = rawDeepLinkGenerator.preflight
    if (!isObjectRecord(rawPreflight)) {
      return null
    }

    const type = rawPreflight.type === 'reveal-sync-ping' ? 'reveal-sync-ping' : null
    const optionKey = typeof rawPreflight.optionKey === 'string' ? rawPreflight.optionKey.trim() : ''
    if (!type || !optionKey) {
      return null
    }

    const timeoutMs =
      typeof rawPreflight.timeoutMs === 'number' && Number.isFinite(rawPreflight.timeoutMs) && rawPreflight.timeoutMs > 0
        ? Math.floor(rawPreflight.timeoutMs)
        : 4000

    return {
      type,
      optionKey,
      timeoutMs,
    }
  }

  const preflight = parsePreflight()

  return {
    endpoint,
    mode: rawDeepLinkGenerator.mode === 'append-query' ? 'append-query' : 'replace-url',
    expectsSelectedOptions: rawDeepLinkGenerator.expectsSelectedOptions !== false,
    preflight,
  }
}

export function parseCreateSessionBootstrap(rawCreateSessionBootstrap: unknown): CreateSessionBootstrapConfig | null {
  if (!isObjectRecord(rawCreateSessionBootstrap)) {
    return null
  }

  const rawSessionStorage = Array.isArray(rawCreateSessionBootstrap.sessionStorage)
    ? rawCreateSessionBootstrap.sessionStorage
    : []

  const sessionStorage = rawSessionStorage
    .filter((entry): entry is Record<string, unknown> => isObjectRecord(entry))
    .map((entry) => ({
      keyPrefix: typeof entry.keyPrefix === 'string' ? entry.keyPrefix.trim() : '',
      responseField: typeof entry.responseField === 'string' ? entry.responseField.trim() : '',
    }))
    .filter((entry) => entry.keyPrefix.length > 0 && entry.responseField.length > 0)

  const historyState = Array.isArray(rawCreateSessionBootstrap.historyState)
    ? rawCreateSessionBootstrap.historyState
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    : []

  if (sessionStorage.length === 0 && historyState.length === 0) {
    return null
  }

  return {
    sessionStorage,
    ...(historyState.length > 0 ? { historyState } : {}),
  }
}

export function persistCreateSessionBootstrapToSessionStorage(
  rawCreateSessionBootstrap: unknown,
  sessionId: string,
  payload: Record<string, unknown>,
): void {
  if (typeof window === 'undefined' || window.sessionStorage == null) {
    return
  }

  const createSessionBootstrap = parseCreateSessionBootstrap(rawCreateSessionBootstrap)
  if (!createSessionBootstrap) {
    return
  }

  for (const entry of createSessionBootstrap.sessionStorage) {
    const value = payload[entry.responseField]
    if (typeof value !== 'string' || value.length === 0) {
      continue
    }

    try {
      window.sessionStorage.setItem(`${entry.keyPrefix}${sessionId}`, value)
    } catch (error) {
      console.warn('[ManageDashboard] Failed to persist create-session bootstrap data to sessionStorage:', error)
    }
  }
}

export function storeCreateSessionBootstrapPayload(
  activityId: string,
  sessionId: string,
  payload: Record<string, unknown>,
  nowMs = Date.now(),
): void {
  createSessionBootstrapPayloads.set(`${activityId}:${sessionId}`, {
    payload,
    createdAtMs: nowMs,
  })
  persistCreateSessionBootstrapPayloadToSessionStorage(activityId, sessionId, payload, nowMs, nowMs)
  pruneCreateSessionBootstrapPayloads(nowMs)
}

export function consumeCreateSessionBootstrapPayload(
  activityId: string,
  sessionId: string,
  nowMs = Date.now(),
): Record<string, unknown> | null {
  pruneCreateSessionBootstrapPayloads(nowMs)
  const key = `${activityId}:${sessionId}`
  const entry = createSessionBootstrapPayloads.get(key) ?? null

  const payload = entry?.payload ?? consumeCreateSessionBootstrapPayloadFromSessionStorage(activityId, sessionId, nowMs)
  createSessionBootstrapPayloads.delete(key)
  clearCreateSessionBootstrapPayloadFromSessionStorage(activityId, sessionId)
  return payload
}

export function buildCreateSessionBootstrapHistoryState(
  rawCreateSessionBootstrap: unknown,
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const createSessionBootstrap = parseCreateSessionBootstrap(rawCreateSessionBootstrap)
  if (!createSessionBootstrap?.historyState || createSessionBootstrap.historyState.length === 0) {
    return null
  }

  const historyStatePayload = createSessionBootstrap.historyState.reduce<Record<string, unknown>>((accumulator, field) => {
    if (Object.hasOwn(payload, field)) {
      const value = payload[field]
      if (value !== undefined) {
        accumulator[field] = value
      }
    }
    return accumulator
  }, {})

  return Object.keys(historyStatePayload).length > 0 ? historyStatePayload : null
}

function pruneCreateSessionBootstrapPayloads(nowMs: number): void {
  for (const [key, entry] of createSessionBootstrapPayloads.entries()) {
    if (nowMs - entry.createdAtMs > CREATE_SESSION_BOOTSTRAP_TTL_MS) {
      createSessionBootstrapPayloads.delete(key)
    }
  }

  while (createSessionBootstrapPayloads.size > MAX_CREATE_SESSION_BOOTSTRAP_PAYLOADS) {
    const oldestKey = createSessionBootstrapPayloads.keys().next().value
    if (typeof oldestKey !== 'string') {
      break
    }

    createSessionBootstrapPayloads.delete(oldestKey)
  }

  pruneCreateSessionBootstrapPayloadsFromSessionStorage(nowMs)
}

export function parseDeepLinkOptions(rawDeepLinkOptions: unknown): DeepLinkOptions {
  if (!isObjectRecord(rawDeepLinkOptions)) {
    return {}
  }

  const parsed: DeepLinkOptions = {}

  for (const [key, rawOption] of Object.entries(rawDeepLinkOptions)) {
    if (!isObjectRecord(rawOption)) {
      continue
    }

    const rawOptions = Array.isArray(rawOption.options) ? rawOption.options : []

    const type = toOptionType(rawOption.type)
    parsed[key] = {
      label: (rawOption.label != null) ? toStringValue(rawOption.label) : undefined,
      type,
      validator: rawOption.validator === 'url' ? 'url' : undefined,
      options: rawOptions
        .filter((option): option is Record<string, unknown> => isObjectRecord(option))
        .map((option) => ({
          value: toStringValue(option.value),
          label: toStringValue(option.label),
        })),
      defaultValue: toDefaultOptionValue(rawOption.defaultValue),
      min: toFiniteNumber(rawOption.min),
      max: toFiniteNumber(rawOption.max),
      step: toFiniteNumber(rawOption.step),
    }
  }

  return parsed
}

export function initializeDeepLinkOptions(rawDeepLinkOptions: unknown): DeepLinkSelection {
  const options = parseDeepLinkOptions(rawDeepLinkOptions)

  return Object.keys(options).reduce<DeepLinkSelection>((selection, key) => {
    selection[key] = normalizeDefaultDeepLinkValue(options[key] ?? {})
    return selection
  }, {})
}

export function normalizeSelectedOptions(
  rawDeepLinkOptions: unknown,
  rawSelectedOptions: Record<string, unknown> | null | undefined,
): DeepLinkSelection {
  const allowedOptions = parseDeepLinkOptions(rawDeepLinkOptions)

  if (!rawSelectedOptions) {
    return {}
  }

  return Object.entries(rawSelectedOptions).reduce<DeepLinkSelection>((selection, [key, value]) => {
    const option = allowedOptions[key]
    if (!option) return selection
    if (value === null || value === undefined || value === '') return selection

    let normalizedValue: string
    if (option.type === 'checkbox') {
      normalizedValue = value === true || value === 'true' ? 'true' : 'false'
    } else if (option.type === 'multiselect') {
      normalizedValue = normalizeMultiselectValue(value, option)
    } else {
      normalizedValue = option.type === 'text' || option.type === 'number' || option.validator === 'url'
        ? toStringValue(value).trim()
        : toStringValue(value)
    }
    if (normalizedValue === '') return selection

    selection[key] = normalizedValue
    return selection
  }, {})
}

export function validateDeepLinkSelection(
  rawDeepLinkOptions: unknown,
  rawSelectedOptions: Record<string, unknown> | null | undefined,
): DeepLinkValidationErrors {
  const options = parseDeepLinkOptions(rawDeepLinkOptions)
  const errors: DeepLinkValidationErrors = {}

  for (const [key, option] of Object.entries(options)) {
    const rawValue = rawSelectedOptions?.[key]
    const value = typeof rawValue === 'string' ? rawValue.trim() : toStringValue(rawValue).trim()

    if (option.type === 'number' && value.length > 0) {
      const numericValue = Number(value)
      if (!Number.isFinite(numericValue)) {
        errors[key] = `${option.label || key} must be a number`
        continue
      }
      if (option.min !== undefined && numericValue < option.min) {
        errors[key] = `${option.label || key} must be at least ${option.min}`
        continue
      }
      if (option.max !== undefined && numericValue > option.max) {
        errors[key] = `${option.label || key} must be at most ${option.max}`
        continue
      }
    }

    if (option.type === 'multiselect' && value.length > 0) {
      const allowedValues = new Set((option.options ?? []).map((entry) => entry.value))
      const invalidValue = value.split(',').map((entry) => entry.trim()).find((entry) => (
        entry.length > 0 && allowedValues.size > 0 && !allowedValues.has(entry)
      ))
      if (invalidValue) {
        errors[key] = `${option.label || key} contains an unsupported option`
        continue
      }
    }

    if (option.validator !== 'url') {
      continue
    }

    if (!value) {
      errors[key] = `${option.label || key} is required`
      continue
    }

    if (!isValidHttpUrl(value)) {
      errors[key] = `${option.label || key} must be a valid http(s) URL`
    }
  }

  return errors
}

export function buildQueryString(options: Record<string, unknown> | null | undefined): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(options || {})) {
    if (value != null && value !== '') {
      params.set(key, toStringValue(value))
    }
  }

  const query = params.toString()
  return query ? `?${query}` : ''
}

export function buildSoloLink(
  origin: string,
  activityId: string,
  selectedOptions: Record<string, unknown> | null | undefined,
): string {
  return `${origin}/solo/${activityId}${buildQueryString(selectedOptions)}`
}

export function buildManageDashboardUtilityUrl(origin: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${origin}${normalizedPath}`
}

export function filterPersistentEntryPolicyOptionsForActivity<T extends PersistentEntryPolicyOptionLike>(
  options: readonly T[],
  activitySupportsSolo: boolean,
): T[] {
  if (activitySupportsSolo) {
    return [...options]
  }

  return options.filter((option) => option.value === 'instructor-required')
}

export function normalizePersistentEntryPolicyForActivity<
  T extends PersistentEntryPolicyOptionLike['value'],
>(
  entryPolicy: T,
  activitySupportsSolo: boolean,
): T | 'instructor-required' {
  if (activitySupportsSolo) {
    return entryPolicy
  }

  return entryPolicy === 'instructor-required' ? entryPolicy : 'instructor-required'
}

export function buildPersistentSessionKey(activityName: string, hash: string): string {
  return `${activityName}:${hash}`
}

export function buildPersistentLinkRequestBody({
  activityId,
  teacherCode,
  selectedOptions,
  entryPolicy,
  hash,
}: BuildPersistentLinkRequestBodyParams): Record<string, unknown> {
  const normalizedTeacherCode = teacherCode.trim()

  if (hash) {
    return {
      activityName: activityId,
      hash,
      teacherCode: normalizedTeacherCode,
      selectedOptions,
      entryPolicy,
    }
  }

  return {
    activityName: activityId,
    teacherCode: normalizedTeacherCode,
    selectedOptions,
    entryPolicy,
  }
}

export function buildPersistentLinkUrl(
  origin: string,
  urlFromServer: string,
  selectedOptions: Record<string, unknown> | null | undefined,
  deepLinkGenerator: DeepLinkGeneratorConfig | null,
): string {
  const absoluteUrl = /^https?:\/\//i.test(urlFromServer) ? urlFromServer : `${origin}${urlFromServer}`

  if (deepLinkGenerator == null || deepLinkGenerator.mode === 'append-query') {
    const mergedUrl = new URL(absoluteUrl, origin || 'http://localhost')
    for (const [key, value] of Object.entries(selectedOptions || {})) {
      if (value != null && value !== '') {
        mergedUrl.searchParams.set(key, toStringValue(value))
      }
    }
    return /^https?:\/\//i.test(urlFromServer)
      ? mergedUrl.toString()
      : `${mergedUrl.pathname}${mergedUrl.search}${mergedUrl.hash}`.startsWith('/')
        ? `${origin}${mergedUrl.pathname}${mergedUrl.search}${mergedUrl.hash}`
        : mergedUrl.toString()
  }

  return absoluteUrl
}

export function describeSelectedOptions(
  rawDeepLinkOptions: unknown,
  rawSelectedOptions: Record<string, unknown> | null | undefined,
): string[] {
  const parsedOptions = parseDeepLinkOptions(rawDeepLinkOptions)
  const selectedOptions = normalizeSelectedOptions(rawDeepLinkOptions, rawSelectedOptions)

  return Object.entries(selectedOptions).map(([key, value]) => {
    const option = parsedOptions[key]
    const displayValue = option?.type === 'checkbox'
      ? value === 'true' ? 'Yes' : 'No'
      : option?.type === 'multiselect'
        ? value.split(',').map((entry) => (
          option.options?.find((candidate) => candidate.value === entry)?.label ?? entry
        )).join(', ')
        : option?.options?.find((candidate) => candidate.value === value)?.label ?? value
    return `${option?.label || key}: ${displayValue}`
  })
}
