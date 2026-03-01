const YOUTUBE_IFRAME_API_SRC = 'https://www.youtube.com/iframe_api'
const YOUTUBE_IFRAME_API_SCRIPT_ID = 'video-sync-youtube-iframe-api'

export interface YoutubePlayerVars {
  autoplay?: 0 | 1
  controls?: 0 | 1
  rel?: 0 | 1
  modestbranding?: 0 | 1
  start?: number
  end?: number
  origin?: string
}

export interface YoutubePlayerLike {
  loadVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }): void
  cueVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }): void
  playVideo(): void
  pauseVideo(): void
  mute(): void
  unMute(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getPlayerState(): number
  destroy(): void
}

export interface YoutubePlayerOptions {
  width?: string | number
  height?: string | number
  videoId?: string
  host?: string
  playerVars?: YoutubePlayerVars
  events?: {
    onReady?: (event: { target: YoutubePlayerLike }) => void
    onStateChange?: (event: { data: number; target: YoutubePlayerLike }) => void
    onError?: (event: { data: number; target: YoutubePlayerLike }) => void
  }
}

export interface YoutubeNamespace {
  Player: new (element: HTMLElement | string, options: YoutubePlayerOptions) => YoutubePlayerLike
  PlayerState?: {
    UNSTARTED: number
    ENDED: number
    PLAYING: number
    PAUSED: number
    BUFFERING: number
    CUED: number
  }
}

declare global {
  interface Window {
    YT?: YoutubeNamespace
    onYouTubeIframeAPIReady?: () => void
    __videoSyncYouTubeReadyCallbacks?: Array<() => void>
  }
}

let apiLoadPromise: Promise<YoutubeNamespace> | null = null

function resolveYoutubeNamespace(): YoutubeNamespace | null {
  return window.YT?.Player ? window.YT : null
}

function ensureReadyCallbackQueue(): Array<() => void> {
  if (!window.__videoSyncYouTubeReadyCallbacks) {
    window.__videoSyncYouTubeReadyCallbacks = []
  }

  return window.__videoSyncYouTubeReadyCallbacks
}

function installIframeReadyBridge(): void {
  const previous = window.onYouTubeIframeAPIReady
  window.onYouTubeIframeAPIReady = () => {
    if (typeof previous === 'function') {
      previous()
    }

    const callbacks = ensureReadyCallbackQueue()
    while (callbacks.length > 0) {
      const callback = callbacks.shift()
      callback?.()
    }
  }
}

function ensureScriptTag(): void {
  if (document.getElementById(YOUTUBE_IFRAME_API_SCRIPT_ID)) {
    return
  }

  const script = document.createElement('script')
  script.id = YOUTUBE_IFRAME_API_SCRIPT_ID
  script.src = YOUTUBE_IFRAME_API_SRC
  script.async = true
  document.head.appendChild(script)
}

export async function loadYoutubeIframeApi(): Promise<YoutubeNamespace> {
  const existing = resolveYoutubeNamespace()
  if (existing) {
    return existing
  }

  if (apiLoadPromise) {
    return apiLoadPromise
  }

  apiLoadPromise = new Promise<YoutubeNamespace>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('YouTube IFrame API did not initialize within timeout'))
    }, 10_000)

    const finalize = () => {
      const namespace = resolveYoutubeNamespace()
      if (!namespace) {
        return
      }

      window.clearTimeout(timeoutId)
      resolve(namespace)
    }

    ensureReadyCallbackQueue().push(finalize)
    installIframeReadyBridge()
    ensureScriptTag()
    finalize()
  })

  return apiLoadPromise
}

export function resolveYoutubePlayerState(namespace: YoutubeNamespace | null): {
  PLAYING: number
  PAUSED: number
} {
  return {
    PLAYING: namespace?.PlayerState?.PLAYING ?? 1,
    PAUSED: namespace?.PlayerState?.PAUSED ?? 2,
  }
}
