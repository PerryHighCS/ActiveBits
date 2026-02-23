import React from 'react'
import './ProgressBar.css'

interface ProgressBarProps {
  value?: number
  max?: number
  label?: string
}

export default function ProgressBar({ value = 0, max = 0, label = '' }: ProgressBarProps): React.ReactElement {
  const safeMax = max > 0 ? max : 1
  const percent = Math.min(100, Math.max(0, (value / safeMax) * 100))

  return (
    <div className="progress-bar">
      {label ? <div className="progress-bar-label">{label}</div> : null}
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
