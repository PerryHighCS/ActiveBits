export type VideoSyncPlayerHost = 'youtube-nocookie' | 'youtube-education'

export const DEFAULT_VIDEO_SYNC_PLAYER_HOST: VideoSyncPlayerHost = 'youtube-nocookie'
export const YOUTUBE_NOCOOKIE_PLAYER_HOST_URL = 'https://www.youtube-nocookie.com'
export const YOUTUBE_EDUCATION_PLAYER_HOST_URL = 'https://www.youtubeeducation.com'
export const YOUTUBE_IFRAME_API_SRC = 'https://www.youtube.com/iframe_api'
export const YOUTUBE_EDUCATION_IFRAME_API_SRC = 'https://www.youtubeeducation.com/iframe_api'

export function isVideoSyncPlayerHost(value: unknown): value is VideoSyncPlayerHost {
  return value === 'youtube-nocookie' || value === 'youtube-education'
}

export function normalizeVideoSyncPlayerHost(value: unknown): VideoSyncPlayerHost {
  return isVideoSyncPlayerHost(value) ? value : DEFAULT_VIDEO_SYNC_PLAYER_HOST
}

export function resolveYoutubePlayerHostUrl(playerHost: VideoSyncPlayerHost): string {
  // YouTube Education URLs are accepted as source aliases, but direct
  // youtubeeducation.com player embeds can reject otherwise-valid videos.
  // Keep playback on the proven no-cookie YouTube host unless this policy is
  // deliberately revisited with working education-host embed evidence.
  void playerHost
  return YOUTUBE_NOCOOKIE_PLAYER_HOST_URL
}

export function resolveYoutubeIframeApiSrc(playerHost: VideoSyncPlayerHost): string {
  void playerHost
  return YOUTUBE_IFRAME_API_SRC
}
