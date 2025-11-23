import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { arrayToCsv, downloadCsv } from '@src/utils/csvUtils';
import Button from '@src/components/ui/Button';
import SessionHeader from '@src/components/common/SessionHeader';
import ActivityRoster from '@src/components/common/ActivityRoster';

/**
 * JavaStringPracticeManager - Teacher view for managing the Java String Practice activity
 * Displays student roster and their progress statistics
 */
export default function JavaStringPracticeManager() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  
  const [students, setStudents] = useState([]);
  const [selectedMethods, setSelectedMethods] = useState(new Set(['all']));
  const [sortBy, setSortBy] = useState('name'); // 'name', 'total', 'correct', 'accuracy', 'streak'
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc' or 'desc'

  // Available method types
  const methodTypes = [
    { id: 'all', label: 'All Methods' },
    { id: 'substring', label: 'substring()' },
    { id: 'indexOf', label: 'indexOf()' },
    { id: 'equals', label: 'equals()' },
    { id: 'length', label: 'length()' },
    { id: 'compareTo', label: 'compareTo()' },
  ];

  const handleMethodToggle = (methodId) => {
    const newMethods = new Set(selectedMethods);
    
    if (methodId === 'all') {
      // Clicking "All Methods" - select only it
      newMethods.clear();
      newMethods.add('all');
    } else {
      // Clicking a specific method
      // First remove "all" if it's selected
      if (newMethods.has('all')) {
        newMethods.clear();
      }
      
      // Toggle the clicked method
      if (newMethods.has(methodId)) {
        newMethods.delete(methodId);
      } else {
        newMethods.add(methodId);
      }
      
      // If no methods selected, revert to "all"
      if (newMethods.size === 0) {
        newMethods.add('all');
      }
    }
    
    setSelectedMethods(newMethods);
    
    // Send selected methods to server
    fetch(`/api/java-string-practice/${sessionId}/methods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ methods: Array.from(newMethods) }),
    }).catch(err => {
      console.error('Failed to update methods:', err);
    });
  };

  useEffect(() => {
    if (!sessionId) return;

    // Fetch students initially
    const fetchStudents = async () => {
      try {
        const res = await fetch(`/api/java-string-practice/${sessionId}/students`);
        if (!res.ok) throw new Error('Failed to fetch students');
        const data = await res.json();
        setStudents(data.students || []);
      } catch (err) {
        console.error('Failed to fetch students:', err);
      }
    };

    fetchStudents();

    // Set up WebSocket for real-time updates
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/java-string-practice?sessionId=${sessionId}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('Manager WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Manager received message:', message);
        if (message.type === 'studentsUpdate') {
          console.log('Updating students:', message.payload.students);
          setStudents(message.payload.students || []);
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onerror = (error) => {
      console.error('Manager WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('Manager WebSocket disconnected');
    };

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [sessionId]);

  const handleSort = (column) => {
    if (sortBy === column) {
      // Toggle direction if clicking same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default direction
      setSortBy(column);
      // Name defaults to ascending, all numeric columns default to descending
      setSortDirection(column === 'name' ? 'asc' : 'desc');
    }
  };

  const getSortedStudents = () => {
    const sorted = [...students].sort((a, b) => {
      let aVal, bVal;
      
      switch (sortBy) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'total':
          aVal = a.stats?.total || 0;
          bVal = b.stats?.total || 0;
          break;
        case 'correct':
          aVal = a.stats?.correct || 0;
          bVal = b.stats?.correct || 0;
          break;
        case 'accuracy':
          aVal = (a.stats?.total || 0) > 0 ? (a.stats.correct / a.stats.total) : 0;
          bVal = (b.stats?.total || 0) > 0 ? (b.stats.correct / b.stats.total) : 0;
          break;
        case 'streak':
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
    
    return sorted;
  };

  const downloadCSV = () => {
    const sorted = getSortedStudents();
    
    // CSV headers
    const headers = ['Student Name', 'Total Attempts', 'Correct', 'Accuracy %', 'Longest Streak'];
    
    // CSV rows
    const rows = sorted.map(student => [
      student.name,
      student.stats?.total || 0,
      student.stats?.correct || 0,
      (student.stats?.total || 0) > 0
        ? Math.round(((student.stats?.correct || 0) / student.stats.total) * 100)
        : 0,
      student.stats?.longestStreak || 0,
    ]);
    
    const csvContent = arrayToCsv([headers, ...rows]);
    const filename = `java-string-practice-${sessionId}-${new Date().toISOString().slice(0, 10)}`;
    downloadCsv(csvContent, filename);
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
    <div>
      <SessionHeader 
        activityName="Java String Practice Session"
        sessionId={sessionId}
      />
      
      <div className="p-6">
        <div className="max-w-4xl mx-auto">
          {/* Method Selection */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h3 className="text-xl font-semibold mb-4">Select Methods to Practice</h3>
            <div className="flex flex-wrap gap-2">
              {methodTypes.map(method => (
                <button
                  key={method.id}
                  onClick={() => handleMethodToggle(method.id)}
                  className={`px-4 py-2 rounded transition-colors ${
                    selectedMethods.has(method.id)
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                  }`}
                >
                  {method.label}
                </button>
              ))}
            </div>
          </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xl font-semibold">Student Progress</h3>
              <p className="text-sm text-gray-600 mt-1">
                {students.filter(s => s.connected).length} connected / {students.length} total students
              </p>
            </div>
            <Button onClick={downloadCSV} variant="outline">
              📊 Download Report
            </Button>
          </div>
          
          <ActivityRoster
            students={getSortedStudents()}
            accent="neutral"
            columns={[
              {
                id: 'name',
                label: 'Student',
                render: (s) => (
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${s.connected ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                    <span className="font-medium">{s.name}</span>
                  </div>
                ),
              },
              { id: 'total', label: 'Total Attempts', align: 'center', render: (s) => s.stats?.total || 0 },
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
              { id: 'streak', label: 'Longest Streak', align: 'center', render: (s) => s.stats?.longestStreak || 0 },
            ]}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSort={handleSort}
            emptyMessage="No students have joined yet. Share the join code above."
          />
        </div>
      </div>
      </div>
    </div>
  );
}
