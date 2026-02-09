import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { activities } from '@src/activities'
import {
  buildByTypeEntries,
  buildSessionRows,
  fmtBytes,
  fmtInt,
  type StatusSession,
} from './statusDashboardUtils'

interface StatusPayload {
  environment?: {
    isDevelopment?: boolean
    nodeEnv?: string
  }
  storage?: {
    mode?: string
    ttlMs?: number | null
  }
  process?: {
    uptimeSeconds?: number
    node?: string
    memory?: {
      rss?: number
      heapUsed?: number
      heapTotal?: number
    }
  }
  websocket?: {
    connectedClients?: number
  }
  sessions?: {
    count?: number
    byType?: Record<string, number | undefined>
    approxTotalBytes?: number
    showSessionIds?: boolean
    list?: StatusSession[]
  }
  valkey?: {
    ping?: string
    dbsize?: number
    memory?: Record<string, string>
    error?: string
  } | null
}

const activityIds = activities.map((activity) => activity.id)

export default function StatusDashboard() {
  const [data, setData] = useState<StatusPayload | null>(null)
  const [error, setError] = useState('')
  const [paused, setPaused] = useState(false)
  const [intervalMs, setIntervalMs] = useState(5000)
  const lastUpdatedRef = useRef<Date | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        const res = await fetch('/api/status', { cache: 'no-store' })
        const json = (await res.json()) as StatusPayload

        if (!mounted) return

        setData(json)
        setError('')
        lastUpdatedRef.current = new Date()
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    void load()

    const id = setInterval(() => {
      if (!paused) void load()
    }, intervalMs)

    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [intervalMs, paused])

  const byTypeEntries = useMemo(
    () => buildByTypeEntries(activityIds, data?.sessions?.byType),
    [data?.sessions?.byType],
  )

  const showSessionIds = data?.sessions?.showSessionIds !== false

  const sessionRows = useMemo(
    () => buildSessionRows(data?.sessions?.list),
    [data?.sessions?.list],
  )

  return (
    <div
      style={{
        padding: 20,
        maxWidth: 1400,
        margin: '0 auto',
        background: '#f9fafb',
        color: '#1f2937',
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
      }}
    >
      <header style={{ borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 18, margin: 0, color: '#111827' }}>ActiveBits Status</h1>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Last update: {lastUpdatedRef.current ? lastUpdatedRef.current.toLocaleTimeString() : '—'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
            <label htmlFor="refresh-interval" style={{ fontSize: 12, color: '#6b7280' }}>
              Refresh:
            </label>
            <select
              id="refresh-interval"
              value={intervalMs}
              onChange={(event) => setIntervalMs(Number(event.target.value))}
              style={{
                background: '#fff',
                color: '#1f2937',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                padding: '6px 10px',
              }}
            >
              <option value={2000}>2s</option>
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
            </select>
            {!paused ? (
              <button
                type="button"
                onClick={() => setPaused(true)}
                style={{
                  background: '#fff',
                  color: '#1f2937',
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  padding: '6px 10px',
                  cursor: 'pointer',
                }}
              >
                Pause
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPaused(false)}
                style={{
                  background: '#fff',
                  color: '#1f2937',
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  padding: '6px 10px',
                  cursor: 'pointer',
                }}
              >
                Resume
              </button>
            )}
          </div>
        </div>
        <div style={{ width: '100%', marginTop: 8 }}>
          <div style={{ minHeight: 18, color: '#dc2626' }}>{error}</div>
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: '#6b7280', fontWeight: 600 }}>
            Environment
          </h3>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: data?.environment?.isDevelopment ? '#0ea5e9' : '#059669',
            }}
          >
            {data?.environment?.isDevelopment ? 'Development' : 'Production'}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>NODE_ENV: {data?.environment?.nodeEnv || '-'}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: '#6b7280', fontWeight: 600 }}>Storage</h3>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>{data?.storage?.mode || '-'}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            TTL: {(data?.storage?.ttlMs ?? 0) > 0 ? `${Math.round((data?.storage?.ttlMs ?? 0) / 1000)}s` : '-'}
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: '#6b7280', fontWeight: 600 }}>Uptime</h3>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>{fmtInt(data?.process?.uptimeSeconds)}s</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Node <code>{data?.process?.node || '-'}</code>
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: '#6b7280', fontWeight: 600 }}>WS Clients</h3>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>
            {fmtInt(data?.websocket?.connectedClients)}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Connected sockets</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: '#6b7280', fontWeight: 600 }}>RSS Memory</h3>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>
            {fmtBytes(data?.process?.memory?.rss)}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Heap {fmtBytes(data?.process?.memory?.heapUsed)} / {fmtBytes(data?.process?.memory?.heapTotal)}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: '#6b7280', fontWeight: 600 }}>Sessions</h3>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
            {fmtInt(data?.sessions?.count)}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
            Approx size {fmtBytes(data?.sessions?.approxTotalBytes)}
          </div>
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 6 }}>BY TYPE</div>
            <div
              style={{
                maxHeight: 150,
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'max-content 1fr',
                gap: '6px 12px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 12,
              }}
            >
              {byTypeEntries.map(([activityId, count]) => (
                <Fragment key={activityId}>
                  <div style={{ color: '#6b7280' }}>{activityId}</div>
                  <div style={{ color: '#111827' }}>{fmtInt(count)}</div>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: '#6b7280', fontWeight: 600 }}>Valkey</h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              gap: '6px 12px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 12,
            }}
          >
            {data?.valkey ? (
              data.valkey.error ? (
                <>
                  <div style={{ color: '#6b7280' }}>error</div>
                  <div style={{ color: '#dc2626' }}>{String(data.valkey.error)}</div>
                </>
              ) : (
                <>
                  <div style={{ color: '#6b7280' }}>ping</div>
                  <div style={{ color: '#111827' }}>
                    <code>{data.valkey.ping}</code>
                  </div>
                  <div style={{ color: '#6b7280' }}>dbsize</div>
                  <div style={{ color: '#111827' }}>{fmtInt(data.valkey.dbsize)}</div>
                  <div style={{ color: '#6b7280' }}>used_memory</div>
                  <div style={{ color: '#111827' }}>
                    {fmtBytes(Number(data.valkey.memory?.used_memory))} ({data.valkey.memory?.used_memory_human || '-'})
                  </div>
                  <div style={{ color: '#6b7280' }}>used_memory_rss</div>
                  <div style={{ color: '#111827' }}>
                    {fmtBytes(Number(data.valkey.memory?.used_memory_rss))} ({data.valkey.memory?.used_memory_rss_human || '-'})
                  </div>
                </>
              )
            ) : (
              <>
                <div style={{ color: '#6b7280' }}>info</div>
                <div style={{ color: '#111827' }}>not using Valkey</div>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
        <h3 style={{ margin: 0, marginBottom: 6, fontSize: 13, color: '#6b7280', fontWeight: 600 }}>
          Active Sessions
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: 'left',
                    padding: 8,
                    borderBottom: '1px solid #e5e7eb',
                    fontSize: 12,
                    color: '#6b7280',
                    fontWeight: 600,
                  }}
                >
                  Session ID
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: 8,
                    borderBottom: '1px solid #e5e7eb',
                    fontSize: 12,
                    color: '#6b7280',
                    fontWeight: 600,
                  }}
                >
                  Type
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: 8,
                    borderBottom: '1px solid #e5e7eb',
                    fontSize: 12,
                    color: '#6b7280',
                    fontWeight: 600,
                  }}
                >
                  Sockets
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: 8,
                    borderBottom: '1px solid #e5e7eb',
                    fontSize: 12,
                    color: '#6b7280',
                    fontWeight: 600,
                  }}
                >
                  Last Activity
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: 8,
                    borderBottom: '1px solid #e5e7eb',
                    fontSize: 12,
                    color: '#6b7280',
                    fontWeight: 600,
                  }}
                >
                  Expires At
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: 8,
                    borderBottom: '1px solid #e5e7eb',
                    fontSize: 12,
                    color: '#6b7280',
                    fontWeight: 600,
                  }}
                >
                  TTL
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: 8,
                    borderBottom: '1px solid #e5e7eb',
                    fontSize: 12,
                    color: '#6b7280',
                    fontWeight: 600,
                  }}
                >
                  Approx Size
                </th>
              </tr>
            </thead>
            <tbody>
              {sessionRows.length > 0 ? (
                sessionRows.map((sessionRow, index) => (
                  <tr key={`${sessionRow.id || 'session'}-${index}`}>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6', color: '#111827' }}>
                      {showSessionIds && sessionRow.id ? (
                        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                          <code>{sessionRow.id}</code>
                        </span>
                      ) : (
                        <span style={{ color: '#6b7280' }}>hidden</span>
                      )}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6', color: '#111827' }}>
                      {sessionRow.type}
                    </td>
                    <td
                      style={{
                        padding: 8,
                        borderBottom: '1px solid #f3f4f6',
                        color: sessionRow.socketCount > 0 ? '#059669' : '#111827',
                      }}
                    >
                      {fmtInt(sessionRow.socketCount)}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6', color: '#111827' }}>
                      {sessionRow.lastActivity}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6', color: '#111827' }}>
                      {sessionRow.expiresAt}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6', color: '#111827' }}>
                      {sessionRow.ttl}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6', color: '#111827' }}>
                      {fmtBytes(sessionRow.approxBytes)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={7}
                    style={{ padding: 8, borderBottom: '1px solid #f3f4f6', fontSize: 12, color: '#6b7280' }}
                  >
                    No sessions
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
