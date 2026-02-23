import React from 'react'
import ProgressBar from './ProgressBar'
import { formatDistance, formatTime } from '../utils/formatters'
import { getProgressLabel } from '../utils/progressHelpers'
import type { ManagerLeaderboardEntry } from '../utils/tspUtilsTypes'
import './Leaderboard.css'

interface LeaderboardProps {
  entries?: ManagerLeaderboardEntry[]
  onHighlight?: (entry: ManagerLeaderboardEntry) => void
  onBroadcast?: (entryId: string) => void
  onToggleBroadcast?: (entry: ManagerLeaderboardEntry) => void
  broadcastIds?: string[]
  onNameClick?: (entry: ManagerLeaderboardEntry) => void
  activeViewId?: string | null
  viewableTypes?: string[] | null
}

/**
 * Leaderboard component - Displays sorted list of all solutions.
 */
export default function Leaderboard({
  entries = [],
  onHighlight,
  onBroadcast,
  onToggleBroadcast,
  broadcastIds = [],
  onNameClick,
  activeViewId = null,
  viewableTypes = null,
}: LeaderboardProps): React.ReactElement {
  if (entries.length === 0) {
    return (
      <div className="leaderboard">
        <h3>Leaderboard</h3>
        <p className="leaderboard-empty">No solutions yet. Generate a map and start building routes!</p>
      </div>
    )
  }

  return (
    <div className="leaderboard">
      <h3>Leaderboard</h3>
      <table className="leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th>Distance</th>
            <th>Time</th>
            <th>Type</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, idx) => (
            <tr key={entry.id} className={`leaderboard-row ${entry.type}`}>
              <td className="rank">{idx + 1}</td>
              <td className="name">
                {onNameClick && (entry.type === 'bruteforce' || entry.type === 'heuristic') ? (
                  <button
                    className="name-button"
                    onClick={() => onNameClick(entry)}
                    title={entry.type === 'bruteforce' ? 'Start or interrupt brute force' : 'Compute heuristic'}
                  >
                    {entry.name}
                  </button>
                ) : (
                  entry.name
                )}
              </td>
              <td className="distance">{entry.distance !== null && entry.distance !== undefined ? formatDistance(entry.distance) : '—'}</td>
              <td className="time">
                {entry.timeToComplete !== null && entry.timeToComplete !== undefined ? (
                  formatTime(entry.timeToComplete)
                ) : entry.progressCurrent !== null &&
                  entry.progressCurrent !== undefined &&
                  entry.progressTotal !== null &&
                  entry.progressTotal !== undefined ? (
                  <ProgressBar
                    value={entry.progressCurrent}
                    max={entry.progressTotal}
                    label={getProgressLabel(entry.progressCurrent, entry.progressTotal)}
                  />
                ) : entry.type === 'student' ? (
                  'In progress'
                ) : (
                  ''
                )}
              </td>
              <td className="type">
                {entry.type === 'bruteforce' ? <span className="badge optimal">🤖 Optimal</span> : null}
                {entry.type === 'heuristic' ? <span className="badge heuristic">🧠 Heuristic</span> : null}
                {entry.type === 'student' ? <span className="badge student">👤 Student</span> : null}
                {entry.type === 'instructor' ? <span className="badge instructor">🧑‍🏫 Instructor</span> : null}
              </td>
              <td className="actions">
                {onHighlight && (!viewableTypes || viewableTypes.includes(entry.type)) ? (
                  <button
                    onClick={() => onHighlight(entry)}
                    className={`btn-view ${activeViewId === entry.id ? 'active' : ''}`}
                    title="Highlight this route on the map"
                  >
                    View
                  </button>
                ) : null}
                {onToggleBroadcast ? (
                  <button
                    onClick={() => onToggleBroadcast(entry)}
                    className={`btn-broadcast ${broadcastIds.includes(entry.id) ? 'active' : ''}`}
                    title="Toggle this route on student screens"
                  >
                    Broadcast
                  </button>
                ) : onBroadcast ? (
                  <button
                    onClick={() => onBroadcast(entry.id)}
                    className="btn-broadcast"
                    title="Show this route on all student screens"
                  >
                    Broadcast
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
