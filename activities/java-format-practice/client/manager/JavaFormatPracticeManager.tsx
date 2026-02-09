import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
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
  const { sessionId } = useParams<{ sessionId: string }>();

  const [students, setStudents] = useState<JavaFormatStudentRecord[]>([])
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

  const handleDifficultyChange = (difficulty: JavaFormatDifficulty) => {
    setSelectedDifficulty(difficulty);

    // Send selected difficulty to server
    fetch(`/api/java-format-practice/${sessionId}/difficulty`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty }),
    }).catch((err) => {
      console.error('Failed to update difficulty:', err);
    });
  };

  const handleThemeChange = (theme: JavaFormatTheme) => {
    setSelectedTheme(theme);

    // Send selected theme to server
    fetch(`/api/java-format-practice/${sessionId}/theme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    }).catch((err) => {
      console.error('Failed to update theme:', err);
    });
  };

  const fetchStudents = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/java-format-practice/${sessionId}/students`);
      if (!res.ok) throw new Error('Failed to fetch students');
      const data = (await res.json()) as StudentsResponse
      const list = Array.isArray(data.students) ? data.students : [];
      setStudents(list);
    } catch (err) {
      console.error('Failed to fetch students:', err);
    }
  }, [sessionId]);

  const handleWsMessage = useCallback((event: MessageEvent<string>) => {
    try {
      const message = JSON.parse(event.data) as ManagerWsMessage
      console.log('Manager received message:', message);
      if (message.type === 'studentsUpdate') {
        console.log('Updating students:', message.payload?.students);
        const list = Array.isArray(message.payload?.students) ? message.payload.students : [];
        setStudents(list);
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  }, []);

  const handleWsOpen = useCallback(() => {
    console.log('Manager WebSocket connected');
    void fetchStudents();
  }, [fetchStudents]);

  const handleWsError = useCallback((error: unknown) => {
    console.error('WebSocket error:', error);
  }, []);

  const handleWsClose = useCallback(() => {
    console.log('Manager WebSocket disconnected');
  }, []);

  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws/java-format-practice?sessionId=${sessionId}`;
  }, [sessionId]);

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId),
    onOpen: handleWsOpen,
    onMessage: handleWsMessage,
    onError: handleWsError,
    onClose: handleWsClose,
  });

  useEffect(() => {
    if (!sessionId) return undefined;
    void fetchStudents();
    void connect();
    return () => {
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

  const sortedStudents = [...students].sort((a, b) => {
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

  return (
    <div style={styles.container}>
      <SessionHeader
        activityName="Java Format Practice"
        sessionId={sessionId}
      />

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
