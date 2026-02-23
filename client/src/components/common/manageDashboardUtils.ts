export interface DeepLinkOptionChoice {
  value: string
  label: string
}

export interface DeepLinkOption {
  label?: string
  type?: 'select' | 'text'
  options?: DeepLinkOptionChoice[]
}

export type DeepLinkOptions = Record<string, DeepLinkOption>
export type DeepLinkSelection = Record<string, string>

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
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
