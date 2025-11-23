import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SessionHeader from '@src/components/common/SessionHeader';
import Button from '@src/components/ui/Button';
import ActivityRoster from '@src/components/common/ActivityRoster';
import '../styles.css';

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
  const wsRef = useRef(null);

  useEffect(() => {
    if (!sessionId) return;
    // Initial fetch for server state
    fetch(`/api/python-list-practice/${sessionId}/students`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch students');
        return res.json();
      })
      .then((data) => {
        setStudents(data.students || []);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load students');
        setLoading(false);
      });

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
        }
      } catch (e) {
        console.error('WS parse error', e);
      }
    };
    socket.onerror = () => setError('WebSocket error');

    return () => {
      socket.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  const stats = useMemo(() => {
    const totalStudents = students.length;
    const connected = students.filter((s) => s.connected).length;
    return { totalStudents, connected };
  }, [students]);

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
            <Button variant="outline" onClick={() => downloadCsv(students)} className="border-emerald-300 text-emerald-800 hover:bg-emerald-50">
              📊 Download CSV
            </Button>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            {loading && <div className="text-sm text-emerald-700">Loading…</div>}
          </div>
        </div>

        <ActivityRoster
          accent="emerald"
          students={students}
          columns={[
            { id: 'name', label: 'Student' },
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
            { id: 'connected', label: 'Connected', align: 'center', render: (s) => <span className={`inline-block w-3 h-3 rounded-full ${s.connected ? 'bg-emerald-500' : 'bg-gray-300'}`} /> },
          ]}
          loading={loading}
          error={error}
          emptyMessage="No students yet. Share the join code above."
        />
      </div>
    </div>
  );
}
