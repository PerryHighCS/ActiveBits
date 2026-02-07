import type { ReactNode } from 'react'

export interface LoadingFallbackProps {
  message?: ReactNode
}

/**
 * Shared loading fallback for lazy-loaded components.
 * Used as Suspense fallback across the application.
 */
export default function LoadingFallback({ message = 'Loading activity...' }: LoadingFallbackProps) {
  return <div className="text-center">{message}</div>
}
