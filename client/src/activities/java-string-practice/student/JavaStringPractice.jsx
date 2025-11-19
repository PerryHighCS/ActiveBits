import React, { useState, useEffect, useRef, useCallback } from 'react';
import Button from '@src/components/ui/Button';
import '../components/styles.css';
import ChallengeSelector from '../components/ChallengeSelector';
import StringDisplay from '../components/StringDisplay';
import AnswerSection from '../components/AnswerSection';
import FeedbackDisplay from '../components/FeedbackDisplay';
import StatsPanel from '../components/StatsPanel';
import ChallengeQuestion from '../components/ChallengeQuestion';
import { generateChallenge, validateAnswer, getExplanation } from '../components/challengeLogic';

/**
 * JavaStringPractice - Student view for practicing Java String methods
 * Interactive challenges for substring(), indexOf(), equals(), length(), and compareTo()
 */
export default function JavaStringPractice({ sessionData }) {
  const sessionId = sessionData?.sessionId;
  const initializedRef = useRef(false);
  
  const [studentName, setStudentName] = useState('');
  const [studentId, setStudentId] = useState(null); // Unique student ID
  const [nameSubmitted, setNameSubmitted] = useState(false);
  const [currentChallenge, setCurrentChallenge] = useState(null);
  const [selectedTypes, setSelectedTypes] = useState(new Set(['all']));
  const [allowedMethods, setAllowedMethods] = useState(new Set(['all'])); // Methods allowed by teacher
  const [userAnswer, setUserAnswer] = useState('');
  const [selectedIndices, setSelectedIndices] = useState([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionType, setSelectionType] = useState(null); // 'letter' or 'index'
  const [feedback, setFeedback] = useState(null);
  const [hintShown, setHintShown] = useState(false);
  const [visualHintShown, setVisualHintShown] = useState(false);
  
  const [stats, setStats] = useState({
    total: 0,
    correct: 0,
    streak: 0,
    longestStreak: 0,
  });

  // Helper function to reset all challenge-related state
  // Extracted to avoid duplication across multiple handlers
  const resetChallengeState = useCallback(() => {
    setUserAnswer('');
    setSelectedIndices([]);
    setIsSelecting(false);
    setSelectionType(null);
    setFeedback(null);
    setHintShown(false);
    setVisualHintShown(false);
  }, []);

  // Check for saved student name and ID
  useEffect(() => {
    if (sessionId.startsWith('solo-')) {
      setStudentName('Solo Student');
      setNameSubmitted(true);
      return;
    }

    const savedName = localStorage.getItem(`student-name-${sessionId}`);
    const savedId = localStorage.getItem(`student-id-${sessionId}`);
    if (savedName) {
      setStudentName(savedName);
      setStudentId(savedId);
      setNameSubmitted(true);
    }
  }, [sessionId]);

  // Fetch allowed methods from server (teacher's selection)
  useEffect(() => {
    if (!nameSubmitted) return; // Wait for name to be submitted
    
    if (sessionId.startsWith('solo-')) {
      // Solo mode - allow all methods
      setAllowedMethods(new Set(['all']));
      return;
    }

    // Fetch initial methods
    const fetchAllowedMethods = async () => {
      try {
        const res = await fetch(`/api/java-string-practice/${sessionId}`);
        if (!res.ok) throw new Error('Failed to fetch session');
        const data = await res.json();
        const methods = data.selectedMethods || ['all'];
        setAllowedMethods(new Set(methods));
        setSelectedTypes(new Set(methods));
      } catch (err) {
        console.error('Failed to fetch allowed methods:', err);
      }
    };

    fetchAllowedMethods();

    // Set up WebSocket for real-time updates
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const studentIdParam = studentId ? `&studentId=${encodeURIComponent(studentId)}` : '';
    const wsUrl = `${protocol}//${host}/ws/java-string-practice?sessionId=${sessionId}&studentName=${encodeURIComponent(studentName)}${studentIdParam}`;
    console.log('Connecting to WebSocket:', wsUrl);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected for session:', sessionId);
    };

    ws.onmessage = (event) => {
      console.log('WebSocket message received:', event.data);
      try {
        const message = JSON.parse(event.data);
        console.log('Parsed message:', message);
        if (message.type === 'studentId') {
          // Store the unique student ID
          const newStudentId = message.payload.studentId;
          setStudentId(newStudentId);
          localStorage.setItem(`student-id-${sessionId}`, newStudentId);
          console.log('Received student ID:', newStudentId);
        } else if (message.type === 'methodsUpdate') {
          const methods = message.payload.selectedMethods || ['all'];
          console.log('Updating methods to:', methods);
          setAllowedMethods(new Set(methods));
          setSelectedTypes(new Set(methods));
          // Generate new challenge with updated methods
          const challenge = generateChallenge(new Set(methods));
          setCurrentChallenge(challenge);
          resetChallengeState();
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected for session:', sessionId);
    };

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [sessionId, nameSubmitted, studentName, studentId, resetChallengeState]);

  // Load saved stats from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(`java-string-stats-${sessionId}`);
    if (saved) {
      try {
        setStats(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load stats', e);
      }
    }
  }, [sessionId]);

  // Save stats to localStorage whenever they change
  useEffect(() => {
    if (stats.total > 0) {
      localStorage.setItem(`java-string-stats-${sessionId}`, JSON.stringify(stats));
      
      // Send progress to server for teacher-managed sessions
      if (!sessionId.startsWith('solo-') && nameSubmitted) {
        fetch(`/api/java-string-practice/${sessionId}/progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentName, studentId, stats }),
        }).catch(err => console.error('Failed to send progress:', err));
      }
    }
  }, [stats, sessionId, studentName, studentId, nameSubmitted]);

  // Generate a new challenge with the current selected types
  // Wrapped in useCallback for stable reference in dependency arrays
  const handleNewChallenge = useCallback(() => {
    const challenge = generateChallenge(selectedTypes);
    setCurrentChallenge(challenge);
    resetChallengeState();
  }, [selectedTypes, resetChallengeState]);

  // Handle method type selection (solo mode only)
  const handleTypeSelection = useCallback((type) => {
    const newTypes = new Set(selectedTypes);
    
    if (type === 'all') {
      newTypes.clear();
      newTypes.add('all');
    } else {
      if (newTypes.has('all')) {
        newTypes.clear();
      }
      
      if (newTypes.has(type)) {
        newTypes.delete(type);
      } else {
        newTypes.add(type);
      }
      
      if (newTypes.size === 0) {
        newTypes.add('all');
      }
    }
    
    setSelectedTypes(newTypes);
    // Generate new challenge with new types
    // setTimeout ensures state updates are batched
    setTimeout(() => {
      const challenge = generateChallenge(newTypes);
      setCurrentChallenge(challenge);
      resetChallengeState();
    }, 0);
  }, [selectedTypes, resetChallengeState]);

  // Generate initial challenge once on mount
  useEffect(() => {
    if (!initializedRef.current && !currentChallenge) {
      initializedRef.current = true;
      handleNewChallenge();
    }
  }, [handleNewChallenge, currentChallenge]);

  const handleSubmit = (answer) => {
    const isCorrect = validateAnswer(currentChallenge, answer);
    
    // Update stats
    const newStreak = isCorrect && !visualHintShown ? stats.streak + 1 : 0;
    const newStats = {
      total: stats.total + 1,
      correct: stats.correct + (isCorrect && !visualHintShown ? 1 : 0),
      streak: newStreak,
      longestStreak: Math.max(stats.longestStreak, newStreak),
    };
    setStats(newStats);

    // TODO: Save attempt to backend when ready
    // For now, just store locally via the stats useEffect

    // Show feedback
    setFeedback({
      isCorrect,
      message: isCorrect
        ? `🎉 Correct! The answer is "${currentChallenge.expectedAnswer}"`
        : `❌ Incorrect. The correct answer is "${currentChallenge.expectedAnswer}". ${getExplanation(currentChallenge)}`,
    });
  };

  // Show name prompt for teacher-managed sessions
  if (!sessionId.startsWith('solo-') && !nameSubmitted) {
    return (
      <div className="java-string-container">
        <div className="java-string-header">
          <div className="game-title">Java String Methods Practice</div>
        </div>
        <div className="java-string-content">
          <div className="challenge-card" style={{ textAlign: 'center', padding: '40px' }}>
            <h3 className="text-xl font-semibold mb-4">Enter Your Name</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (studentName.trim()) {
                localStorage.setItem(`student-name-${sessionId}`, studentName.trim());
                setNameSubmitted(true);
              }
            }}>
              <input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="Your name"
                className="border border-gray-300 rounded px-4 py-2 text-lg mb-4 w-64"
                autoFocus
                required
              />
              <br />
              <Button type="submit">Start Practicing</Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="java-string-container">
      <div className="java-string-header">
        <div className="game-title">Java String Methods Practice</div>
        <StatsPanel stats={stats} />
      </div>

      <div className="java-string-content">
        <div className="challenge-card">
          <div className="challenge-header">
            <ChallengeSelector
              selectedTypes={selectedTypes}
              onTypeSelect={sessionId.startsWith('solo-') ? handleTypeSelection : undefined}
            />
          </div>

          {currentChallenge && (
            <>
              <StringDisplay
                challenge={currentChallenge}
                selectedIndices={selectedIndices}
                visualHintShown={visualHintShown}
                selectionType={selectionType}
                onLetterClick={(index) => {
                  // Clicking letters always selects characters
                  // If switching from index to letter selection, reset
                  if (isSelecting && selectionType === 'index') {
                    setSelectedIndices([index]);
                    setSelectionType('letter');
                    const singleLetter = currentChallenge.text.charAt(index);
                    setUserAnswer(singleLetter);
                  } else if (!isSelecting) {
                    // First click - select single letter
                    setSelectedIndices([index]);
                    setIsSelecting(true);
                    setSelectionType('letter');
                    const singleLetter = currentChallenge.text.charAt(index);
                    setUserAnswer(singleLetter);
                  } else {
                    // Second click - select range
                    const start = Math.min(selectedIndices[0], index);
                    const end = Math.max(selectedIndices[0], index) + 1;
                    setSelectedIndices([start, end]);
                    setIsSelecting(false);
                    setSelectionType(null);
                    const selected = currentChallenge.text.substring(start, end);
                    setUserAnswer(selected);
                  }
                }}
                onIndexClick={(index) => {
                  // Clicking indices always submits index numbers
                  // If switching from letter to index selection, reset
                  if (isSelecting && selectionType === 'letter') {
                    setSelectedIndices([index]);
                    setSelectionType('index');
                    setUserAnswer(index.toString());
                  } else if (!isSelecting) {
                    setSelectedIndices([index]);
                    setIsSelecting(true);
                    setSelectionType('index');
                    setUserAnswer(index.toString());
                  } else {
                    const start = Math.min(selectedIndices[0], index);
                    const end = Math.max(selectedIndices[0], index);
                    setSelectedIndices([start, end]);
                    setIsSelecting(false);
                    setSelectionType(null);
                    setUserAnswer(`${start}, ${end}`);
                  }
                }}
              />

              <div className="question-hint-row">
                <ChallengeQuestion question={currentChallenge.question} />
                {!feedback && (
                  <div className="hint-controls">
                    {!hintShown && (
                      <Button onClick={() => setHintShown(true)} className="hint-btn">
                        💡 Show Hint
                      </Button>
                    )}
                    {hintShown && !visualHintShown && (
                      <Button onClick={() => setVisualHintShown(true)} className="visual-hint-btn">
                        🎯 Show Answer
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {hintShown && (
                <div className="code-hint">
                  {currentChallenge.hint}
                </div>
              )}

              {!feedback && (
                <AnswerSection
                  challenge={currentChallenge}
                  userAnswer={userAnswer}
                  selectedIndices={selectedIndices}
                  onAnswerChange={setUserAnswer}
                  onSubmit={handleSubmit}
                />
              )}

              {feedback && (
                <FeedbackDisplay
                  feedback={feedback}
                  onNewChallenge={handleNewChallenge}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
