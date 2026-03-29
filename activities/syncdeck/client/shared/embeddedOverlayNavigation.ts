export type EmbeddedOverlayDirection = 'left' | 'right' | 'up' | 'down'
export const EMBEDDED_OVERLAY_NAVIGATION_CLICK_SHIELD_DURATION_MS = 250
export const EMBEDDED_OVERLAY_NAVIGATION_POINTER_DOWN_RESET_TIMEOUT_MS = 500
const PRE_FRAGMENT_INDEX = -1

export interface EmbeddedOverlayIndices {
  h: number
  v: number
  f: number
}

export interface EmbeddedOverlayVerticalNavigationCapabilities {
  canGoUp: boolean
  canGoDown: boolean
}

export function consumeEmbeddedOverlayNavigationEvent(event: {
  preventDefault(): void
  stopPropagation(): void
}): void {
  event.preventDefault()
  event.stopPropagation()
}

export function shouldHandleEmbeddedOverlayNavigationPointerDown(event: {
  button: number
  pointerType?: string
}): boolean {
  if (event.pointerType === 'touch') {
    return event.button === 0 || event.button === -1
  }

  return event.button === 0
}

export function shouldNavigateEmbeddedOverlayOnPointerDown(event: {
  pointerType?: string
}): boolean {
  return event.pointerType !== 'touch'
}

export type EmbeddedOverlayNavigationPointerTransition =
  | 'pointerdown'
  | 'click'
  | 'pointercancel'
  | 'timeout'

export function reduceEmbeddedOverlayNavigationPointerDownState(
  didHandlePointerDown: boolean,
  transition: EmbeddedOverlayNavigationPointerTransition,
): {
  didHandlePointerDown: boolean
  shouldSkipClickNavigation: boolean
} {
  if (transition === 'pointerdown') {
    return {
      didHandlePointerDown: true,
      shouldSkipClickNavigation: false,
    }
  }

  if (transition === 'click') {
    return {
      didHandlePointerDown: false,
      shouldSkipClickNavigation: didHandlePointerDown,
    }
  }

  if (transition === 'pointercancel') {
    return {
      didHandlePointerDown,
      shouldSkipClickNavigation: false,
    }
  }

  return {
    didHandlePointerDown: false,
    shouldSkipClickNavigation: false,
  }
}

export function resolveEmbeddedOverlayVerticalMoveAllowed(params: {
  direction: 'up' | 'down'
  iframeCapability: boolean | null
  derivedCapabilities: EmbeddedOverlayVerticalNavigationCapabilities | null
  fallbackAllowed: boolean
}): boolean {
  if (params.iframeCapability != null) {
    return params.iframeCapability
  }

  if (params.derivedCapabilities) {
    return params.direction === 'up'
      ? params.derivedCapabilities.canGoUp
      : params.derivedCapabilities.canGoDown
  }

  return params.fallbackAllowed
}

interface EmbeddedOverlayAnchor {
  h: number
  v: number
}

function parseEmbeddedOverlayAnchor(instanceKey: string): EmbeddedOverlayAnchor | null {
  const parts = instanceKey.split(':')
  if (parts.length < 3) {
    return null
  }

  const h = Number(parts[1])
  const v = Number(parts[2])
  if (!Number.isInteger(h) || !Number.isInteger(v)) {
    return null
  }

  return { h, v }
}

function compareEmbeddedOverlayAnchor(a: EmbeddedOverlayAnchor, b: EmbeddedOverlayAnchor): number {
  if (a.h !== b.h) {
    return a.h - b.h
  }

  return a.v - b.v
}

function listEmbeddedOverlayAnchors(instanceKeys: readonly string[]): EmbeddedOverlayAnchor[] {
  const unique = new Map<string, EmbeddedOverlayAnchor>()

  for (const instanceKey of instanceKeys) {
    const anchor = parseEmbeddedOverlayAnchor(instanceKey)
    if (!anchor) {
      continue
    }

    unique.set(`${anchor.h}:${anchor.v}`, anchor)
  }

  return [...unique.values()].sort(compareEmbeddedOverlayAnchor)
}

function findHorizontalAnchor(
  anchors: readonly EmbeddedOverlayAnchor[],
  targetH: number,
): EmbeddedOverlayAnchor | null {
  const horizontalAnchors = anchors.filter((anchor) => anchor.h === targetH)
  if (horizontalAnchors.length === 0) {
    return null
  }

  return horizontalAnchors.reduce((selected, current) => {
    if (!selected) {
      return current
    }

    return current.v < selected.v ? current : selected
  }, null as EmbeddedOverlayAnchor | null)
}

export function deriveEmbeddedOverlayVerticalNavigationCapabilities(
  instanceKeys: readonly string[],
  currentIndices: EmbeddedOverlayIndices | null,
): EmbeddedOverlayVerticalNavigationCapabilities | null {
  if (!currentIndices) {
    return null
  }

  const anchors = listEmbeddedOverlayAnchors(instanceKeys)
  const verticalAnchors = anchors.filter((anchor) => anchor.h === currentIndices.h)
  if (verticalAnchors.length === 0) {
    return {
      canGoUp: currentIndices.v > 0,
      canGoDown: false,
    }
  }

  const maxVerticalIndex = verticalAnchors.reduce((maxValue, anchor) => Math.max(maxValue, anchor.v), 0)
  return {
    canGoUp: currentIndices.v > 0,
    canGoDown: currentIndices.v < maxVerticalIndex,
  }
}

export function resolveOptimisticEmbeddedOverlayIndices(
  instanceKeys: readonly string[],
  currentIndices: EmbeddedOverlayIndices | null,
  direction: EmbeddedOverlayDirection,
): EmbeddedOverlayIndices | null {
  if (!currentIndices) {
    return null
  }

  const anchors = listEmbeddedOverlayAnchors(instanceKeys)
  if (direction === 'up') {
    return { h: currentIndices.h, v: Math.max(0, currentIndices.v - 1), f: PRE_FRAGMENT_INDEX }
  }

  if (direction === 'down') {
    const nextVerticalAnchor = anchors.find((anchor) => {
      return anchor.h === currentIndices.h && anchor.v > currentIndices.v
    })

    if (nextVerticalAnchor && nextVerticalAnchor.v === currentIndices.v + 1) {
      return { h: nextVerticalAnchor.h, v: nextVerticalAnchor.v, f: PRE_FRAGMENT_INDEX }
    }

    return { h: currentIndices.h, v: currentIndices.v + 1, f: PRE_FRAGMENT_INDEX }
  }

  if (direction === 'left') {
    const targetH = Math.max(0, currentIndices.h - 1)
    const leftAnchor = findHorizontalAnchor(anchors, targetH)
    if (leftAnchor) {
      return { h: leftAnchor.h, v: leftAnchor.v, f: PRE_FRAGMENT_INDEX }
    }

    return { h: targetH, v: 0, f: PRE_FRAGMENT_INDEX }
  }

  const targetH = currentIndices.h + 1
  const rightAnchor = findHorizontalAnchor(anchors, targetH)
  if (rightAnchor) {
    return { h: rightAnchor.h, v: rightAnchor.v, f: PRE_FRAGMENT_INDEX }
  }

  return { h: targetH, v: 0, f: PRE_FRAGMENT_INDEX }
}
