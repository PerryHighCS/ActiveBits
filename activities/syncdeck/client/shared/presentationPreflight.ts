export interface SyncDeckPreflightResult {
  valid: boolean
  warning: string | null
}

const PREFLIGHT_PING_TIMEOUT_MS = 4000

export async function runSyncDeckPresentationPreflight(
  url: string,
  options?: { timeoutMs?: number },
): Promise<SyncDeckPreflightResult> {
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
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
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

    const finalize = (result: SyncDeckPreflightResult) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(result)
    }

    const parseEnvelope = (data: unknown): { type?: unknown; action?: unknown } | null => {
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

    const timeoutMs =
      typeof options?.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.floor(options.timeoutMs)
        : PREFLIGHT_PING_TIMEOUT_MS

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
