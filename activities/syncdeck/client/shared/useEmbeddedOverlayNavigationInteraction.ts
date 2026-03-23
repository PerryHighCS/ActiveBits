import { useCallback, useEffect, useRef, type RefObject } from 'react'
import {
  EMBEDDED_OVERLAY_NAVIGATION_CLICK_SHIELD_DURATION_MS,
  EMBEDDED_OVERLAY_NAVIGATION_POINTER_DOWN_RESET_TIMEOUT_MS,
  reduceEmbeddedOverlayNavigationPointerDownState,
} from './embeddedOverlayNavigation.js'

interface EmbeddedOverlayNavigationInteraction {
  overlayNavClickShieldRef: RefObject<HTMLDivElement | null>
  activateOverlayNavClickShield(): void
  beginOverlayNavPointerDownHandling(): void
  consumeOverlayNavClick(): boolean
  resetOverlayNavPointerDownHandling(): void
}

export function useEmbeddedOverlayNavigationInteraction(): EmbeddedOverlayNavigationInteraction {
  const overlayNavClickShieldRef = useRef<HTMLDivElement | null>(null)
  const overlayNavClickShieldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const overlayNavPointerDownResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didHandleOverlayNavPointerDownRef = useRef(false)

  const clearOverlayNavClickShieldTimeout = useCallback((): void => {
    if (overlayNavClickShieldTimeoutRef.current != null) {
      clearTimeout(overlayNavClickShieldTimeoutRef.current)
      overlayNavClickShieldTimeoutRef.current = null
    }
  }, [])

  const clearOverlayNavPointerDownResetTimeout = useCallback((): void => {
    if (overlayNavPointerDownResetTimeoutRef.current != null) {
      clearTimeout(overlayNavPointerDownResetTimeoutRef.current)
      overlayNavPointerDownResetTimeoutRef.current = null
    }
  }, [])

  const resetOverlayNavPointerDownHandling = useCallback((): void => {
    didHandleOverlayNavPointerDownRef.current = reduceEmbeddedOverlayNavigationPointerDownState(
      didHandleOverlayNavPointerDownRef.current,
      'pointercancel',
    ).didHandlePointerDown
    clearOverlayNavPointerDownResetTimeout()
  }, [clearOverlayNavPointerDownResetTimeout])

  const scheduleOverlayNavPointerDownReset = useCallback((): void => {
    clearOverlayNavPointerDownResetTimeout()
    overlayNavPointerDownResetTimeoutRef.current = setTimeout(() => {
      overlayNavPointerDownResetTimeoutRef.current = null
      didHandleOverlayNavPointerDownRef.current = reduceEmbeddedOverlayNavigationPointerDownState(
        didHandleOverlayNavPointerDownRef.current,
        'timeout',
      ).didHandlePointerDown
    }, EMBEDDED_OVERLAY_NAVIGATION_POINTER_DOWN_RESET_TIMEOUT_MS)
  }, [clearOverlayNavPointerDownResetTimeout])

  const activateOverlayNavClickShield = useCallback((): void => {
    if (overlayNavClickShieldRef.current) {
      overlayNavClickShieldRef.current.style.pointerEvents = 'auto'
    }
    clearOverlayNavClickShieldTimeout()
    overlayNavClickShieldTimeoutRef.current = setTimeout(() => {
      overlayNavClickShieldTimeoutRef.current = null
      if (overlayNavClickShieldRef.current) {
        overlayNavClickShieldRef.current.style.pointerEvents = 'none'
      }
    }, EMBEDDED_OVERLAY_NAVIGATION_CLICK_SHIELD_DURATION_MS)
  }, [clearOverlayNavClickShieldTimeout])

  const beginOverlayNavPointerDownHandling = useCallback((): void => {
    didHandleOverlayNavPointerDownRef.current = reduceEmbeddedOverlayNavigationPointerDownState(
      didHandleOverlayNavPointerDownRef.current,
      'pointerdown',
    ).didHandlePointerDown
    scheduleOverlayNavPointerDownReset()
  }, [scheduleOverlayNavPointerDownReset])

  const consumeOverlayNavClick = useCallback((): boolean => {
    const pointerDownState = reduceEmbeddedOverlayNavigationPointerDownState(
      didHandleOverlayNavPointerDownRef.current,
      'click',
    )
    didHandleOverlayNavPointerDownRef.current = pointerDownState.didHandlePointerDown
    clearOverlayNavPointerDownResetTimeout()
    return pointerDownState.shouldSkipClickNavigation
  }, [clearOverlayNavPointerDownResetTimeout])

  useEffect(() => {
    return () => {
      clearOverlayNavClickShieldTimeout()
      clearOverlayNavPointerDownResetTimeout()
    }
  }, [clearOverlayNavClickShieldTimeout, clearOverlayNavPointerDownResetTimeout])

  return {
    overlayNavClickShieldRef,
    activateOverlayNavClickShield,
    beginOverlayNavPointerDownHandling,
    consumeOverlayNavClick,
    resetOverlayNavPointerDownHandling,
  }
}
