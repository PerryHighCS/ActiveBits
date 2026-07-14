export type VideoSyncPlayerHost = 'youtube-nocookie' | 'youtube-education' | 'youtube'

export const DEFAULT_VIDEO_SYNC_PLAYER_HOST: VideoSyncPlayerHost = 'youtube-nocookie'
export const YOUTUBE_NOCOOKIE_PLAYER_HOST_URL = 'https://www.youtube-nocookie.com'
export const YOUTUBE_EDUCATION_PLAYER_HOST_URL = 'https://www.youtubeeducation.com'
export const YOUTUBE_STANDARD_PLAYER_HOST_URL = 'https://www.youtube.com'
export const YOUTUBE_IFRAME_API_SRC = 'https://www.youtube.com/iframe_api'
export const YOUTUBE_EDUCATION_IFRAME_API_SRC = 'https://www.youtubeeducation.com/iframe_api'

// A video that youtube-nocookie.com can't play without a signed-in/cookied
// session (e.g. age- or region-restricted) surfaces as a YouTube-side
// "configuration error" (commonly numbered 153) with no further recourse on
// that domain. Falling back to the standard youtube.com host lets those
// videos play instead of leaving instructors stuck on a dead embed.
const PLAYER_HOST_FALLBACK_CHAIN: Record<VideoSyncPlayerHost, VideoSyncPlayerHost[]> = {
  'youtube-education': ['youtube-education', 'youtube-nocookie', 'youtube'],
  'youtube-nocookie': ['youtube-nocookie', 'youtube'],
  youtube: ['youtube'],
}

export interface VideoSyncPlayerHostCandidate {
  playerHost: VideoSyncPlayerHost
  hostUrl: string
  iframeApiSrc: string
}

export function isVideoSyncPlayerHost(value: unknown): value is VideoSyncPlayerHost {
  return value === 'youtube-nocookie' || value === 'youtube-education' || value === 'youtube'
}

export function normalizeVideoSyncPlayerHost(value: unknown): VideoSyncPlayerHost {
  return isVideoSyncPlayerHost(value) ? value : DEFAULT_VIDEO_SYNC_PLAYER_HOST
}

export function formatVideoSyncPlayerHostLabel(playerHost: VideoSyncPlayerHost | null): string {
  if (playerHost === 'youtube-education') {
    return 'YouTube Education'
  }

  if (playerHost === 'youtube-nocookie') {
    return 'YouTube no-cookie'
  }

  if (playerHost === 'youtube') {
    return 'YouTube'
  }

  return 'Not loaded'
}

export function resolveYoutubePlayerHostUrl(playerHost: VideoSyncPlayerHost): string {
  if (playerHost === 'youtube-education') {
    return YOUTUBE_EDUCATION_PLAYER_HOST_URL
  }

  if (playerHost === 'youtube') {
    return YOUTUBE_STANDARD_PLAYER_HOST_URL
  }

  return YOUTUBE_NOCOOKIE_PLAYER_HOST_URL
}

export function resolveYoutubeIframeApiSrc(playerHost: VideoSyncPlayerHost): string {
  return playerHost === 'youtube-education'
    ? YOUTUBE_EDUCATION_IFRAME_API_SRC
    : YOUTUBE_IFRAME_API_SRC
}

export function resolveYoutubePlayerHostCandidates(
  playerHost: VideoSyncPlayerHost,
): VideoSyncPlayerHostCandidate[] {
  const primary = normalizeVideoSyncPlayerHost(playerHost)
  const chain = PLAYER_HOST_FALLBACK_CHAIN[primary]

  return chain.map((host) => ({
    playerHost: host,
    hostUrl: resolveYoutubePlayerHostUrl(host),
    iframeApiSrc: resolveYoutubeIframeApiSrc(host),
  }))
}
