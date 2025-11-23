import React, { useEffect, useMemo, useRef, useState } from 'react';
import Button from '@src/components/ui/Button';
import '../styles.css';

const WORD_LISTS = [
  ['apple', 'banana', 'cherry', 'date'],
  ['red', 'green', 'blue', 'yellow', 'purple'],
  ['cat', 'dog', 'bird', 'fish'],
];

const NUMBER_LISTS = [
  [2, 4, 6, 8, 10],
  [5, 1, 3, 7, 9],
  [10, 20, 30, 40],
];

const OPERATIONS = [
  'index-get',
  'index-set',
  'len',
  'append',
  'remove',
  'insert',
  'pop',
  'for-range',
  'for-each',
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatList(list) {
  return `[${list.map((v) => (typeof v === 'string' ? `'${v}'` : v)).join(', ')}]`;
}

function generateChallenge() {
  const useWords = Math.random() < 0.5;
  const baseList = [...randomItem(useWords ? WORD_LISTS : NUMBER_LISTS)];
  const op = randomItem(OPERATIONS);

  switch (op) {
    case 'index-get': {
      const idx = Math.floor(Math.random() * baseList.length);
      return {
        prompt: `Given list = ${formatList(baseList)}, what is list[${idx}]?`,
        expected: String(baseList[idx]),
        type: 'value',
      };
    }
    case 'index-set': {
      const idx = Math.floor(Math.random() * baseList.length);
      const newVal = useWords ? randomItem(WORD_LISTS.flat()) : Math.floor(Math.random() * 20);
      const mutated = [...baseList];
      mutated[idx] = newVal;
      return {
        prompt: `Starting with list = ${formatList(baseList)}, after running "list[${idx}] = ${typeof newVal === 'string' ? `'${newVal}'` : newVal}", what is list[${idx}] now?`,
        expected: String(newVal),
        type: 'value',
      };
    }
    case 'len': {
      return {
        prompt: `What is len(${formatList(baseList)})?`,
        expected: String(baseList.length),
        type: 'number',
      };
    }
    case 'append': {
      const toAppend = useWords ? randomItem(WORD_LISTS.flat()) : Math.floor(Math.random() * 20);
      return {
        prompt: `list = ${formatList(baseList)}; list.append(${typeof toAppend === 'string' ? `'${toAppend}'` : toAppend}); What is len(list) now?`,
        expected: String(baseList.length + 1),
        type: 'number',
      };
    }
    case 'remove': {
      const val = randomItem(baseList);
      return {
        prompt: `list = ${formatList(baseList)}; list.remove(${typeof val === 'string' ? `'${val}'` : val}); What is len(list) now?`,
        expected: String(Math.max(0, baseList.length - 1)),
        type: 'number',
      };
    }
    case 'insert': {
      const idx = Math.floor(Math.random() * (baseList.length + 1));
      const val = useWords ? randomItem(WORD_LISTS.flat()) : Math.floor(Math.random() * 20);
      return {
        prompt: `list = ${formatList(baseList)}; list.insert(${idx}, ${typeof val === 'string' ? `'${val}'` : val}); What is len(list) now?`,
        expected: String(baseList.length + 1),
        type: 'number',
      };
    }
    case 'pop': {
      if (baseList.length === 0) {
        baseList.push(useWords ? 'x' : 0);
      }
      return {
        prompt: `list = ${formatList(baseList)}; x = list.pop(); What value is returned?`,
        expected: String(baseList[baseList.length - 1]),
        type: 'value',
      };
    }
    case 'for-range': {
      const start = Math.floor(Math.random() * 3);
      const stop = start + Math.floor(Math.random() * 4) + 2; // at least 2 numbers
      return {
        prompt: `What numbers are printed?\nfor i in range(${start}, ${stop}):\n    print(i)\n(Enter as comma-separated values)`,
        expected: Array.from({ length: stop - start }, (_, i) => start + i).join(','),
        type: 'list',
      };
    }
    case 'for-each':
    default: {
      return {
        prompt: `What values are printed?\nlist = ${formatList(baseList)}\nfor item in list:\n    print(item)\n(Enter as comma-separated values)`,
        expected: baseList.map(String).join(','),
        type: 'list',
      };
    }
  }
}

function sanitizeName(name) {
  if (!name) return null;
  const trimmed = name.trim().slice(0, 50);
  if (!trimmed) return null;
  return trimmed;
}

export default function PythonListPractice({ sessionData }) {
  const [studentName, setStudentName] = useState('');
  const [submittedName, setSubmittedName] = useState(null);
  const wsRef = useRef(null);
  const [challenge, setChallenge] = useState(generateChallenge());
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [stats, setStats] = useState({ total: 0, correct: 0, streak: 0, longestStreak: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const nameRef = useRef(null);

  const sessionId = sessionData?.sessionId;

  useEffect(() => {
    if (nameRef.current) {
      nameRef.current.focus();
    }
  }, []);

  // Connect to WebSocket after name submit to mark student as connected (for roster)
  useEffect(() => {
    if (!sessionId || !submittedName) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/python-list-practice?sessionId=${encodeURIComponent(sessionId)}&studentName=${encodeURIComponent(submittedName)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      // send a zeroed stats payload on connect so the dashboard sees the student immediately
      sendStats(stats);
    };
    ws.onerror = (err) => console.error('WS error', err);
    return () => {
      ws.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, submittedName]);

  const normalizedExpected = useMemo(() => {
    if (challenge.type === 'list') return challenge.expected.replace(/\s+/g, '');
    return challenge.expected.trim();
  }, [challenge]);

  const submitName = (e) => {
    e.preventDefault();
    const sanitized = sanitizeName(studentName);
    if (!sanitized) {
      setError('Enter a valid name');
      return;
    }
    setSubmittedName(sanitized);
    setError(null);
  };

  const sendStats = async (nextStats) => {
    if (!sessionId || !submittedName) return;
    try {
      await fetch(`/api/python-list-practice/${sessionId}/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentName: submittedName, stats: nextStats }),
      });
    } catch (err) {
      console.error('Failed to send stats', err);
    }
  };

  const checkAnswer = () => {
    const cleaned = challenge.type === 'list' ? answer.replace(/\s+/g, '') : answer.trim();
    const isCorrect = cleaned.length > 0 && cleaned === normalizedExpected;
    const nextStats = {
      total: stats.total + 1,
      correct: stats.correct + (isCorrect ? 1 : 0),
      streak: isCorrect ? stats.streak + 1 : 0,
      longestStreak: isCorrect ? Math.max(stats.longestStreak, stats.streak + 1) : stats.longestStreak,
    };
    setStats(nextStats);
    setFeedback(isCorrect ? 'Correct! 🎉' : `Not quite. Expected: ${challenge.expected}`);
    sendStats(nextStats);
    setAnswer('');
    setChallenge(generateChallenge());
  };

  if (!sessionId) {
    return <div className="p-6 text-center text-gray-700">Missing session.</div>;
  }

  if (!submittedName) {
    return (
      <div className="python-list-bg flex items-center justify-center px-4">
        <div className="python-list-join">
          <h1 className="text-2xl font-bold mb-4 text-center text-emerald-900">Join Python List Practice</h1>
          <p className="text-sm text-emerald-800 text-center mb-4">
            Practice indexing, loops, len, append/remove/insert/pop, and range.
          </p>
          <form onSubmit={submitName} className="space-y-3">
            <label className="python-list-label">
              Your Name
              <input
                ref={nameRef}
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                className="python-list-input mt-1"
                placeholder="Enter your name"
                required
              />
            </label>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
              Start Practicing
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="python-list-bg">
      <div className="python-list-container">
        <div className="python-list-header">
          <div className="python-list-title">Python List Practice</div>
          <div className="python-list-subtitle">Welcome, {submittedName} — Session {sessionId}</div>
          <div className="python-list-stats">
            <div className="python-list-stat">Total: {stats.total}</div>
            <div className="python-list-stat">Correct: {stats.correct}</div>
            <div className="python-list-stat">Streak: {stats.streak}</div>
          </div>
        </div>

        <div className="python-list-content">
          <div className="python-list-card">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 text-emerald-800 font-bold">?</span>
              <p className="text-sm text-emerald-900">Answer the prompt using Python list reasoning.</p>
            </div>
            <div className="python-list-prompt">{challenge.prompt}</div>
          </div>

          <div className="python-list-card">
            <label className="python-list-label">
              Your Answer
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                className="python-list-input mt-1"
                placeholder="Type your answer (comma-separated for multiple values)"
              />
            </label>
            <div className="flex gap-2 mt-3">
              <Button onClick={checkAnswer} disabled={loading || !answer.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                Submit
              </Button>
              <Button variant="outline" onClick={() => setAnswer('')} className="border-emerald-300 text-emerald-800 hover:bg-emerald-50">
                Clear
              </Button>
            </div>
            {feedback && <div className="python-list-feedback">{feedback}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
