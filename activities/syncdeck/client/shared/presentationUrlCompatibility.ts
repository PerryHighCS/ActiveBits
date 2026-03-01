export const MIXED_CONTENT_PRESENTATION_ERROR =
  'Presentation URL must use https:// when ActiveBits is running over HTTPS. Browsers block http:// presentation iframes in the student view.'
export const SAFARI_LOOPBACK_PRESENTATION_ERROR =
  'Safari blocks http://localhost and http://127.0.0.1 SyncDeck presentations from an HTTPS ActiveBits page. Use Chrome for localhost testing or serve the presentation over HTTPS.'

export function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase()
  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname === '127.0.0.1' ||
    normalizedHostname === '[::1]' ||
    normalizedHostname === '::1'
  )
}

export function getPresentationUrlValidationError(
  value: string,
  hostProtocol?: string | null,
): string | null {
  const normalizedValue = value.trim()
  if (normalizedValue.length === 0) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(normalizedValue)
  } catch {
    return 'Presentation URL must be a valid http(s) URL'
  }

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.hostname.length === 0) {
    return 'Presentation URL must be a valid http(s) URL'
  }

  if (hostProtocol === 'https:' && parsed.protocol !== 'https:' && !isLoopbackHostname(parsed.hostname)) {
    return MIXED_CONTENT_PRESENTATION_ERROR
  }

  return null
}

function isLikelySafari(userAgent: string): boolean {
  const normalizedUserAgent = userAgent.trim()
  if (!normalizedUserAgent.includes('Safari/')) {
    return false
  }

  return !(
    normalizedUserAgent.includes('Chrome/') ||
    normalizedUserAgent.includes('Chromium/') ||
    normalizedUserAgent.includes('CriOS/') ||
    normalizedUserAgent.includes('Edg/') ||
    normalizedUserAgent.includes('OPR/') ||
    normalizedUserAgent.includes('Firefox/') ||
    normalizedUserAgent.includes('FxiOS/') ||
    normalizedUserAgent.includes('Android')
  )
}

export function getStudentPresentationCompatibilityError(params: {
  value: string
  hostProtocol?: string | null
  userAgent?: string | null
}): string | null {
  const validationError = getPresentationUrlValidationError(params.value, params.hostProtocol)
  if (validationError != null) {
    return validationError
  }

  const normalizedValue = params.value.trim()
  if (normalizedValue.length === 0) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(normalizedValue)
  } catch {
    return 'Presentation URL must be a valid http(s) URL'
  }

  const userAgent = typeof params.userAgent === 'string' ? params.userAgent : ''
  if (
    params.hostProtocol === 'https:' &&
    parsed.protocol === 'http:' &&
    isLoopbackHostname(parsed.hostname) &&
    isLikelySafari(userAgent)
  ) {
    return SAFARI_LOOPBACK_PRESENTATION_ERROR
  }

  return null
}
