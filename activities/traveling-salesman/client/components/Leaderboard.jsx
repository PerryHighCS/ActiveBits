import React from 'react';
import ProgressBar from './ProgressBar.jsx';
import './Leaderboard.css';

/**
 * Leaderboard component - Displays sorted list of all solutions
 * @param {Array} entries - Array of leaderboard entries with:
 *   - id: unique identifier
 *   - name: display name
 *   - distance: route distance
 *   - timeToComplete: time in seconds (or null if not complete)
 *   - progressCurrent: current progress value
 *   - progressTotal: total progress value
 *   - type: 'student' | 'bruteforce' | 'heuristic' | 'instructor'
 * @param {function} onHighlight - Callback when "View" button is clicked
 * @param {function} onBroadcast - Callback when "Broadcast" button is clicked
 * @param {function} onToggleBroadcast - Callback when broadcast toggle is clicked
 * @param {Array} broadcastIds - Array of ids currently broadcast
 * @param {function} onNameClick - Callback when name is clicked
 * @param {string|null} activeViewId - Id currently highlighted on map
 * @param {Array|null} viewableTypes - Limit view button to specific entry types
 */
export default function Leaderboard({
  entries = [],
  onHighlight,
  onBroadcast,
  onToggleBroadcast,
  broadcastIds = [],
  onNameClick,
  activeViewId = null,
  viewableTypes = null
}) {
  if (entries.length === 0) {
    return (
      <div className="leaderboard">
        <h3>Leaderboard</h3>
        <p className="leaderboard-empty">No solutions yet. Generate a map and start building routes!</p>
      </div>
    );
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
              <td className="distance">
                {entry.distance !== null && entry.distance !== undefined
                  ? entry.distance.toFixed(1)
                  : '—'}
              </td>
              <td className="time">
                {entry.timeToComplete !== null && entry.timeToComplete !== undefined
                  ? `${entry.timeToComplete}s`
                  : (entry.progressCurrent !== null && entry.progressCurrent !== undefined
                    && entry.progressTotal !== null && entry.progressTotal !== undefined
                    ? (
                      <ProgressBar
                        value={entry.progressCurrent}
                        max={entry.progressTotal}
                        label={`${entry.progressCurrent}/${entry.progressTotal}`}
                      />
                    )
                    : (entry.type === 'student' ? 'In progress' : ''))}
              </td>
              <td className="type">
                {entry.type === 'bruteforce' && <span className="badge optimal">🤖 Optimal</span>}
                {entry.type === 'heuristic' && <span className="badge heuristic">🧠 Heuristic</span>}
                {entry.type === 'student' && <span className="badge student">👤 Student</span>}
                {entry.type === 'instructor' && <span className="badge instructor">🧑‍🏫 Instructor</span>}
              </td>
              <td className="actions">
                {onHighlight && (!viewableTypes || viewableTypes.includes(entry.type)) && (
                  <button
                    onClick={() => onHighlight(entry)}
                    className={`btn-view ${activeViewId === entry.id ? 'active' : ''}`}
                    title="Highlight this route on the map"
                  >
                    View
                  </button>
                )}
                {onToggleBroadcast ? (
                  <button
                    onClick={() => onToggleBroadcast(entry)}
                    className={`btn-broadcast ${broadcastIds.includes(entry.id) ? 'active' : ''}`}
                    title="Toggle this route on student screens"
                  >
                    Broadcast
                  </button>
                ) : (
                  onBroadcast && (
                    <button
                      onClick={() => onBroadcast(entry.id)}
                      className="btn-broadcast"
                      title="Show this route on all student screens"
                    >
                      Broadcast
                    </button>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
