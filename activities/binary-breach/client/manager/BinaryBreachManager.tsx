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
  'binary-to-decimal': 'Binary to decimal',
  'decimal-to-binary': 'Decimal to binary',
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
  const [error, setError] = useState<string | null>(null)

  const loadState = useCallback(async () => {
    if (!sessionId) return
    try {
      const response = await fetch(`/api/binary-breach/${sessionId}/state`)
      if (!response.ok) throw new Error('Failed to load Binary Breach state')
      const payload = await response.json() as StateResponse
      setSettings(payload.settings)
      setStudents(payload.students)
      setError(null)
    } catch (err) {
      console.error('Failed to load Binary Breach manager state:', err)
      setError('Unable to load mission state.')
    }
  }, [sessionId])

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
          setSettings(message.payload.settings)
          setStudents(message.payload.students)
        }
      } catch (err) {
        console.error('Failed to parse Binary Breach websocket message:', err)
      }
    }
    return () => socket.close()
  }, [sessionId])

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
      <main className="binary-breach-page">
        {error && <div className="binary-breach-feedback incorrect mb-4" role="alert">{error}</div>}

        <section className="binary-breach-grid mb-5" aria-label="Class mission summary">
          <div className="binary-breach-stat"><span>Technicians</span><strong>{students.length}</strong></div>
          <div className="binary-breach-stat"><span>Connected</span><strong>{students.filter((student) => student.connected).length}</strong></div>
          <div className="binary-breach-stat"><span>Class Accuracy</span><strong>{classAccuracy}%</strong></div>
          <div className="binary-breach-stat"><span>Systems Restored</span><strong>{students.reduce((total, student) => total + student.progress.systemsRestored, 0)}</strong></div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <form className="binary-breach-panel p-5" onSubmit={saveSettings}>
            <h2 className="text-xl font-bold mb-4">Mission Settings</h2>

            <label className="block mb-4">
              <span className="block mb-1 font-semibold">Maximum bits</span>
              <select
                className="binary-breach-select"
                value={settings.maxBits}
                onChange={(event) => setSettings((current) => ({ ...current, maxBits: Number(event.target.value) as BinaryBreachSettings['maxBits'] }))}
              >
                {[4, 5, 6, 7, 8].map((bits) => <option key={bits} value={bits}>{bits} bits</option>)}
              </select>
            </label>

            <label className="block mb-4">
              <span className="block mb-1 font-semibold">Systems per mission</span>
              <input
                className="binary-breach-input"
                type="number"
                min="3"
                max="12"
                value={settings.missionLength}
                onChange={(event) => setSettings((current) => ({ ...current, missionLength: Number(event.target.value) }))}
              />
            </label>

            <fieldset className="mb-4">
              <legend className="font-semibold mb-2">Challenge types</legend>
              <div className="space-y-2">
                {BINARY_BREACH_CHALLENGE_TYPES.map((type) => (
                  <label className="flex items-center gap-2" key={type}>
                    <input
                      type="checkbox"
                      checked={settings.challengeTypes.includes(type)}
                      onChange={() => setSettings((current) => ({
                        ...current,
                        challengeTypes: toggleChallengeType(current.challengeTypes, type),
                      }))}
                    />
                    <span>{CHALLENGE_LABELS[type]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex items-center gap-2 mb-4">
              <input
                type="checkbox"
                checked={settings.hintsEnabled}
                onChange={(event) => setSettings((current) => ({ ...current, hintsEnabled: event.target.checked }))}
              />
              <span>Hints available</span>
            </label>

            <label className="block mb-4">
              <span className="block mb-1 font-semibold">Place-value support</span>
              <select
                className="binary-breach-select"
                value={settings.placeValueSupport}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  placeValueSupport: event.target.value as BinaryBreachSettings['placeValueSupport'],
                }))}
              >
                <option value="visible">Visible</option>
                <option value="optional">Optional</option>
                <option value="hidden">Hidden</option>
              </select>
            </label>

            <button className="binary-breach-button" type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save and Reset Missions'}
            </button>
          </form>

          <section className="binary-breach-panel p-5">
            <h2 className="text-xl font-bold mb-4">Live Mission Roster</h2>
            <div className="overflow-x-auto">
              <table className="binary-breach-table">
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">Restored</th>
                    <th scope="col">Accuracy</th>
                    <th scope="col">Streak</th>
                    <th scope="col">Hints</th>
                    <th scope="col">Trace</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {students.length === 0 && (
                    <tr>
                      <td colSpan={7}>Waiting for technicians to join.</td>
                    </tr>
                  )}
                  {students.map((student) => {
                    const accuracy = student.progress.attempts === 0
                      ? 100
                      : Math.round((student.progress.correct / student.progress.attempts) * 100)
                    return (
                      <tr key={student.id}>
                        <td>{student.name}</td>
                        <td>{student.progress.systemsRestored}</td>
                        <td>{accuracy}%</td>
                        <td>{student.progress.streak}</td>
                        <td>{student.progress.hintsUsed}</td>
                        <td>{student.progress.traceLevel}</td>
                        <td>{student.connected ? 'Connected' : 'Disconnected'}</td>
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
