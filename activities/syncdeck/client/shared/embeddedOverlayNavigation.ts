export type EmbeddedOverlayDirection = 'left' | 'right' | 'up' | 'down'

export interface EmbeddedOverlayIndices {
  h: number
  v: number
  f: number
}

export interface EmbeddedOverlayVerticalNavigationCapabilities {
  canGoUp: boolean
  canGoDown: boolean
}

export function resolveEmbeddedOverlayVerticalMoveAllowed(params: {
  direction: 'up' | 'down'
  iframeCapability: boolean | null
  derivedCapabilities: EmbeddedOverlayVerticalNavigationCapabilities | null
  fallbackAllowed: boolean
}): boolean {
  if (params.derivedCapabilities) {
    return params.direction === 'up'
      ? params.derivedCapabilities.canGoUp
      : params.derivedCapabilities.canGoDown
  }

  return params.iframeCapability === true || params.fallbackAllowed
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
    return { h: currentIndices.h, v: Math.max(0, currentIndices.v - 1), f: 0 }
  }

  if (direction === 'down') {
    const nextVerticalAnchor = anchors.find((anchor) => {
      return anchor.h === currentIndices.h && anchor.v > currentIndices.v
    })

    if (nextVerticalAnchor && nextVerticalAnchor.v === currentIndices.v + 1) {
      return { h: nextVerticalAnchor.h, v: nextVerticalAnchor.v, f: 0 }
    }

    return { h: currentIndices.h, v: currentIndices.v + 1, f: 0 }
  }

  if (direction === 'left') {
    const targetH = Math.max(0, currentIndices.h - 1)
    const leftAnchor = findHorizontalAnchor(anchors, targetH)
    if (leftAnchor) {
      return { h: leftAnchor.h, v: leftAnchor.v, f: 0 }
    }

    return { h: targetH, v: 0, f: 0 }
  }

  const targetH = currentIndices.h + 1
  const rightAnchor = findHorizontalAnchor(anchors, targetH)
  if (rightAnchor) {
    return { h: rightAnchor.h, v: rightAnchor.v, f: 0 }
  }

  return { h: targetH, v: 0, f: 0 }
}
