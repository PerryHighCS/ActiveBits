export type VideoSyncPlayerHost = 'youtube-nocookie' | 'youtube-education'

export const DEFAULT_VIDEO_SYNC_PLAYER_HOST: VideoSyncPlayerHost = 'youtube-nocookie'
export const YOUTUBE_NOCOOKIE_PLAYER_HOST_URL = 'https://www.youtube-nocookie.com'
export const YOUTUBE_EDUCATION_PLAYER_HOST_URL = 'https://www.youtubeeducation.com'
export const YOUTUBE_IFRAME_API_SRC = 'https://www.youtube.com/iframe_api'
export const YOUTUBE_EDUCATION_IFRAME_API_SRC = 'https://www.youtubeeducation.com/iframe_api'

export interface VideoSyncPlayerHostCandidate {
  playerHost: VideoSyncPlayerHost
  hostUrl: string
  iframeApiSrc: string
}

export function isVideoSyncPlayerHost(value: unknown): value is VideoSyncPlayerHost {
  return value === 'youtube-nocookie' || value === 'youtube-education'
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

  return 'Not loaded'
}

export function resolveYoutubePlayerHostUrl(playerHost: VideoSyncPlayerHost): string {
  return playerHost === 'youtube-education'
    ? YOUTUBE_EDUCATION_PLAYER_HOST_URL
    : YOUTUBE_NOCOOKIE_PLAYER_HOST_URL
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
  const primaryCandidate = {
    playerHost: primary,
    hostUrl: resolveYoutubePlayerHostUrl(primary),
    iframeApiSrc: resolveYoutubeIframeApiSrc(primary),
  }

  if (primary !== 'youtube-education') {
    return [primaryCandidate]
  }

  return [
    primaryCandidate,
    {
      playerHost: DEFAULT_VIDEO_SYNC_PLAYER_HOST,
      hostUrl: resolveYoutubePlayerHostUrl(DEFAULT_VIDEO_SYNC_PLAYER_HOST),
      iframeApiSrc: resolveYoutubeIframeApiSrc(DEFAULT_VIDEO_SYNC_PLAYER_HOST),
    },
  ]
}
