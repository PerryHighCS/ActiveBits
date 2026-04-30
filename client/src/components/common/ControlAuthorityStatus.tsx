import * as React from 'react'

void React

export interface ControlAuthorityStatusProps {
  statusLabel: string
  hasControl: boolean
  canTakeControl: boolean
  onTakeControl: () => void
  hideButtonWhenOwner?: boolean
  className?: string
  buttonClassName?: string
  takeControlLabel?: string
  inControlLabel?: string
}

export default function ControlAuthorityStatus({
  statusLabel,
  hasControl,
  canTakeControl,
  onTakeControl,
  hideButtonWhenOwner = false,
  className = 'flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-2 py-1',
  buttonClassName = 'rounded border border-gray-300 bg-white px-3 py-1 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50',
  takeControlLabel = 'Take Control',
  inControlLabel = 'In Control',
}: ControlAuthorityStatusProps) {
  const shouldShowButton = !hideButtonWhenOwner || !hasControl

  return (
    <div className={className} aria-live="polite">
      <span className="text-xs font-medium text-gray-600">{statusLabel}</span>
      {shouldShowButton ? (
        <button
          type="button"
          className={buttonClassName}
          disabled={hasControl || !canTakeControl}
          onClick={onTakeControl}
          aria-label={hasControl ? 'Instructor control is active in this view' : takeControlLabel}
        >
          {hasControl ? inControlLabel : takeControlLabel}
        </button>
      ) : null}
    </div>
  )
}
