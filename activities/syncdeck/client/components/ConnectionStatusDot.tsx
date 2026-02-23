import type { FC } from 'react'

interface ConnectionStatusDotProps {
  state: 'connected' | 'disconnected'
  tooltip: string
  className?: string
}

const ConnectionStatusDot: FC<ConnectionStatusDotProps> = ({ state, tooltip, className }) => {
  const colorClass = state === 'connected' ? 'bg-green-500' : 'bg-red-500'

  return (
    <span
      className={`inline-block h-3 w-3 rounded-full ${colorClass}${className ? ` ${className}` : ''}`}
      title={tooltip}
      aria-label={tooltip}
    />
  )
}

export default ConnectionStatusDot
