export const MIXED_CONTENT_PRESENTATION_ERROR =
  'Presentation URL must use https:// when ActiveBits is running over HTTPS. Browsers block http:// presentation iframes in the student view.'

function isLoopbackHostname(hostname: string): boolean {
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
