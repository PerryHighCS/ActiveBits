/**
 * Shared loading fallback for lazy-loaded components.
 * Used as Suspense fallback across the application.
 */
export default function LoadingFallback({ message = "Loading activity..." }) {
  return <div className="text-center">{message}</div>;
}
