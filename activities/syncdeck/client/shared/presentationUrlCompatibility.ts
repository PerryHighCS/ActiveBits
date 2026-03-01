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

function parseValidatedPresentationUrl(
  value: string,
  hostProtocol?: string | null,
): { parsedUrl: URL | null; validationError: string | null } {
  const normalizedValue = value.trim()
  if (normalizedValue.length === 0) {
    return {
      parsedUrl: null,
      validationError: null,
    }
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(normalizedValue)
  } catch {
    return {
      parsedUrl: null,
      validationError: 'Presentation URL must be a valid http(s) URL',
    }
  }

  if ((parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') || parsedUrl.hostname.length === 0) {
    return {
      parsedUrl: null,
      validationError: 'Presentation URL must be a valid http(s) URL',
    }
  }

  if (hostProtocol === 'https:' && parsedUrl.protocol !== 'https:' && !isLoopbackHostname(parsedUrl.hostname)) {
    return {
      parsedUrl: null,
      validationError: MIXED_CONTENT_PRESENTATION_ERROR,
    }
  }

  return {
    parsedUrl,
    validationError: null,
  }
}

export function getPresentationUrlValidationError(
  value: string,
  hostProtocol?: string | null,
): string | null {
  return parseValidatedPresentationUrl(value, hostProtocol).validationError
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
  const { parsedUrl, validationError } = parseValidatedPresentationUrl(params.value, params.hostProtocol)
  if (validationError != null) {
    return validationError
  }

  if (parsedUrl == null) {
    return null
  }

  const userAgent = typeof params.userAgent === 'string' ? params.userAgent : ''
  if (
    params.hostProtocol === 'https:' &&
    parsedUrl.protocol === 'http:' &&
    isLoopbackHostname(parsedUrl.hostname) &&
    isLikelySafari(userAgent)
  ) {
    return SAFARI_LOOPBACK_PRESENTATION_ERROR
  }

  return null
}
