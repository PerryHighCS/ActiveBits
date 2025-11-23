import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SessionHeader from '@src/components/common/SessionHeader';
import Button from '@src/components/ui/Button';

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
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-emerald-100">
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <SessionHeader activityName="Python List Practice" sessionId={sessionId} onEndSession={endSession} />

        <div className="bg-white/90 border border-emerald-200 shadow rounded-xl p-4">
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

        <div className="bg-white/95 border border-emerald-200 shadow-lg rounded-xl overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-emerald-50 border-b border-emerald-100">
              <tr className="text-emerald-900">
                <th className="px-4 py-2">Student</th>
                <th className="px-4 py-2 text-center">Total</th>
                <th className="px-4 py-2 text-center">Correct</th>
                <th className="px-4 py-2 text-center">Accuracy</th>
                <th className="px-4 py-2 text-center">Streak</th>
                <th className="px-4 py-2 text-center">Longest Streak</th>
                <th className="px-4 py-2 text-center">Connected</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-center text-emerald-700" colSpan={7}>
                    No students yet. Share the join code above.
                  </td>
                </tr>
              )}
              {students.map((s) => {
                const total = s.stats?.total || 0;
                const correct = s.stats?.correct || 0;
                const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
                return (
                  <tr key={s.id || s.name} className="border-b last:border-b-0 border-emerald-100">
                    <td className="px-4 py-3 text-emerald-900">{s.name}</td>
                    <td className="px-4 py-3 text-center text-emerald-900">{total}</td>
                    <td className="px-4 py-3 text-center text-emerald-900">{correct}</td>
                    <td className="px-4 py-3 text-center text-emerald-900">{accuracy}%</td>
                    <td className="px-4 py-3 text-center text-emerald-900">{s.stats?.streak || 0}</td>
                    <td className="px-4 py-3 text-center text-emerald-900">{s.stats?.longestStreak || 0}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block w-3 h-3 rounded-full ${s.connected ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
