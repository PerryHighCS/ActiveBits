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
let iframeReadyBridgeInstalled = false

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
  if (iframeReadyBridgeInstalled) {
    return
  }

  iframeReadyBridgeInstalled = true
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

function removeScriptTag(): void {
  document.getElementById(YOUTUBE_IFRAME_API_SCRIPT_ID)?.remove()
}

function ensureScriptTag(onError: () => void): void {
  const existing = document.getElementById(YOUTUBE_IFRAME_API_SCRIPT_ID)
  if (existing instanceof HTMLScriptElement) {
    existing.onerror = onError
    return
  }

  const script = document.createElement('script')
  script.id = YOUTUBE_IFRAME_API_SCRIPT_ID
  script.src = YOUTUBE_IFRAME_API_SRC
  script.async = true
  script.onerror = onError
  document.head.appendChild(script)
}

function resetApiLoadState(): void {
  apiLoadPromise = null
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
    let settled = false

    const callbacks = ensureReadyCallbackQueue()
    let finalizeRef: (() => void) | null = null

    const finishReject = (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(timeoutId)
      resetApiLoadState()
      removeScriptTag()
      if (finalizeRef) {
        const index = callbacks.indexOf(finalizeRef)
        if (index >= 0) {
          callbacks.splice(index, 1)
        }
      }
      reject(error)
    }

    const timeoutId = window.setTimeout(() => {
      finishReject(new Error('YouTube IFrame API did not initialize within timeout'))
    }, 10_000)

    const finalize = () => {
      if (settled) {
        return
      }
      const namespace = resolveYoutubeNamespace()
      if (!namespace) {
        return
      }

      settled = true
      window.clearTimeout(timeoutId)
      resolve(namespace)
    }
    finalizeRef = finalize

    callbacks.push(finalize)
    installIframeReadyBridge()
    ensureScriptTag(() => {
      finishReject(new Error('YouTube IFrame API script failed to load'))
    })
    finalize()
  })

  return apiLoadPromise
}

export function resetYoutubeIframeApiForTests(): void {
  resetApiLoadState()
  iframeReadyBridgeInstalled = false
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
