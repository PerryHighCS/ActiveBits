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

  const parsePreflight = (): DeepLinkPreflightConfig | null => {
    const legacyRequiresPreflight = rawDeepLinkGenerator.requiresPreflight === true
    const rawPreflight = rawDeepLinkGenerator.preflight
    if (!isObjectRecord(rawPreflight)) {
      return legacyRequiresPreflight
        ? {
            type: 'reveal-sync-ping',
            optionKey: 'presentationUrl',
            timeoutMs: 4000,
          }
        : null
    }

    const type = rawPreflight.type === 'reveal-sync-ping' ? 'reveal-sync-ping' : null
    const optionKey = typeof rawPreflight.optionKey === 'string' ? rawPreflight.optionKey.trim() : ''
    if (!type || !optionKey) {
      return legacyRequiresPreflight
        ? {
            type: 'reveal-sync-ping',
            optionKey: 'presentationUrl',
            timeoutMs: 4000,
          }
        : null
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
    requiresPreflight: preflight !== null,
    preflight,
  }
}

function parseEnvelope(data: unknown): { type?: unknown; action?: unknown } | null {
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as unknown
      return parsed != null && typeof parsed === 'object' ? (parsed as { type?: unknown; action?: unknown }) : null
    } catch {
      return null
    }
  }

  return data != null && typeof data === 'object' ? (data as { type?: unknown; action?: unknown }) : null
}

async function runRevealSyncPingPreflight(url: string, timeoutMs: number): Promise<DeepLinkPreflightResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { valid: false, warning: 'Presentation validation is unavailable in this environment.' }
  }

  let targetOrigin: string
  try {
    targetOrigin = new URL(url).origin
  } catch {
    return { valid: false, warning: 'Presentation URL must be a valid http(s) URL' }
  }

  return await new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.src = url
    iframe.setAttribute('aria-hidden', 'true')
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms')
    iframe.style.position = 'fixed'
    iframe.style.width = '1024px'
    iframe.style.height = '576px'
    iframe.style.left = '-99999px'
    iframe.style.top = '0'
    iframe.style.opacity = '0'
    iframe.style.pointerEvents = 'none'
    iframe.style.border = '0'

    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      window.removeEventListener('message', handleMessage)
      iframe.removeEventListener('load', handleLoad)
      iframe.removeEventListener('error', handleError)
      if (timeoutId != null) {
        clearTimeout(timeoutId)
      }
      iframe.remove()
    }

    const finalize = (result: DeepLinkPreflightResult) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(result)
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== targetOrigin || event.source !== iframe.contentWindow) {
        return
      }

      const envelope = parseEnvelope(event.data)
      if (!envelope || envelope.type !== 'reveal-sync') {
        return
      }

      if (envelope.action === 'pong') {
        finalize({ valid: true, warning: null })
      }
    }

    const handleLoad = () => {
      try {
        iframe.contentWindow?.postMessage(
          {
            type: 'reveal-sync',
            version: '1.0.0',
            action: 'command',
            source: 'activebits-syncdeck-host',
            role: 'instructor',
            ts: Date.now(),
            payload: {
              name: 'ping',
              payload: {},
            },
          },
          targetOrigin,
        )
      } catch {
        finalize({
          valid: false,
          warning: 'Presentation loaded, but sync ping could not be sent. You can continue anyway.',
        })
      }
    }

    const handleError = () => {
      finalize({
        valid: false,
        warning: 'Presentation failed to load for validation. You can continue anyway.',
      })
    }

    timeoutId = setTimeout(() => {
      finalize({
        valid: false,
        warning: 'Presentation did not respond to sync ping in time. You can continue anyway.',
      })
    }, timeoutMs)

    window.addEventListener('message', handleMessage)
    iframe.addEventListener('load', handleLoad)
    iframe.addEventListener('error', handleError)
    document.body.appendChild(iframe)
  })
}

export async function runDeepLinkPreflight(
  preflight: DeepLinkPreflightConfig,
  rawValue: string,
): Promise<DeepLinkPreflightResult> {
  const value = rawValue.trim()
  if (!value) {
    return { valid: false, warning: 'Validation target is missing.' }
  }

  if (preflight.type === 'reveal-sync-ping') {
    return runRevealSyncPingPreflight(value, preflight.timeoutMs)
  }

  return { valid: false, warning: 'Unsupported validation strategy.' }
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
