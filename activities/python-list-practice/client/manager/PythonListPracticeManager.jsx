import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SessionHeader from '@src/components/common/SessionHeader';
import Button from '@src/components/ui/Button';

const POLL_INTERVAL_MS = 4000;

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

  useEffect(() => {
    let active = true;
    let timer;

    const fetchStudents = () => {
      if (!sessionId) return;
      fetch(`/api/python-list-practice/${sessionId}/students`)
        .then((res) => {
          if (!res.ok) throw new Error('Failed to fetch students');
          return res.json();
        })
        .then((data) => {
          if (!active) return;
          setStudents(data.students || []);
          setError(null);
          setLoading(false);
        })
        .catch((err) => {
          if (!active) return;
          setError(err.message || 'Failed to load students');
          setLoading(false);
        })
        .finally(() => {
          timer = setTimeout(fetchStudents, POLL_INTERVAL_MS);
        });
    };

    fetchStudents();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
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
    <div className="p-6 max-w-5xl mx-auto">
      <SessionHeader activityName="Python List Practice" sessionId={sessionId} onEndSession={endSession} />

      <div className="bg-white rounded-lg shadow p-4 mb-4 border border-gray-200">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-lg font-semibold">{stats.connected} connected</div>
            <div className="text-sm text-gray-600">{stats.totalStudents} total students</div>
          </div>
          <Button variant="outline" onClick={() => downloadCsv(students)}>
            📊 Download CSV
          </Button>
          {error && <div className="text-red-600 text-sm">{error}</div>}
          {loading && <div className="text-sm text-gray-600">Loading…</div>}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b">
            <tr>
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
                <td className="px-4 py-3 text-center text-gray-500" colSpan={7}>
                  No students yet. Share the join code above.
                </td>
              </tr>
            )}
            {students.map((s) => {
              const total = s.stats?.total || 0;
              const correct = s.stats?.correct || 0;
              const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
              return (
                <tr key={s.id || s.name} className="border-b last:border-b-0">
                  <td className="px-4 py-3">{s.name}</td>
                  <td className="px-4 py-3 text-center">{total}</td>
                  <td className="px-4 py-3 text-center">{correct}</td>
                  <td className="px-4 py-3 text-center">{accuracy}%</td>
                  <td className="px-4 py-3 text-center">{s.stats?.streak || 0}</td>
                  <td className="px-4 py-3 text-center">{s.stats?.longestStreak || 0}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block w-3 h-3 rounded-full ${s.connected ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
