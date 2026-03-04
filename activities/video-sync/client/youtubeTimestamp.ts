function clampSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function parseYouTubeTimestampSeconds(value: string | null): number | null {
  if (value == null || value.trim().length === 0) return null

  const numeric = Number.parseFloat(value)
  if (Number.isFinite(numeric) && /^\s*\d+(?:\.\d+)?\s*$/.test(value)) {
    return clampSeconds(numeric)
  }

  const trimmed = value.trim().toLowerCase()
  const match = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!match) return null

  const hours = match[1] ? Number.parseInt(match[1], 10) : 0
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0
  const seconds = match[3] ? Number.parseInt(match[3], 10) : 0

  return clampSeconds(hours * 3600 + minutes * 60 + seconds)
}

export function parseYouTubeStartSecondsFromUrl(sourceUrl: string): number | null {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(sourceUrl)
  } catch {
    return null
  }

  const host = parsedUrl.hostname.toLowerCase()
  const isYouTubeHost = host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com'
  const isShortHost = host === 'youtu.be' || host === 'www.youtu.be'

  if (!isYouTubeHost && !isShortHost) {
    return null
  }

  const startFromStartParam = parseYouTubeTimestampSeconds(parsedUrl.searchParams.get('start'))
  const startFromTParam = parseYouTubeTimestampSeconds(parsedUrl.searchParams.get('t'))

  return startFromStartParam ?? startFromTParam ?? 0
}
