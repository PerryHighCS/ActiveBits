import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Button from '@src/components/ui/Button';

/**
 * JavaStringPracticeManager - Teacher view for managing the Java String Practice activity
 * Displays student roster and their progress statistics
 */
export default function JavaStringPracticeManager() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  
  const [students, setStudents] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId) return;

    // TODO: Poll for student data when backend is ready
    // For now, show placeholder message
    setError('Backend integration pending - students will practice locally');
    
    // Stub for future implementation:
    // const fetchStudents = async () => {
    //   try {
    //     const res = await fetch(`/api/java-string-practice/${sessionId}/students`);
    //     if (!res.ok) throw new Error('Failed to fetch students');
    //     const data = await res.json();
    //     setStudents(data.students || []);
    //   } catch (err) {
    //     console.error(err);
    //     setError(err.message);
    //   }
    // };
    // fetchStudents();
    // const interval = setInterval(fetchStudents, 3000);
    // return () => clearInterval(interval);
  }, [sessionId]);

  const deleteSession = async () => {
    if (!confirm('Are you sure you want to delete this session?')) return;
    
    try {
      const res = await fetch(`/api/session/${sessionId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete session');
      navigate('/manage');
    } catch (err) {
      console.error(err);
      alert('Failed to delete session');
    }
  };

  if (!sessionId) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-600 mb-4">No session ID provided</p>
        <Button onClick={() => navigate('/manage')}>Return to Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold">Java String Practice Session</h2>
            <p className="text-gray-600">Session ID: <strong>{sessionId}</strong></p>
          </div>
          <Button onClick={deleteSession} variant="text" className="text-red-600">
            ❌ Delete Session
          </Button>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-xl font-semibold mb-4">Student Progress</h3>
          
          {students.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No students have joined yet. Share the session ID: <strong>{sessionId}</strong>
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-4">Student</th>
                    <th className="text-center py-2 px-4">Total Attempts</th>
                    <th className="text-center py-2 px-4">Correct</th>
                    <th className="text-center py-2 px-4">Accuracy</th>
                    <th className="text-center py-2 px-4">Current Streak</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.name} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium">{student.name}</td>
                      <td className="py-3 px-4 text-center">{student.total}</td>
                      <td className="py-3 px-4 text-center">{student.correct}</td>
                      <td className="py-3 px-4 text-center">
                        {student.total > 0
                          ? Math.round((student.correct / student.total) * 100)
                          : 0}%
                      </td>
                      <td className="py-3 px-4 text-center">{student.streak}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-semibold mb-2">Instructions for Students:</h4>
          <ol className="list-decimal list-inside space-y-1 text-sm">
            <li>Go to the main site and enter session ID: <strong>{sessionId}</strong></li>
            <li>Enter your name to start practicing</li>
            <li>Complete interactive challenges for Java String methods</li>
            <li>Methods covered: substring(), indexOf(), equals(), length(), compareTo()</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
