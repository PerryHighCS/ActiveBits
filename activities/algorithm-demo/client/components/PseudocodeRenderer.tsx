import type { ReactNode } from 'react'
import './PseudocodeRenderer.css'
import { renderPseudocodeWithBold } from '../utils/pseudocodeUtils.js'

type HighlightSource = Set<string> | string[]

interface OverlayObject {
  value?: unknown
  [key: string]: unknown
}

type OverlayValue = OverlayObject | string | number | boolean | null

interface PseudocodeRendererProps {
  lines: string[]
  highlightedLines?: HighlightSource
  highlightedIds?: HighlightSource
  overlays?: Record<string, OverlayValue>
  className?: string
}

function normalizeHighlights(ids: HighlightSource | undefined): Set<string> {
  if (!ids) {
    return new Set()
  }
  if (Array.isArray(ids)) {
    return new Set(ids)
  }
  if (typeof ids.has === 'function') {
    return ids
  }
  return new Set()
}

export default function PseudocodeRenderer({
  lines,
  highlightedLines,
  highlightedIds,
  overlays = {},
  className = '',
}: PseudocodeRendererProps) {
  const highlightSet = normalizeHighlights(highlightedLines ?? highlightedIds)

  return (
    <pre className={`pseudocode-renderer ${className}`}>
      {lines.map((line, idx) => {
        const overlayEntry = overlays[`line-${idx}`]
        return (
          <span key={idx} className="pseudocode-line">
            <span
              id={`line-${idx}`}
              className={`pseudocode-span ${highlightSet.has(`line-${idx}`) ? 'highlighted' : ''} ${overlayEntry != null ? 'has-overlay' : ''}`}
            >
              {renderPseudocodeWithBold(line)}
              {overlayEntry != null && renderOverlay(overlayEntry)}
            </span>
          </span>
        )
      })}
    </pre>
  )
}

function renderOverlay(overlay: OverlayValue): ReactNode {
  if (overlay != null && typeof overlay === 'object') {
    const val = overlay.value !== undefined ? overlay.value : null
    if (val !== null) {
      return (
        <span className="overlay-inline">
          <span className="overlay-value">{String(val)}</span>
        </span>
      )
    }
    // Fallback for unexpected object shapes
    return null
  }
  return <span className="overlay-badge">{String(overlay)}</span>
}
