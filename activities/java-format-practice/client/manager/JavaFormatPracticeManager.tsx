import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router';
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

/**
 * JavaFormatPracticeManager - Teacher view for managing the Java Format Practice activity
 * Displays student roster and their progress statistics
 */
export default function JavaFormatPracticeManager() {
  const { sessionId } = useParams<{ sessionId?: string }>();

  const [students, setStudents] = useState<JavaFormatStudentRecord[]>([])
  const [managerAuthLost, setManagerAuthLost] = useState(false)
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

  const handleDifficultyChange = (difficulty: JavaFormatDifficulty) => {
    if (sessionId == null || managerAuthLostRef.current) return;
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
    if (sessionId == null || managerAuthLostRef.current) return;
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
    setStudents([]);
    rosterUpdateGenRef.current += 1;
    // Invalidate any outstanding poll's ownership and free the slot for the new session.
    pollTokenRef.current += 1;
    pollInFlightRef.current = 0;
    activeSocketRef.current = null;
  }, [sessionId]);

  const fetchStudents = useCallback(async (signal?: AbortSignal) => {
    if (sessionId == null || managerAuthLostRef.current || pollInFlightRef.current !== 0) return;
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
  }, [sessionId, markManagerAuthLost]);

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
    shouldReconnect: sessionId != null,
    onOpen: handleWsOpen,
    onMessage: handleWsMessage,
    onClose: handleWsClose,
    onError: handleWsError,
    isTerminalClose: isTerminalManagerSocketClose,
  });

  useEffect(() => {
    if (sessionId == null) return undefined;
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
  }, [sessionId, fetchStudents, connect, disconnect]);

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
          <span>
            This manager session is no longer authenticated. Reload the page to
            reconnect, or start a new session if the problem persists.
          </span>
          <Button onClick={() => window.location.reload()}>Reload</Button>
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
                disabled={managerAuthLost}
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
                disabled={managerAuthLost}
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
