import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Button from '@src/components/ui/Button';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import { useClipboard } from '@src/hooks/useClipboard';
import '../student/triangulon.css';

export default function TriangulonManager() {
  const { sessionId } = useParams();
  const [stage, setStage] = useState('training');
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('disconnected');
  const [activeTab, setActiveTab] = useState('map'); // 'map' | 'leaderboard'
  const [specialWinner, setSpecialWinner] = useState(null);

  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/triangulon-invasion?sessionId=${sessionId}`;
  }, [sessionId]);

  const { connect, disconnect, socketRef } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId),
    onOpen: () => setStatus('connected'),
    onClose: () => setStatus('disconnected'),
    onMessage: (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'state') {
          setStage(msg.stage || 'training');
          setEvents(msg.events || []);
        } else if (msg.type === 'events' && Array.isArray(msg.events)) {
          setEvents((prev) => [...prev, ...msg.events]);
        } else if (msg.type === 'special-winner' && msg.winner) {
          setSpecialWinner(msg.winner);
        }
      } catch {
        // ignore
      }
    },
  });

  const { copyToClipboard, isCopied } = useClipboard();

  const handleJoinCodeClick = useCallback((e) => {
    if (!sessionId) return;
    if (e.ctrlKey || e.metaKey) {
      window.open(`/${sessionId}`, '_blank');
    } else {
      copyToClipboard(sessionId);
    }
  }, [sessionId, copyToClipboard]);

  useEffect(() => {
    if (!sessionId) return undefined;
    const ws = connect();
    return () => {
      disconnect();
      if (ws && ws.readyState === 1) ws.close();
    };
  }, [sessionId, connect, disconnect]);

  const send = useCallback((payload) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    }
  }, [socketRef]);

  const advanceStage = useCallback((next) => {
    send({ type: 'advance-stage', stage: next });
  }, [send]);

  const broadcastPing = useCallback(() => {
    send({ type: 'manager-action', action: 'ping' });
  }, [send]);

  const recentEvents = useMemo(() => events.slice(-5).reverse(), [events]);

  // Aggregate leaderboard by triangles made and memoize totals
  const { leaderboard, totalTriangles } = useMemo(() => {
    const counts = new Map();
    let total = 0;

    for (const evt of events) {
      if (!evt) continue;
      // Accept both planned and current stub event shapes
      const isTriangleEvent = evt.type === 'triangle-made' || evt.type === 'triangle_made' || evt.type === 'subdivide';
      if (!isTriangleEvent) continue;

      total += 1;
      if (evt.player) {
        counts.set(evt.player, (counts.get(evt.player) || 0) + 1);
      }
    }

    const rows = Array.from(counts.entries()).map(([player, triangles]) => ({ player, triangles }));
    rows.sort((a, b) => b.triangles - a.triangles);
    return { leaderboard: rows, totalTriangles: total };
  }, [events]);

  return (
    <div className="triangulon-shell">
      <div className="triangulon-grid" aria-hidden="true" />
      <div className="triangulon-frame">
        <header className="triangulon-header">
          <div>
            <p className="triangulon-kicker">Triangulon Sector</p>
            <h1>Instructor Dashboard</h1>
            <p className="triangulon-sub">Manage stages, monitor map, and track leaders</p>
          </div>
          <div className="triangulon-status" style={{ gap: 12 }}>
            <span className={`dot ${status === 'connected' ? 'ok' : 'warn'}`} />
            {status === 'connected' ? 'Link Stable' : 'Link Lost'}
            <span>|</span>
            <button
              type="button"
              onClick={handleJoinCodeClick}
              title={sessionId ? (isCopied(sessionId) ? 'Copied!' : 'Click to copy · Ctrl-click to open student') : 'Join code unavailable'}
              disabled={!sessionId}
              style={{
                cursor: sessionId ? 'pointer' : 'not-allowed',
                border: 'none',
                background: 'transparent',
                color: 'var(--tri-accent)',
                fontWeight: 700,
                padding: 0,
                margin: 0,
                lineHeight: 1.1,
                display: 'inline-flex',
                alignItems: 'center'
              }}
            >
              Join Code: {sessionId || '—'}
            </button>
          </div>
        </header>

        <main className="triangulon-layout">
          <section className="triangulon-main">
            {/* Top Controls Panel */}
            <div className="triangulon-panel">
              <div className="panel-header">Mission Controls</div>
              <div className="triangulon-main-hud">
                <div>
                  <p className="label">Stage</p>
                  <p className="value">{stage}</p>
                </div>
                <div>
                  <p className="label">Players</p>
                  <p className="value">—</p>
                </div>
                <div>
                  <p className="label">Triangles</p>
                  <p className="value">{totalTriangles}</p>
                </div>
              </div>
              <div className="triangulon-actions" style={{ marginTop: 8 }}>
                <Button onClick={() => advanceStage('web')} disabled={!sessionId}>Advance to Web</Button>
                <Button onClick={() => advanceStage('general')} disabled={!sessionId}>Advance to General</Button>
                <Button variant="outline" onClick={broadcastPing} disabled={!sessionId}>Broadcast Ping</Button>
                <Button variant="outline" onClick={() => setSpecialWinner({ title: 'Triangulon Armada Found', player: leaderboard[0]?.player })} disabled={!sessionId}>
                  Mark Special Winner
                </Button>
              </div>
            </div>

            {/* Central Map Panel with Tabs */}
            <div className="triangulon-canvas" aria-label="Class Map" style={{ paddingTop: 56 }}>
              <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 8, zIndex: 3 }}>
                <Button variant={activeTab === 'map' ? 'primary' : 'outline'} onClick={() => setActiveTab('map')}>Map</Button>
                <Button variant={activeTab === 'leaderboard' ? 'primary' : 'outline'} onClick={() => setActiveTab('leaderboard')}>Leaderboard</Button>
              </div>
              {activeTab === 'map' ? (
                <div className="triangulon-canvas-overlay" style={{ pointerEvents: 'none' }}>Class-wide fractal map (coming soon)</div>
              ) : (
                <div className="triangulon-panel" style={{ position: 'absolute', inset: '56px 12px 12px 12px', overflow: 'auto', zIndex: 2 }}>
                  <div className="panel-header">Leaderboard</div>
                  {specialWinner && (
                    <div className="triangulon-status" style={{ marginBottom: 8 }}>
                      <span className="dot ok" /> Special: {specialWinner.title} — {specialWinner.player || 'TBD'}
                    </div>
                  )}
                  {leaderboard.length === 0 ? (
                    <p className="panel-note">No data yet.</p>
                  ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                      {leaderboard.map((row, i) => (
                        <li key={row.player} className="triangulon-panel" style={{ padding: 8, display: 'flex', justifyContent: 'space-between' }}>
                          <span>#{i + 1} — {row.player}</span>
                          <span>{row.triangles} triangles</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Stats Panel */}
            <section className="triangulon-stats">
              <div>
                <p className="label">Recent Signal</p>
                <p className="value">{recentEvents[0]?.type || 'Awaiting'}</p>
              </div>
              <div>
                <p className="label">Events Logged</p>
                <p className="value">{events.length}</p>
              </div>
              <div>
                <p className="label">WS Status</p>
                <p className="value">{status}</p>
              </div>
            </section>
          </section>

          {/* Sidebar: Planned info */}
          <aside className="triangulon-sidebar">
            <div className="triangulon-panel">
              <div className="panel-header">Planned Gameplay Beats</div>
              <ul className="panel-note" style={{ marginTop: 6 }}>
                <li>Stage 1: Training — single triangle midpoint connections</li>
                <li>Stage 2: Web Containment — breadth vs depth tradeoffs</li>
                <li>Stage 3: General Hunt — upgrades, timers, and target search</li>
              </ul>
            </div>

            <div className="triangulon-panel">
              <div className="panel-header">Recent Events</div>
              {recentEvents.length === 0 ? (
                <p className="panel-note">No events yet.</p>
              ) : (
                <ul className="panel-note" style={{ display: 'grid', gap: 6 }}>
                  {recentEvents.map((evt, idx) => (
                    <li key={idx}>
                      <span style={{ opacity: 0.7, marginRight: 8 }}>{new Date(evt.t).toLocaleTimeString()}</span>
                      <span style={{ fontWeight: 600 }}>{evt.type}</span>
                      {evt.stage && <span style={{ marginLeft: 6 }}>→ {evt.stage}</span>}
                      {evt.action && <span style={{ marginLeft: 6 }}>[{evt.action}]</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
