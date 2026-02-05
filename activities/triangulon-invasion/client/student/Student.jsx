import React, { useCallback, useEffect } from 'react';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import Button from '@src/components/ui/Button';
import TriangleNav from './TriangleNav';
import './triangulon.css';

export default function TriangulonStudent({ sessionData }) {
  const attachSessionEndedHandler = useSessionEndedHandler();
  const sessionId = sessionData?.sessionId;

  const [state, setState] = React.useState({ stage: 'training', events: [] });
  const [status, setStatus] = React.useState('connecting');

  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/triangulon-invasion?sessionId=${sessionId}`;
  }, [sessionId]);

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId),
    attachSessionEndedHandler,
    onOpen: () => setStatus('connected'),
    onClose: () => setStatus('disconnected'),
    onMessage: (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'state') {
          setState({ stage: msg.stage, events: msg.events || [] });
        } else if (msg.type === 'events' && Array.isArray(msg.events)) {
          setState((prev) => ({ ...prev, events: [...prev.events, ...msg.events] }));
        }
      } catch {
        // ignore
      }
    },
  });

  useEffect(() => {
    if (!sessionId) return undefined;
    const ws = connect();
    return () => {
      disconnect();
      if (ws && ws.readyState === 1) {
        ws.close();
      }
    };
  }, [sessionId, connect, disconnect]);

  return (
    <div className="triangulon-shell">
      <div className="triangulon-grid" aria-hidden="true" />
      <div className="triangulon-frame">
        <header className="triangulon-header">
          <div>
            <p className="triangulon-kicker">Triangulon Sector</p>
            <h1>Invasion Control</h1>
          </div>
          <div className="triangulon-status">
            <span className={`dot ${status === 'connected' ? 'ok' : 'warn'}`} />
            {status === 'connected' ? 'Link Stable' : 'Link Lost'} - Session: {sessionData?.sessionId || 'loading...'}
          </div>
        </header>

        <main className="triangulon-layout">
          <section className="triangulon-main">
            <div className="triangulon-main-hud">
              <div>
                <p className="label">Depth</p>
                <p className="value">—</p>
              </div>
              <div>
                <p className="label">Triangles</p>
                <p className="value">—</p>
              </div>
              <div>
                <p className="label">Timer</p>
                <p className="value">—</p>
              </div>
            </div>
            <div className="triangulon-canvas" aria-label="Triangle workspace">
              <div className="triangulon-canvas-overlay">Tap to subdivide sector</div>
            </div>
            <div className="triangulon-actions">
              <Button variant="primary" disabled>Subdivide (coming soon)</Button>
              <Button variant="outline" disabled>Toggle Grid</Button>
            </div>
          </section>

          <aside className="triangulon-sidebar">
            <div className="triangulon-panel">
              <div className="panel-header">Mini-map</div>
              <div className="mini-map" aria-label="Fractal mini-map">
                <div className="mini-spark" />
              </div>
              <div className="mini-controls">
                <TriangleNav
                  // Navigation stays disabled until traversal wiring is implemented
                  onNavigate={(direction) => {
                    console.log('Navigate:', direction);
                    // TODO: Implement navigation logic
                  }}
                />
              </div>
            </div>

            <div className="triangulon-panel">
              <div className="panel-header">Upgrade Bay</div>
              <p className="panel-note">Unlocked in Stage 3. Plan for auto-subdivide, chain reactions, and speed boosts.</p>
            </div>
          </aside>
        </main>

        <section className="triangulon-stats">
          <div>
            <p className="label">Recent Signals</p>
            <p className="value">{state.events.slice(-1)[0]?.type || 'Awaiting data'}</p>
          </div>
          <div>
            <p className="label">Events Logged</p>
            <p className="value">{state.events.length}</p>
          </div>
          <div>
            <p className="label">Stage</p>
            <p className="value">{state.stage}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
