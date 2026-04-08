import { resolveEmbeddedOverlayNavigationIconPath, type EmbeddedOverlayDirection } from './embeddedOverlayNavigation.js'

interface EmbeddedOverlayNavigationIconProps {
  direction: EmbeddedOverlayDirection
}

export default function EmbeddedOverlayNavigationIcon({
  direction,
}: EmbeddedOverlayNavigationIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={resolveEmbeddedOverlayNavigationIconPath(direction)} />
    </svg>
  )
}
