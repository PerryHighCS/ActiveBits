import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SessionHeader from '@src/components/common/SessionHeader';
import Button from '@src/components/ui/Button';
import ActivityRoster from '@src/components/common/ActivityRoster';
import '../styles.css';

const QUESTION_TYPES = [
  { id: 'all', label: 'All Skills' },
  { id: 'index-get', label: 'Index (read)' },
  { id: 'index-set', label: 'Index (write)' },
  { id: 'len', label: 'len(list)' },
  { id: 'append', label: 'append()' },
  { id: 'remove', label: 'remove()' },
  { id: 'insert', label: 'insert()' },
  { id: 'pop', label: 'pop()' },
  { id: 'for-range', label: 'for range loop' },
  { id: 'range-len', label: 'range(len(list))' },
  { id: 'for-each', label: 'for each loop' },
];

function downloadCsv(students) {
  const headers = ['Student Name', 'Total Attempts', 'Correct', 'Accuracy %', 'Current Streak', 'Longest Streak'];
  const rows = students.map((s) => {
    const total = s.stats?.total || 0;
    const correct = s.stats?.correct || 0;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    return [
      s.name || '',
      total,
      correct,
      accuracy,
      s.stats?.streak || 0,
      s.stats?.longestStreak || 0,
    ];
  });
  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `python-list-practice-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PythonListPracticeManager() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTypes, setSelectedTypes] = useState(new Set(['all']));
  const [sortBy, setSortBy] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const wsRef = useRef(null);

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;

    const loadSession = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/python-list-practice/${sessionId}`);
        if (!res.ok) throw new Error('Failed to fetch session');
        const data = await res.json();
        if (cancelled) return;
        setStudents(data.students || []);
        setSelectedTypes(new Set(data.selectedQuestionTypes || ['all']));
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load session');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadSession();

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/python-list-practice?sessionId=${sessionId}`;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'studentsUpdate') {
          setStudents(msg.payload?.students || []);
          setLoading(false);
        } else if (msg.type === 'questionTypesUpdate') {
          setSelectedTypes(new Set(msg.payload?.selectedQuestionTypes || ['all']));
        }
      } catch (e) {
        console.error('WS parse error', e);
      }
    };
    socket.onerror = () => setError('WebSocket error');

    return () => {
      cancelled = true;
      socket.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  const persistQuestionTypes = (nextSet) => {
    fetch(`/api/python-list-practice/${sessionId}/question-types`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ types: Array.from(nextSet) }),
    }).catch((err) => {
      console.error('Failed to update question types', err);
      setError('Failed to update question types');
    });
  };

  const handleToggleType = (typeId) => {
    if (!sessionId) return;
    const next = new Set(selectedTypes);
    if (typeId === 'all') {
      next.clear();
      next.add('all');
    } else {
      if (next.has('all')) {
        next.clear();
      }
      if (next.has(typeId)) {
        next.delete(typeId);
      } else {
        next.add(typeId);
      }
      if (next.size === 0) {
        next.add('all');
      }
    }
    setSelectedTypes(next);
    persistQuestionTypes(next);
  };

  const stats = useMemo(() => {
    const totalStudents = students.length;
    const connected = students.filter((s) => s.connected).length;
    return { totalStudents, connected };
  }, [students]);

  const sortedStudents = useMemo(() => {
    const sortable = [...students];
    sortable.sort((a, b) => {
      let aVal;
      let bVal;

      switch (sortBy) {
        case 'name':
          aVal = (a.name || '').toLowerCase();
          bVal = (b.name || '').toLowerCase();
          break;
        case 'total':
          aVal = a.stats?.total || 0;
          bVal = b.stats?.total || 0;
          break;
        case 'correct':
          aVal = a.stats?.correct || 0;
          bVal = b.stats?.correct || 0;
          break;
        case 'accuracy': {
          const aTotal = a.stats?.total || 0;
          const bTotal = b.stats?.total || 0;
          aVal = aTotal > 0 ? (a.stats?.correct || 0) / aTotal : 0;
          bVal = bTotal > 0 ? (b.stats?.correct || 0) / bTotal : 0;
          break;
        }
        case 'streak':
          aVal = a.stats?.streak || 0;
          bVal = b.stats?.streak || 0;
          break;
        case 'longestStreak':
          aVal = a.stats?.longestStreak || 0;
          bVal = b.stats?.longestStreak || 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sortable;
  }, [students, sortBy, sortDirection]);

  const handleSort = (columnId) => {
    if (sortBy === columnId) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(columnId);
      setSortDirection(columnId === 'name' ? 'asc' : 'desc');
    }
  };

  const endSession = async () => {
    if (!sessionId) return;
    await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
    navigate('/manage');
  };

  return (
    <div className="python-list-manager">
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <SessionHeader activityName="Python List Practice" sessionId={sessionId} onEndSession={endSession} />

        <div className="python-list-card" style={{ marginTop: 0 }}>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="text-lg font-semibold text-emerald-900">{stats.connected} connected</div>
              <div className="text-sm text-emerald-800">{stats.totalStudents} total students</div>
            </div>
            <Button variant="outline" onClick={() => downloadCsv(sortedStudents)} className="border-emerald-300 text-emerald-800 hover:bg-emerald-50">
              📊 Download CSV
            </Button>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            {loading && <div className="text-sm text-emerald-700">Loading…</div>}
          </div>
        </div>

        <div className="python-list-card">
          <h3 className="text-lg font-semibold text-emerald-900 mb-2">Select question types to practice</h3>
          <p className="text-sm text-emerald-800 mb-3">Students will only see the skills you enable.</p>
          <div className="flex flex-wrap gap-2">
            {QUESTION_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => handleToggleType(type.id)}
                className={`python-list-chip ${selectedTypes.has(type.id) ? 'selected' : ''}`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        <ActivityRoster
          accent="emerald"
          students={sortedStudents}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSort={handleSort}
          columns={[
            { id: 'name', label: 'Student', render: (s) => (
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${s.connected ? 'bg-emerald-500' : 'bg-gray-300'}`}></span>
                <span className="font-medium">{s.name}</span>
              </div>
            ) },
            { id: 'total', label: 'Total', align: 'center', render: (s) => s.stats?.total || 0 },
            { id: 'correct', label: 'Correct', align: 'center', render: (s) => s.stats?.correct || 0 },
            {
              id: 'accuracy',
              label: 'Accuracy',
              align: 'center',
              render: (s) => {
                const total = s.stats?.total || 0;
                const correct = s.stats?.correct || 0;
                return total > 0 ? `${Math.round((correct / total) * 100)}%` : '0%';
              },
            },
            { id: 'streak', label: 'Streak', align: 'center', render: (s) => s.stats?.streak || 0 },
            { id: 'longestStreak', label: 'Longest Streak', align: 'center', render: (s) => s.stats?.longestStreak || 0 },
            
          ]}
          loading={loading}
          error={error}
          emptyMessage="No students yet. Share the join code above."
        />
      </div>
    </div>
  );
}
