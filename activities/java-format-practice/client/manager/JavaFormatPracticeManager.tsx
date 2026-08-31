import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router';
import { arrayToCsv, downloadCsv } from '@src/utils/csvUtils';
import Button from '@src/components/ui/Button';
import SessionHeader from '@src/components/common/SessionHeader';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import type {
  JavaFormatDifficulty,
  JavaFormatStudentRecord,
  JavaFormatTheme,
} from '../../javaFormatPracticeTypes.js'

type SortBy = 'name' | 'total' | 'correct' | 'accuracy' | 'streak'
type SortDirection = 'asc' | 'desc'

interface StudentsResponse {
  students?: JavaFormatStudentRecord[]
}

interface ManagerWsMessage {
  type: string
  payload?: {
    students?: JavaFormatStudentRecord[]
  }
}

export type ManagerAuthLostRecovery = 'reload-from-signin' | 'temporarily-unavailable' | 'no-recovery'

/**
 * Which recovery affordance the auth-lost banner should present:
 * - `reload-from-signin`: the capability exchange confirmed a persistent record
 *   and a still-valid teacher cookie, so a reload redeems a fresh capability.
 * - `temporarily-unavailable`: the exchange only ever hit transient failures, so
 *   we never learned whether recovery is possible - offer retry/reload rather
 *   than telling the instructor a reload cannot help.
 * - `no-recovery`: a conclusive 403/404 - reloading will not help, mint a new
 *   session.
 */
export function resolveManagerAuthLostRecovery(params: {
  persistentRecoveryAvailable: boolean
  managerAccessTemporarilyUnavailable: boolean
}): ManagerAuthLostRecovery {
  if (params.persistentRecoveryAvailable) return 'reload-from-signin'
  if (params.managerAccessTemporarilyUnavailable) return 'temporarily-unavailable'
  return 'no-recovery'
}

/**
 * JavaFormatPracticeManager - Teacher view for managing the Java Format Practice activity
 * Displays student roster and their progress statistics
 */
export default function JavaFormatPracticeManager() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();

  const [students, setStudents] = useState<JavaFormatStudentRecord[]>([])
  const [startingNewSession, setStartingNewSession] = useState(false)
  const [managerAuthLost, setManagerAuthLost] = useState(false)
  // The sessionId whose persistent-manager-capability exchange has completed.
  // Tracked as an id rather than a boolean so a parameter-only route swap can
  // never leave a stale `true` in the window before the passive effect re-runs.
  const [managerAccessReadySessionId, setManagerAccessReadySessionId] = useState<string | null>(null)
  const managerAccessReady = sessionId != null && managerAccessReadySessionId === sessionId
  // The sessionId the capability exchange reported as persistently recoverable
  // (`persistentRecoveryAvailable` - a persistent record plus a still-valid
  // persistent teacher cookie). For those managers a later capability expiry IS
  // recoverable by reloading - the reload redeems the longer-lived teacher
  // cookie again - so the auth-lost banner offers a reload path instead of
  // new-session-only.
  const [persistentRecoverySessionId, setPersistentRecoverySessionId] = useState<string | null>(null)
  const persistentRecoveryAvailable = sessionId != null && persistentRecoverySessionId === sessionId
  // The sessionId whose capability exchange exhausted its retries against a
  // transient (5xx / network) failure - so we never learned whether persistent
  // recovery is available. Distinct from a conclusive "no recovery" (403/404):
  // a later reload of a valid permalink session CAN still redeem the teacher
  // cookie once the store recovers, so the banner must offer retry/reload here
  // rather than the temporary-session "reloading won't help" message.
  const [managerAccessUnavailableSessionId, setManagerAccessUnavailableSessionId] = useState<string | null>(null)
  const managerAccessTemporarilyUnavailable = sessionId != null && managerAccessUnavailableSessionId === sessionId
  const managerAuthLostRecovery = resolveManagerAuthLostRecovery({ persistentRecoveryAvailable, managerAccessTemporarilyUnavailable })
  const [managerAccessRetryNonce, setManagerAccessRetryNonce] = useState(0)
  const managerAuthLostRef = useRef(false)
  // Bumped every time a live `studentsUpdate` is applied. An in-flight `/students`
  // poll captures this value and drops its snapshot if a newer socket update
  // landed while the request was outstanding, so a slow HTTP response can never
  // overwrite a fresher roster.
  const rosterUpdateGenRef = useRef(0)
  // Serializes `/students` polls: the mount, on-open, and interval callers skip
  // starting a new request while one is in flight, so responses cannot pile up or
  // arrive out of order and a slow (>interval) request still gets to render.
  // `pollInFlightRef` holds the token of the poll that currently owns the slot
  // (0 = free); `pollTokenRef` is the monotonic token source. A poll only clears
  // the slot if it still owns it, so an aborted poll from a previous session
  // cannot free the slot out from under the new session's request.
  const pollInFlightRef = useRef(0)
  const pollTokenRef = useRef(0)
  // The socket for the *current* sessionId. `disconnect()` closes the previous
  // session's socket but leaves its `onmessage` bound, so a message already
  // queued on it can still fire after a route swap; roster updates are only
  // applied when they come from this socket.
  const activeSocketRef = useRef<WebSocket | null>(null)
  const [selectedDifficulty, setSelectedDifficulty] = useState<JavaFormatDifficulty>('beginner')
  const [selectedTheme, setSelectedTheme] = useState<JavaFormatTheme>('all')
  const [sortBy, setSortBy] = useState<SortBy>('name') // 'name', 'total', 'correct', 'accuracy', 'streak'
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc') // 'asc' or 'desc'

  // Available difficulty levels
  const difficultyLevels: Array<{ id: JavaFormatDifficulty; label: string }> = [
    { id: 'beginner', label: 'Beginner' },
    { id: 'intermediate', label: 'Intermediate' },
    { id: 'advanced', label: 'Advanced' },
  ];

  // Available themes
  const themes: Array<{ id: JavaFormatTheme; label: string }> = [
    { id: 'all', label: 'All Themes' },
    { id: 'wanted-poster', label: 'Wanted Poster' },
    { id: 'fantasy-menu', label: 'Fantasy Menu' },
    { id: 'spy-badge', label: 'Spy Badge' },
  ];

  const markManagerAuthLost = useCallback(() => {
    if (managerAuthLostRef.current) return;
    managerAuthLostRef.current = true;
    setManagerAuthLost(true);
  }, []);

  // Re-run the capability exchange after it gave up on a transient outage:
  // clear the auth-loss latch so the gate can re-open, and bump the nonce the
  // exchange effect depends on.
  const retryManagerAccess = useCallback(() => {
    managerAuthLostRef.current = false;
    setManagerAuthLost(false);
    setManagerAccessUnavailableSessionId(null);
    setManagerAccessRetryNonce((nonce) => nonce + 1);
  }, []);

  // For a temporary session a lost manager capability cannot be recovered by
  // reloading (the same cookie is re-sent and `POST /create` is the only
  // issuance path), so minting a fresh session is the only way forward. A
  // permalink manager backed by a persistent teacher cookie is different - see
  // `persistentRecoverySessionId` - and the banner offers reload there.
  const handleStartNewSession = useCallback(async () => {
    setStartingNewSession(true);
    try {
      const res = await fetch('/api/java-format-practice/create', { method: 'POST' });
      if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
      const data = (await res.json()) as { id?: string };
      if (data.id) {
        void navigate(`/manage/java-format-practice/${data.id}`);
      } else {
        throw new Error('create response missing session id');
      }
    } catch (err) {
      console.error('Failed to start a new Java Format session:', err);
      setStartingNewSession(false);
    }
  }, [navigate]);

  const handleDifficultyChange = (difficulty: JavaFormatDifficulty) => {
    // Block until the persistent-permalink capability exchange has settled;
    // a request sent before the cookie lands 403s and latches manager-auth-lost.
    if (sessionId == null || !managerAccessReady || managerAuthLostRef.current) return;
    setSelectedDifficulty(difficulty);

    // Send selected difficulty to server
    fetch(`/api/java-format-practice/${sessionId}/difficulty`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty }),
    }).then((res) => {
      if (res.status === 403) markManagerAuthLost();
    }).catch((err) => {
      console.error('Failed to update difficulty:', err);
    });
  };

  const handleThemeChange = (theme: JavaFormatTheme) => {
    if (sessionId == null || !managerAccessReady || managerAuthLostRef.current) return;
    setSelectedTheme(theme);

    // Send selected theme to server
    fetch(`/api/java-format-practice/${sessionId}/theme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    }).then((res) => {
      if (res.status === 403) markManagerAuthLost();
    }).catch((err) => {
      console.error('Failed to update theme:', err);
    });
  };

  // A parameter-only route swap keeps this component mounted. Reset the auth-loss
  // latch (so it can't suppress the new session's fetches), drop the previous
  // session's roster from the screen, invalidate every in-flight poll, and stop
  // trusting the outgoing socket so a late response cannot repaint the new URL.
  useEffect(() => {
    managerAuthLostRef.current = false;
    setManagerAuthLost(false);
    setManagerAccessUnavailableSessionId(null);
    setStartingNewSession(false);
    setStudents([]);
    rosterUpdateGenRef.current += 1;
    // Invalidate any outstanding poll's ownership and free the slot for the new session.
    pollTokenRef.current += 1;
    pollInFlightRef.current = 0;
    activeSocketRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (sessionId == null) {
      return undefined
    }

    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const MAX_ATTEMPTS = 4

    const runExchange = async (): Promise<void> => {
      let response: Response
      try {
        response = await fetch(`/api/session/${encodeURIComponent(sessionId)}/persistent-manager-capability`, {
          method: 'POST',
          credentials: 'include',
        })
      } catch {
        // Network error: transient, keep the gate closed and retry.
        if (!cancelled) scheduleRetryOrGiveUp()
        return
      }
      if (cancelled) return
      // 2xx  -> capability cookie issued (or already present).
      // 403/404 -> definitive denial. The route checks `alreadyAuthorized`
      //         first, so these mean the caller has no valid manager capability
      //         and no recovery path here (no persistent record, or no teacher
      //         cookie). Latch the no-recovery banner and keep the gate closed
      //         rather than opening a poll/socket that can only fail.
      if (response.ok) {
        // The endpoint reports `persistentRecoveryAvailable` when this session
        // has a persistent record and a still-valid persistent teacher cookie -
        // including on its fast path, where the capability was already issued by
        // `teacher-authenticate` before this component mounted. When true, a
        // later capability expiry is recoverable by reloading (the teacher
        // cookie outlives the 7-day capability), so the banner offers reload.
        try {
          const body = await response.clone().json() as { persistentRecoveryAvailable?: unknown }
          // The body await can resolve after a route swap cancelled this
          // exchange; a cancelled exchange must not touch the returned-to
          // session's recovery/readiness state.
          if (cancelled) return
          if (body?.persistentRecoveryAvailable === true) {
            setPersistentRecoverySessionId(sessionId)
          } else {
            // The persistent teacher credential is no longer backing this
            // session; drop any recoverability advertised by an earlier exchange
            // so the banner does not offer a reload that cannot help.
            setPersistentRecoverySessionId((current) => (current === sessionId ? null : current))
          }
        } catch {
          // Body parse failure is non-fatal; readiness still releases below.
        }
        // A conclusive answer arrived (possibly on a retry): this is no longer
        // an "unknown / temporarily unavailable" state.
        setManagerAccessUnavailableSessionId((current) => (current === sessionId ? null : current))
        setManagerAccessReadySessionId(sessionId)
        return
      }
      if (response.status === 404 || response.status === 403) {
        // Clear any recoverability/"temporarily unavailable" state a prior
        // exchange advertised so the banner resolves to `no-recovery`.
        setPersistentRecoverySessionId((current) => (current === sessionId ? null : current))
        setManagerAccessUnavailableSessionId((current) => (current === sessionId ? null : current))
        markManagerAuthLost()
        return
      }
      // 5xx / unexpected: transient persistence failure - stay gated and retry.
      scheduleRetryOrGiveUp()
    }

    const scheduleRetryOrGiveUp = (): void => {
      attempts += 1
      if (attempts >= MAX_ATTEMPTS) {
        // Retries exhausted against a transient failure: we never learned
        // whether persistent recovery is available. Mark the state "temporarily
        // unavailable" (not "no recovery") so the banner offers retry/reload
        // instead of the temporary-session "reloading won't help" message, then
        // latch so the protected poll/socket do not open without a cookie.
        setManagerAccessUnavailableSessionId(sessionId)
        markManagerAuthLost()
        return
      }
      retryTimer = setTimeout(() => { void runExchange() }, 1000 * attempts)
    }

    // Defer one microtask so React Strict Mode's throwaway effect pass is
    // cancelled before this POST fires, instead of sending two
    // persistent-manager-capability requests - each consuming a rate-limit
    // attempt and racing the route's whole-session capability write - per mount.
    void Promise.resolve().then(() => {
      if (cancelled) return
      void runExchange()
    })

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [sessionId, markManagerAuthLost, managerAccessRetryNonce])

  const fetchStudents = useCallback(async (signal?: AbortSignal) => {
    if (sessionId == null || !managerAccessReady || managerAuthLostRef.current || pollInFlightRef.current !== 0) return;
    const pollToken = (pollTokenRef.current += 1);
    pollInFlightRef.current = pollToken;
    try {
      const rosterGenAtStart = rosterUpdateGenRef.current;
      const res = await fetch(`/api/java-format-practice/${sessionId}/students`, { signal });
      // A poll invalidated by a session swap is ignored entirely, including its
      // status — a stale 403 must not latch auth-loss on the new session.
      if (signal?.aborted) return;
      if (res.status === 403) {
        // The manager capability is gone; stop polling a request that can only 403.
        markManagerAuthLost();
        return;
      }
      if (!res.ok) throw new Error(`Failed to fetch students: ${res.status}`);
      const data = (await res.json()) as StudentsResponse
      const list = Array.isArray(data.students) ? data.students : [];
      if (signal?.aborted) return;
      // A live `studentsUpdate` that arrived while this poll was in flight is
      // authoritative; discard this now-stale HTTP snapshot.
      if (rosterUpdateGenRef.current !== rosterGenAtStart) return;
      setStudents(list);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Failed to fetch students:', err);
    } finally {
      // Only release the slot if this poll still owns it (a session swap or a
      // superseding reset may have handed it to a newer request).
      if (pollInFlightRef.current === pollToken) pollInFlightRef.current = 0;
    }
  }, [sessionId, managerAccessReady, markManagerAuthLost]);

  const handleWsMessage = useCallback((event: MessageEvent<string>, ws?: WebSocket) => {
    // Drop anything that is not from the socket bound to the current sessionId
    // (e.g. a message queued on a prior session's socket before disconnect()).
    if (ws !== activeSocketRef.current) return;
    try {
      const message = JSON.parse(event.data) as ManagerWsMessage
      if (message.type === 'studentsUpdate') {
        const list = Array.isArray(message.payload?.students) ? message.payload.students : [];
        rosterUpdateGenRef.current += 1;
        setStudents(list);
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  }, []);

  const handleWsOpen = useCallback((_event: Event, ws: WebSocket) => {
    activeSocketRef.current = ws;
    void fetchStudents();
  }, [fetchStudents]);

  const handleWsClose = useCallback((_event: CloseEvent, ws: WebSocket) => {
    if (activeSocketRef.current === ws) activeSocketRef.current = null;
  }, []);

  const handleWsError = useCallback((error: unknown) => {
    console.error('WebSocket error:', error);
  }, []);

  const buildWsUrl = useCallback(() => {
    if (sessionId == null) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws/java-format-practice?sessionId=${sessionId}&principal=manager`;
  }, [sessionId]);

  const isTerminalManagerSocketClose = useCallback((event: CloseEvent) => {
    const terminal = event.code === 1008 && event.reason === 'activity-auth-required';
    if (terminal) markManagerAuthLost();
    return terminal;
  }, [markManagerAuthLost]);

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: sessionId != null && managerAccessReady,
    onOpen: handleWsOpen,
    onMessage: handleWsMessage,
    onClose: handleWsClose,
    onError: handleWsError,
    isTerminalClose: isTerminalManagerSocketClose,
  });

  useEffect(() => {
    if (sessionId == null || !managerAccessReady) return undefined;
    const controller = new AbortController();
    void fetchStudents(controller.signal);
    const refreshInterval = window.setInterval(() => {
      void fetchStudents(controller.signal);
    }, 2_000);
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) {
        void connect();
      }
    });
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(refreshInterval);
      // Stop trusting the outgoing socket immediately so a message it has already
      // queued cannot land on the next session's roster.
      activeSocketRef.current = null;
      disconnect();
    };
  }, [sessionId, managerAccessReady, fetchStudents, connect, disconnect]);

  const handleExportCsv = useCallback(() => {
    if (students.length === 0) {
      alert('No student data to export');
      return;
    }

    const rows = [
      ['Student', 'Total Attempts', 'Correct', 'Accuracy', 'Current Streak', 'Longest Streak'],
      ...students.map((s) => [
        s.name || 'Unknown',
        s.stats?.total || 0,
        s.stats?.correct || 0,
        s.stats?.total > 0 ? `${((s.stats.correct / s.stats.total) * 100).toFixed(1)}%` : 'N/A',
        s.stats?.streak || 0,
        s.stats?.longestStreak || 0,
      ]),
    ];

    const csv = arrayToCsv(rows);
    downloadCsv(csv, 'java-format-practice-results.csv');
  }, [students]);

  const handleSort = (column: SortBy) => {
    if (sortBy === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDirection('asc');
    }
  };

  const sortedStudents = useMemo(() => {
    return [...students].sort((a, b) => {
      let aValue: number | string
      let bValue: number | string

      switch (sortBy) {
        case 'total':
          aValue = a.stats?.total || 0;
          bValue = b.stats?.total || 0;
          break;
        case 'correct':
          aValue = a.stats?.correct || 0;
          bValue = b.stats?.correct || 0;
          break;
        case 'accuracy':
          aValue =
            (a.stats?.total || 0) > 0 ? a.stats.correct / a.stats.total : 0;
          bValue =
            (b.stats?.total || 0) > 0 ? b.stats.correct / b.stats.total : 0;
          break;
        case 'streak':
          aValue = a.stats?.streak || 0;
          bValue = b.stats?.streak || 0;
          break;
        default: // name
          aValue = (a.name || 'Unknown').toLowerCase();
          bValue = (b.name || 'Unknown').toLowerCase();
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [students, sortBy, sortDirection]);

  return (
    <div style={styles.container}>
      <SessionHeader
        activityName="Java Format Practice"
        sessionId={sessionId}
      />

      {managerAuthLost && (
        <div role="alert" style={styles.authLostBanner}>
          {managerAuthLostRecovery === 'reload-from-signin' ? (
            <>
              <span>
                This manager session&rsquo;s capability has expired. Reload the page
                to restore it from your instructor sign-in, or start a new session.
              </span>
              <Button onClick={() => { window.location.reload(); }}>
                Reload
              </Button>
              <Button onClick={() => { void handleStartNewSession(); }} disabled={startingNewSession}>
                {startingNewSession ? 'Starting…' : 'Start new session'}
              </Button>
            </>
          ) : managerAuthLostRecovery === 'temporarily-unavailable' ? (
            <>
              <span>
                Manager access is temporarily unavailable. Retry now, or reload the
                page once the service recovers &mdash; a valid instructor sign-in
                can still be restored.
              </span>
              <Button onClick={retryManagerAccess}>
                Retry
              </Button>
              <Button onClick={() => { window.location.reload(); }}>
                Reload
              </Button>
              <Button onClick={() => { void handleStartNewSession(); }} disabled={startingNewSession}>
                {startingNewSession ? 'Starting…' : 'Start new session'}
              </Button>
            </>
          ) : (
            <>
              <span>
                This manager session&rsquo;s authentication has expired or is no
                longer valid. Reloading won&rsquo;t restore it &mdash; start a new
                session to continue managing students.
              </span>
              <Button onClick={() => { void handleStartNewSession(); }} disabled={startingNewSession}>
                {startingNewSession ? 'Starting…' : 'Start new session'}
              </Button>
            </>
          )}
        </div>
      )}

      <div style={styles.content}>
        {/* Difficulty Selector */}
        <div style={styles.controlSection}>
          <h3 style={styles.sectionTitle}>Format Difficulty Level</h3>
          <div style={styles.buttonGroup}>
            {difficultyLevels.map((level) => (
              <button
                key={level.id}
                style={{
                  ...styles.controlButton,
                  ...(selectedDifficulty === level.id
                    ? styles.controlButtonSelected
                    : {}),
                }}
                onClick={() => handleDifficultyChange(level.id)}
                disabled={managerAuthLost || !managerAccessReady}
                aria-pressed={selectedDifficulty === level.id}
              >
                {level.label}
              </button>
            ))}
          </div>
        </div>

        {/* Theme Selector */}
        <div style={styles.controlSection}>
          <h3 style={styles.sectionTitle}>Challenge Theme</h3>
          <div style={styles.buttonGroup}>
            {themes.map((theme) => (
              <button
                key={theme.id}
                style={{
                  ...styles.controlButton,
                  ...(selectedTheme === theme.id
                    ? styles.controlButtonSelected
                    : {}),
                }}
                onClick={() => handleThemeChange(theme.id)}
                disabled={managerAuthLost || !managerAccessReady}
                aria-pressed={selectedTheme === theme.id}
              >
                {theme.label}
              </button>
            ))}
          </div>
        </div>

        {/* Student Roster */}
        <div style={styles.rosterSection}>
          <div style={styles.rosterHeader}>
            <h3 style={styles.sectionTitle}>Student Progress</h3>
            <Button onClick={handleExportCsv} style={styles.exportButton}>
              📊 Export CSV
            </Button>
          </div>

          {students.length === 0 ? (
            <p style={styles.emptyMessage}>
              No students connected. Waiting for students to join...
            </p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th
                    style={styles.tableHeader}
                    onClick={() => handleSort('name')}
                  >
                    Student {sortBy === 'name' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  <th
                    style={styles.tableHeader}
                    onClick={() => handleSort('total')}
                  >
                    Total {sortBy === 'total' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  <th
                    style={styles.tableHeader}
                    onClick={() => handleSort('correct')}
                  >
                    Correct {sortBy === 'correct' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  <th
                    style={styles.tableHeader}
                    onClick={() => handleSort('accuracy')}
                  >
                    Accuracy {sortBy === 'accuracy' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  <th
                    style={styles.tableHeader}
                    onClick={() => handleSort('streak')}
                  >
                    Streak {sortBy === 'streak' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedStudents.map((student) => {
                  const total = student.stats?.total || 0;
                  const correct = student.stats?.correct || 0;
                  const accuracy =
                    total > 0
                      ? ((correct / total) * 100).toFixed(1)
                      : 'N/A';

                  return (
                    <tr key={student.id || student.name}>
                      <td style={styles.tableCell}>{student.name || 'Unknown'}</td>
                      <td style={styles.tableCell}>{total}</td>
                      <td style={styles.tableCell}>{correct}</td>
                      <td style={styles.tableCell}>
                        {accuracy === 'N/A' ? 'N/A' : `${accuracy}%`}
                      </td>
                      <td style={styles.tableCell}>
                        {student.stats?.streak || 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    background: '#ffffff',
    borderRadius: '16px',
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
    overflow: 'hidden',
  },
  content: {
    padding: '30px',
  },
  authLostBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    margin: '20px 30px 0',
    padding: '12px 16px',
    background: '#fff5f5',
    border: '1px solid #feb2b2',
    borderRadius: '8px',
    color: '#742a2a',
  },
  controlSection: {
    marginBottom: '30px',
    background: '#f7fafc',
    padding: '20px',
    borderRadius: '12px',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1a365d',
    marginBottom: '15px',
  },
  buttonGroup: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  controlButton: {
    padding: '10px 20px',
    borderRadius: '8px',
    border: '2px solid #e2e8f0',
    background: '#ffffff',
    color: '#4a5568',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s',
  },
  controlButtonSelected: {
    background: '#ff9f1c',
    color: '#ffffff',
    borderColor: '#ff9f1c',
  },
  rosterSection: {
    marginTop: '30px',
  },
  rosterHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    flexWrap: 'wrap',
    gap: '15px',
  },
  exportButton: {
    padding: '10px 20px !important',
  },
  emptyMessage: {
    textAlign: 'center',
    color: '#718096',
    fontSize: '16px',
    padding: '20px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  tableHeader: {
    background: '#edf2f7',
    padding: '12px',
    textAlign: 'left',
    fontWeight: '600',
    color: '#1a365d',
    cursor: 'pointer',
    userSelect: 'none',
  },
  tableCell: {
    padding: '12px',
    borderBottom: '1px solid #e2e8f0',
    color: '#2d3748',
  },
};
