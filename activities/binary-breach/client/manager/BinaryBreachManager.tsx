import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import SessionHeader from '@src/components/common/SessionHeader'
import type {
  BinaryBreachChallengeType,
  BinaryBreachSettings,
  BinaryBreachStudentRecord,
} from '../../binaryBreachTypes.js'
import {
  BINARY_BREACH_CHALLENGE_TYPES,
  DEFAULT_BINARY_BREACH_SETTINGS,
} from '../../shared/challengeGenerator.js'

type RosterStudent = Pick<
  BinaryBreachStudentRecord,
  'id' | 'name' | 'connected' | 'joined' | 'lastSeen' | 'progress' | 'challengeIndex'
>

interface StateResponse {
  settings: BinaryBreachSettings
  students: RosterStudent[]
}

const CHALLENGE_LABELS: Record<BinaryBreachChallengeType, string> = {
  'binary-to-decimal': 'Binary → Decimal',
  'decimal-to-binary': 'Decimal → Binary',
  'compare-binary': 'Compare binary',
  'order-binary': 'Order binary',
}

function toggleChallengeType(
  current: BinaryBreachChallengeType[],
  type: BinaryBreachChallengeType,
): BinaryBreachChallengeType[] {
  const next = current.includes(type)
    ? current.filter((entry) => entry !== type)
    : [...current, type]
  return next.length > 0 ? next : [type]
}

export default function BinaryBreachManager() {
  const { sessionId } = useParams()
  const [settings, setSettings] = useState<BinaryBreachSettings>(() => ({ ...DEFAULT_BINARY_BREACH_SETTINGS }))
  const [students, setStudents] = useState<RosterStudent[]>([])
  const [saving, setSaving] = useState(false)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadState = useCallback(async () => {
    if (!sessionId) return
    try {
      const response = await fetch(`/api/binary-breach/${sessionId}/state`)
      if (!response.ok) throw new Error('Failed to load Binary Breach state')
      const payload = await response.json() as StateResponse
      if (!settingsDirty) setSettings(payload.settings)
      setStudents(payload.students)
      setError(null)
    } catch (err) {
      console.error('Failed to load Binary Breach manager state:', err)
      setError('Unable to load mission state.')
    }
  }, [sessionId, settingsDirty])

  useEffect(() => {
    void loadState()
    const interval = window.setInterval(() => {
      void loadState()
    }, 2500)
    return () => window.clearInterval(interval)
  }, [loadState])

  useEffect(() => {
    if (!sessionId) return undefined
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${wsProtocol}//${window.location.host}/ws/binary-breach?sessionId=${encodeURIComponent(sessionId)}`)
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; payload?: StateResponse }
        if (message.type === 'binary-breach:roster' && message.payload) {
          if (!settingsDirty) setSettings(message.payload.settings)
          setStudents(message.payload.students)
        }
      } catch (err) {
        console.error('Failed to parse Binary Breach websocket message:', err)
      }
    }
    return () => socket.close()
  }, [sessionId, settingsDirty])

  const classAccuracy = useMemo(() => {
    const attempts = students.reduce((total, student) => total + student.progress.attempts, 0)
    const correct = students.reduce((total, student) => total + student.progress.correct, 0)
    return attempts === 0 ? 100 : Math.round((correct / attempts) * 100)
  }, [students])

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault()
    if (!sessionId) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/binary-breach/${sessionId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!response.ok) throw new Error('Failed to save settings')
      const payload = await response.json() as { settings: BinaryBreachSettings }
      setSettings(payload.settings)
      setSettingsDirty(false)
      await loadState()
    } catch (err) {
      console.error('Failed to save Binary Breach settings:', err)
      setError('Unable to save mission settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="binary-breach-shell">
      <SessionHeader activityName="Binary Breach: System Override" sessionId={sessionId} />
      <main className="bb-page">
        {error && (
          <div className="bb-feedback bb-feedback--error" role="alert">{error}</div>
        )}

        <section className="bb-stats" style={{ marginBottom: '20px' }} aria-label="Class mission summary">
          <div className="bb-stat bb-stat--accent">
            <div className="bb-stat-label">TECHNICIANS</div>
            <div className="bb-stat-value">{students.length}</div>
          </div>
          <div className="bb-stat bb-stat--success">
            <div className="bb-stat-label">CONNECTED</div>
            <div className="bb-stat-value">{students.filter((s) => s.connected).length}</div>
          </div>
          <div className="bb-stat">
            <div className="bb-stat-label">CLASS ACCURACY</div>
            <div className="bb-stat-value">{classAccuracy}%</div>
          </div>
          <div className="bb-stat">
            <div className="bb-stat-label">SYSTEMS RESTORED</div>
            <div className="bb-stat-value">
              {students.reduce((total, s) => total + s.progress.systemsRestored, 0)}
            </div>
          </div>
        </section>

        <div className="bb-manager-grid">
          <form className="bb-panel" onSubmit={saveSettings}>
            <h2 className="bb-panel-title">MISSION SETTINGS</h2>

            <div className="bb-form-field">
              <label className="bb-form-label" htmlFor="bb-max-bits">MAXIMUM BITS</label>
              <select
                id="bb-max-bits"
                className="bb-select"
                value={settings.maxBits}
                onChange={(event) => {
                  setSettingsDirty(true)
                  setSettings((current) => ({
                    ...current,
                    maxBits: Number(event.target.value) as BinaryBreachSettings['maxBits'],
                  }))
                }}
              >
                {[4, 5, 6, 7, 8].map((bits) => (
                  <option key={bits} value={bits}>{bits} bits</option>
                ))}
              </select>
            </div>

            <div className="bb-form-field">
              <label className="bb-form-label" htmlFor="bb-mission-length">SYSTEMS PER MISSION</label>
              <input
                id="bb-mission-length"
                className="bb-input-sm"
                type="number"
                min="3"
                max="12"
                value={settings.missionLength}
                onChange={(event) => {
                  setSettingsDirty(true)
                  setSettings((current) => ({
                    ...current,
                    missionLength: Number(event.target.value),
                  }))
                }}
              />
            </div>

            <fieldset className="bb-form-field" style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend className="bb-form-label">CHALLENGE TYPES</legend>
              {BINARY_BREACH_CHALLENGE_TYPES.map((type) => (
                <label className="bb-checkbox-row" key={type}>
                  <input
                    type="checkbox"
                    checked={settings.challengeTypes.includes(type)}
                    onChange={() => {
                      setSettingsDirty(true)
                      setSettings((current) => ({
                        ...current,
                        challengeTypes: toggleChallengeType(current.challengeTypes, type),
                      }))
                    }}
                  />
                  <span>{CHALLENGE_LABELS[type]}</span>
                </label>
              ))}
            </fieldset>

            <label className="bb-checkbox-row bb-form-field">
              <input
                type="checkbox"
                checked={settings.hintsEnabled}
                onChange={(event) => {
                  setSettingsDirty(true)
                  setSettings((current) => ({
                    ...current,
                    hintsEnabled: event.target.checked,
                  }))
                }}
              />
              <span>Hints available</span>
            </label>

            <div className="bb-form-field">
              <label className="bb-form-label" htmlFor="bb-place-value">PLACE-VALUE SUPPORT</label>
              <select
                id="bb-place-value"
                className="bb-select"
                value={settings.placeValueSupport}
                onChange={(event) => {
                  setSettingsDirty(true)
                  setSettings((current) => ({
                    ...current,
                    placeValueSupport: event.target.value as BinaryBreachSettings['placeValueSupport'],
                  }))
                }}
              >
                <option value="visible">Visible</option>
                <option value="optional">Optional</option>
                <option value="hidden">Hidden</option>
              </select>
            </div>

            <button className="bb-btn bb-btn--primary" type="submit" disabled={saving}>
              {saving ? 'SAVING...' : 'SAVE SETTINGS'}
            </button>
          </form>

          <section className="bb-panel">
            <h2 className="bb-panel-title">LIVE MISSION ROSTER</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="bb-roster-table">
                <thead>
                  <tr>
                    <th scope="col">TECHNICIAN</th>
                    <th scope="col">SYS</th>
                    <th scope="col">ACC</th>
                    <th scope="col">STREAK</th>
                    <th scope="col">HINTS</th>
                    <th scope="col">TRACE</th>
                    <th scope="col">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {students.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ color: 'var(--bb-text-dim)', fontStyle: 'italic' }}>
                        Waiting for technicians to join...
                      </td>
                    </tr>
                  )}
                  {students.map((student) => {
                    const acc = student.progress.attempts === 0
                      ? 100
                      : Math.round((student.progress.correct / student.progress.attempts) * 100)
                    return (
                      <tr key={student.id}>
                        <td>{student.name}</td>
                        <td style={{ color: 'var(--bb-accent)' }}>{student.progress.systemsRestored}</td>
                        <td>{acc}%</td>
                        <td>{student.progress.streak}</td>
                        <td>{student.progress.hintsUsed}</td>
                        <td style={{ color: student.progress.traceLevel >= 3 ? 'var(--bb-danger)' : undefined }}>
                          {student.progress.traceLevel}
                        </td>
                        <td>
                          <span
                            className={`bb-status-dot ${student.connected ? 'bb-status-dot--online' : ''}`}
                            aria-hidden="true"
                          />
                          {student.connected ? 'Online' : 'Offline'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
