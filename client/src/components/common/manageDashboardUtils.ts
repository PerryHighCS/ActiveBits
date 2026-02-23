export interface DeepLinkOptionChoice {
  value: string
  label: string
}

export interface DeepLinkOption {
  label?: string
  type?: 'select' | 'text'
  options?: DeepLinkOptionChoice[]
  validator?: 'url'
}

export interface DeepLinkGeneratorConfig {
  endpoint: string
  mode: 'replace-url' | 'append-query'
  expectsSelectedOptions: boolean
  requiresPreflight: boolean
}

export type DeepLinkOptions = Record<string, DeepLinkOption>
export type DeepLinkSelection = Record<string, string>
export type DeepLinkValidationErrors = Record<string, string>

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0
  } catch {
    return false
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

  return {
    endpoint,
    mode: rawDeepLinkGenerator.mode === 'append-query' ? 'append-query' : 'replace-url',
    expectsSelectedOptions: rawDeepLinkGenerator.expectsSelectedOptions !== false,
    requiresPreflight: rawDeepLinkGenerator.requiresPreflight === true,
  }
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

    parsed[key] = {
      label: (rawOption.label != null) ? toStringValue(rawOption.label) : undefined,
      type: rawOption.type === 'select' ? 'select' : 'text',
      validator: rawOption.validator === 'url' ? 'url' : undefined,
      options: rawOptions
        .filter((option): option is Record<string, unknown> => isObjectRecord(option))
        .map((option) => ({
          value: toStringValue(option.value),
          label: toStringValue(option.label),
        })),
    }
  }

  return parsed
}

export function initializeDeepLinkOptions(rawDeepLinkOptions: unknown): DeepLinkSelection {
  const options = parseDeepLinkOptions(rawDeepLinkOptions)

  return Object.keys(options).reduce<DeepLinkSelection>((selection, key) => {
    selection[key] = ''
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
    if (!allowedOptions[key]) return selection
    if (value === null || value === undefined || value === '') return selection

    selection[key] = toStringValue(value)
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
    if (option.validator !== 'url') {
      continue
    }

    const rawValue = rawSelectedOptions?.[key]
    const value = typeof rawValue === 'string' ? rawValue.trim() : toStringValue(rawValue).trim()
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

export function buildPersistentSessionKey(activityName: string, hash: string): string {
  return `${activityName}:${hash}`
}

export function buildPersistentLinkUrl(
  origin: string,
  urlFromServer: string,
  selectedOptions: Record<string, unknown> | null | undefined,
  deepLinkGenerator: DeepLinkGeneratorConfig | null,
): string {
  const absoluteUrl = /^https?:\/\//i.test(urlFromServer) ? urlFromServer : `${origin}${urlFromServer}`

  if (deepLinkGenerator == null || deepLinkGenerator.mode === 'append-query') {
    return `${absoluteUrl}${buildQueryString(selectedOptions)}`
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
    const displayValue = option?.options?.find((candidate) => candidate.value === value)?.label ?? value
    return `${option?.label || key}: ${displayValue}`
  })
}
