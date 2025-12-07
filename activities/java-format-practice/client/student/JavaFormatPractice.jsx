import InterleavedOutputGrid from '../components/InterleavedOutputGrid';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@src/components/ui/Button';
import '../components/styles.css';
import ChallengeSelector from '../components/ChallengeSelector';
import CharacterGrid from '../components/CharacterGrid';
import AnswerSection from '../components/AnswerSection';
import FeedbackDisplay from '../components/FeedbackDisplay';
import StatsPanel from '../components/StatsPanel';
import { getRandomChallenge, formatWithMask, evaluateArgs } from '../challenges';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';

// Highlight the first difference between two strings
function highlightDiff(expected, actual) {
  if (expected === actual) return { expected, actual };
  let i = 0;
  while (i < expected.length && i < actual.length && expected[i] === actual[i]) i++;
  // Find end of difference
  let j = 0;
  while (
    j < expected.length - i &&
    j < actual.length - i &&
    expected[expected.length - 1 - j] === actual[actual.length - 1 - j]
  ) j++;
  const expDiff =
    expected.slice(0, i) +
    '<span class="diff-highlight">' + expected.slice(i, expected.length - j) + '</span>' +
    expected.slice(expected.length - j);
  const actDiff =
    actual.slice(0, i) +
    '<span class="diff-highlight">' + actual.slice(i, actual.length - j) + '</span>' +
    actual.slice(actual.length - j);
  return { expected: expDiff, actual: actDiff };
}

/**
 * Evaluate a Java format string with given arguments
 * Supports common format specifiers: %s, %d, %f, %n, %%
 * Also handles width and precision: %-20s, %3d, %.2f, %6.2f, %03d, etc.
 */
function evaluateFormatString(formatStr, args = []) {
  if (!formatStr) return '';
  
  let result = '';
  let argIndex = 0;
  let i = 0;
  
  while (i < formatStr.length) {
    if (formatStr[i] === '%' && i + 1 < formatStr.length) {
      const next = formatStr[i + 1];
      
      if (next === '%') {
        result += '%';
        i += 2;
      } else if (next === 'n') {
        result += '\n';
        i += 2;
      } else if (next === 's') {
        // Simple string format: %s
        if (argIndex < args.length) {
          result += String(args[argIndex]);
          argIndex++;
        }
        i += 2;
      } else if (next === 'd') {
        // Simple integer format: %d
        if (argIndex < args.length) {
          result += String(parseInt(args[argIndex]) || 0);
          argIndex++;
        }
        i += 2;
      } else if (next === 'f') {
        // Simple float format: %f (default 6 decimals)
        if (argIndex < args.length) {
          result += parseFloat(args[argIndex]).toFixed(6);
          argIndex++;
        }
        i += 2;
      } else {
        // Handle width and precision specifiers like %10s, %.2f, %-20s, %6.2f, %3d, %03d, etc.
        let j = i + 1;
        let spec = '';
        
        // Collect format spec characters (-, +, 0, #, space, digits, .)
        while (j < formatStr.length && '0123456789.-+ #'.includes(formatStr[j])) {
          spec += formatStr[j];
          j++;
        }
        
        if (j < formatStr.length) {
          const type = formatStr[j];
          
          if (type === 's' && argIndex < args.length) {
            // String with width/alignment: %-20s, %10s, etc.
            const str = String(args[argIndex]);
            const match = spec.match(/^(-?)(\d+)?$/);
            if (match) {
              const [, leftAlign, width] = match;
              const w = parseInt(width) || 0;
              if (leftAlign) {
                result += str.padEnd(w);
              } else {
                result += str.padStart(w);
              }
            } else {
              result += str;
            }
            argIndex++;
            i = j + 1;
          } else if (type === 'd' && argIndex < args.length) {
            // Integer with width: %3d, %03d, %2d, etc.
            const num = String(parseInt(args[argIndex]) || 0);
            const match = spec.match(/^(0)?(\d+)?$/);
            if (match) {
              const [, padZero, width] = match;
              const w = parseInt(width) || 0;
              if (padZero) {
                result += num.padStart(w, '0');
              } else {
                result += num.padStart(w);
              }
            } else {
              result += num;
            }
            argIndex++;
            i = j + 1;
          } else if (type === 'f' && argIndex < args.length) {
            // Float with width and precision: %6.2f, %.2f, %10.2f, etc.
            const num = parseFloat(args[argIndex]) || 0;
            const match = spec.match(/^(-?)(\d*)\.(\d+)$/);
            if (match) {
              const [, leftAlign, width, precision] = match;
              const p = parseInt(precision) || 6;
              const w = parseInt(width) || 0;
              let formatted = num.toFixed(p);
              if (leftAlign) {
                formatted = formatted.padEnd(w);
              } else {
                formatted = formatted.padStart(w);
              }
              result += formatted;
            } else {
              result += num.toFixed(6);
            }
            argIndex++;
            i = j + 1;
          } else {
            result += formatStr[i];
            i++;
          }
        } else {
          result += formatStr[i];
          i++;
        }
      }
    } else {
      result += formatStr[i];
      i++;
    }
  }
  
  return result;
}

/**
 * JavaFormatPractice - Student view for practicing Java printf and String.format
 * 
 * Hint System:
 * - Text Hint (💡): Shows explanation for the format specifier
 * - Using a hint will mark the current answer as "with hint" and prevent streak counting
 * - This encourages students to try without help first, but allows learning when stuck
 * 
 * Stats Tracking:
 * - Total: All attempts (with or without hints)
 * - Correct: Only correct answers WITHOUT any hints
 * - Streak: Consecutive correct answers WITHOUT any hints
 * - Longest Streak: Best streak achieved during the session
 */

// ExpectedOutputGrid for String.format problems - shows expected output with variable names as row labels
function ExpectedOutputGrid({ formatCalls, width = 30, height = 3, variables = [] }) {
  // Build the expected output for each line by computing the format calls
  const lines = formatCalls.map((call) => {
    let varName = '';
    const skeletonMatch = call.skeleton?.match(/String\s+(\w+)\s*=/);
    if (skeletonMatch) {
      varName = skeletonMatch[1];
    }
    
    // Compute expected output by parsing and evaluating the answer
    let expectedText = '';
    let expectedMask = '';
    const answerStr = call.answer || '';
    if (answerStr.trim()) {
      try {
        // Split arguments properly, respecting quoted strings
        const answerParts = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < answerStr.length; i++) {
          const char = answerStr[i];
          const prevChar = i > 0 ? answerStr[i - 1] : '';
          
          if (char === '"' && prevChar !== '\\') {
            inQuotes = !inQuotes;
            current += char;
          } else if (char === ',' && !inQuotes) {
            answerParts.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        if (current.trim()) {
          answerParts.push(current.trim());
        }
        
        if (answerParts[0].startsWith('"') && answerParts[0].endsWith('"')) {
          const fmt = answerParts[0].slice(1, -1);
          const argExprs = answerParts.slice(1);
          
          // Build value map from variables
          const valueMap = {};
          (variables || []).forEach((v) => {
            let val = v.value;
            if (v.type === 'String') {
              val = val.replace(/^"(.*)"$/, '$1');
            }
            valueMap[v.name] = v.type === 'String' ? val : parseFloat(val) || 0;
          });
          
          // Evaluate arguments
          const argValues = argExprs.map((expr) => {
            const trimmed = expr.trim();
            if (!trimmed) return '';
            const keys = Object.keys(valueMap);
            const vals = Object.values(valueMap);
            try {
              // eslint-disable-next-line no-new-func
              return new Function(...keys, `return ${trimmed};`)(...vals);
            } catch {
              return '';
            }
          });
          
          // Use formatWithMask to properly format
          const result = formatWithMask(fmt, argValues);
          expectedText = result.text.replace(/%n/g, '').replace(/\n/g, '');
          expectedMask = result.mask.replace(/%n/g, '').replace(/\n/g, '');
        }
      } catch {
        // If we can't compute expected, leave it empty
      }
    }
    
    return { varName, expectedText, expectedMask };
  });

  return (
    <div className="character-grid-container">
      <table className="character-grid">
        <thead>
          <tr>
            <th className="grid-row-label" style={{ width: '80px' }}></th>
            {Array.from({ length: width }).map((_, i) => (
              <th key={`tens-${i}`} className="grid-column-header grid-column-header-tens">
                {i % 10 === 0 ? Math.floor(i / 10) : '\u00A0'}
              </th>
            ))}
          </tr>
          <tr>
            <th className="grid-row-label" style={{ width: '80px' }}></th>
            {Array.from({ length: width }).map((_, i) => (
              <th key={`ones-${i}`} className="grid-column-header">
                {i % 10}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, idx) => {
            const displayLines = line.expectedText ? line.expectedText.split(/\n/) : [''];
            const maskLines = line.expectedMask ? line.expectedMask.split(/\n/) : [''];
            
            return displayLines.map((displayLine, lineIdx) => (
              <tr key={`${idx}-${lineIdx}`}>
                <td className="grid-row-label" style={{ background: '#ccc', fontWeight: 'bold', fontSize: '12px' }}>
                  {lineIdx === 0 ? line.varName : ''}
                </td>
                {Array.from({ length: width }).map((_, colIdx) => {
                  const char = displayLine?.[colIdx] || '';
                  const maskChar = maskLines[lineIdx]?.[colIdx] || '';
                  const isEmpty = !char;
                  
                  // Color based on mask: 'S' = static (orange), 'D' = dynamic (blue), empty = gray
                  let bgColor = '#f3f4f6'; // Gray for empty
                  let borderColor = '#ccc';
                  
                  if (!isEmpty) {
                    if (maskChar === 'S') {
                      bgColor = '#fef3c7'; // Orange for static
                      borderColor = '#f59e0b';
                    } else if (maskChar === 'D' || maskChar === 'V') {
                      bgColor = '#dbeafe'; // Blue for dynamic
                      borderColor = '#3b82f6';
                    }
                  }
                  
                  return (
                    <td key={colIdx} className="grid-cell" style={{ background: bgColor, borderColor: borderColor }}>
                      {char || '\u00A0'}
                    </td>
                  );
                })}
              </tr>
            ));
          })}
        </tbody>
      </table>
      <div className="grid-legend">
        <div className="grid-legend-item">
          <div className="grid-legend-box" style={{ background: '#fef3c7', borderColor: '#f59e0b', border: '2px solid #f59e0b' }}></div>
          <span>Static characters (format string)</span>
        </div>
        <div className="grid-legend-item">
          <div className="grid-legend-box" style={{ background: '#dbeafe', borderColor: '#3b82f6', border: '2px solid #3b82f6' }}></div>
          <span>Dynamic characters (from arguments)</span>
        </div>
      </div>
    </div>
  );
}

export default function JavaFormatPractice({ sessionData }) {
  const sessionId = sessionData?.sessionId;
  const isSoloSession = sessionId ? sessionId.startsWith('solo-') : false;
  const initializedRef = useRef(false);
  const studentIdRef = useRef(null);
  const navigate = useNavigate();

  // Get session-ended handler
  const attachSessionEndedHandler = useSessionEndedHandler();

  const [studentName, setStudentName] = useState('');
  const [studentId, setStudentId] = useState(null);
  const [nameSubmitted, setNameSubmitted] = useState(false);
  const [currentChallenge, setCurrentChallenge] = useState(null);
  const [currentFormatCallIndex, setCurrentFormatCallIndex] = useState(0);
  const [selectedDifficulty, setSelectedDifficulty] = useState('beginner');
  const [selectedTheme, setSelectedTheme] = useState('all');
  const [userAnswers, setUserAnswers] = useState([]);
  const [solvedAnswers, setSolvedAnswers] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [lineErrors, setLineErrors] = useState({});
  const [lineOutputs, setLineOutputs] = useState({});
  const [hintShown, setHintShown] = useState(false);

  const [stats, setStats] = useState({
    total: 0,
    correct: 0,
    streak: 0,
    longestStreak: 0,
  });
  const [focusToken, setFocusToken] = useState(0);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const splitAnswerParts = useCallback((answer = '') => answer.split(',').map((part) => part.trim()), []);

  // Helper function to split arguments respecting quoted strings
  const splitArgumentsRespectingQuotes = useCallback((str) => {
    const parts = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const prevChar = i > 0 ? str[i - 1] : '';

      if (char === '"' && prevChar !== '\\') {
        inQuotes = !inQuotes;
        current += char;
      } else if (char === ',' && !inQuotes) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      parts.push(current.trim());
    }

    return parts;
  }, []);

  // Validate that all variable names in expressions are defined
  const validateVariableReferences = useCallback((expressions, valueMap) => {
    const definedVars = Object.keys(valueMap);
    const javaKeywords = ['true', 'false', 'null', 'undefined', 'int', 'long', 'float', 'double', 'boolean', 'byte', 'char', 'short'];
    
    for (const expr of expressions) {
      // Remove quoted strings first to avoid checking variables inside string literals
      const exprWithoutStrings = expr.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '');
      
      // Extract variable names from the expression (simple regex: word characters)
      const varPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
      let match;
      while ((match = varPattern.exec(exprWithoutStrings)) !== null) {
        const varName = match[1];
        // Skip Java keywords and type names
        if (javaKeywords.includes(varName)) continue;
        if (!definedVars.includes(varName)) {
          throw new Error(`Variable '${varName}' is not defined`);
        }
      }
    }
  }, []);

  const buildAnswerString = useCallback((parts = []) => {
    return parts.map((p) => p.trim()).join(', ');
  }, []);

  const createEmptyAnswers = useCallback(
    (formatCalls = [], difficulty) =>
      formatCalls.map((call) =>
        difficulty === 'advanced'
          ? ['']
          : new Array(splitAnswerParts(call.answer).length).fill('')
      ),
    [splitAnswerParts]
  );

  // Helper to reset challenge state
  const resetChallengeState = useCallback(
    (formatCalls = [], difficulty) => {
      setUserAnswers(createEmptyAnswers(formatCalls, difficulty));
      setSolvedAnswers(Array.from({ length: formatCalls.length }, () => ''));
      setFeedback(null);
      setHintShown(false);
    },
    [createEmptyAnswers]
  );

  // Initialize student name for non-solo sessions
  useEffect(() => {
    if (isSoloSession) {
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
  }, [sessionId, isSoloSession]);

  useEffect(() => {
    studentIdRef.current = studentId;
  }, [studentId]);

  useEffect(() => {
    if (!currentChallenge || !currentChallenge.formatCalls) return;
    resetChallengeState(currentChallenge.formatCalls, selectedDifficulty);
    setCurrentFormatCallIndex(0);
  }, [currentChallenge, resetChallengeState, selectedDifficulty]);

  // Load stats from localStorage
  useEffect(() => {
    if (!nameSubmitted || !sessionId) return;

    const key = `format-stats-${sessionId}-${studentId}`;
    const savedStats = localStorage.getItem(key);
    if (savedStats) {
      try {
        setStats(JSON.parse(savedStats));
      } catch (err) {
        console.error('Failed to parse saved stats:', err);
      }
    }
  }, [nameSubmitted, sessionId, studentId]);

  // Generate first challenge
  useEffect(() => {
    if (!nameSubmitted) return;

    if (currentChallenge === null) {
      const challenge = getRandomChallenge(
        selectedTheme === 'all' ? null : selectedTheme,
        selectedDifficulty
      );
      setCurrentChallenge(challenge);
      setCurrentFormatCallIndex(0);
      resetChallengeState(challenge.formatCalls || [], selectedDifficulty);
      setFocusToken((t) => t + 1);
    }
  }, [nameSubmitted, selectedDifficulty, selectedTheme]);

  const handleWsMessage = useCallback(
    (event) => {
      console.log('WebSocket message received:', event.data);
      try {
        const message = JSON.parse(event.data);
        console.log('Parsed message:', message);
        if (message.type === 'session-ended') {
          navigate('/session-ended');
          return;
        }
        if (message.type === 'studentId') {
          const newStudentId = message.payload.studentId;
          setStudentId(newStudentId);
          localStorage.setItem(`student-id-${sessionId}`, newStudentId);
          console.log('Received student ID:', newStudentId);
        } else if (message.type === 'difficultyUpdate') {
          const difficulty = message.payload.difficulty || 'beginner';
          console.log('Updating difficulty to:', difficulty);
          setSelectedDifficulty(difficulty);
          const challenge = getRandomChallenge(
            selectedTheme === 'all' ? null : selectedTheme,
            difficulty
          );
          setCurrentChallenge(challenge);
        } else if (message.type === 'themeUpdate') {
          const theme = message.payload.theme || 'all';
          console.log('Updating theme to:', theme);
          setSelectedTheme(theme);
          const challenge = getRandomChallenge(
            theme === 'all' ? null : theme,
            selectedDifficulty
          );
          setCurrentChallenge(challenge);
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    },
    [navigate, resetChallengeState, sessionId, selectedTheme, selectedDifficulty]
  );

  const handleWsOpen = useCallback(() => {
    console.log('WebSocket connected for session:', sessionId);
  }, [sessionId]);

  const buildWsUrl = useCallback(() => {
    if (!nameSubmitted || isSoloSession) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const currentId = studentIdRef.current;
    const studentIdParam = currentId ? `&studentId=${encodeURIComponent(currentId)}` : '';
    return `${protocol}//${host}/ws/java-format-practice?sessionId=${sessionId}&studentName=${encodeURIComponent(
      studentName
    )}${studentIdParam}`;
  }, [nameSubmitted, isSoloSession, sessionId, studentName]);

  const { connect: connectStudentWs, disconnect: disconnectStudentWs } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(nameSubmitted && !isSoloSession),
    onOpen: handleWsOpen,
    onMessage: handleWsMessage,
    onError: null,
    onClose: null,
    attachSessionEndedHandler,
  });

  useEffect(() => {
    if (!nameSubmitted || isSoloSession) {
      disconnectStudentWs();
      return undefined;
    }
    connectStudentWs();
    return () => {
      disconnectStudentWs();
    };
  }, [nameSubmitted, sessionId, isSoloSession, connectStudentWs, disconnectStudentWs]);

  // Save stats to localStorage when they change
  useEffect(() => {
    if (!sessionId || !studentId) return;

    const key = `format-stats-${sessionId}-${studentId}`;
    localStorage.setItem(key, JSON.stringify(stats));

    // Sync to server if in class mode
    if (!isSoloSession) {
      fetch(`/api/java-format-practice/${sessionId}/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          stats,
        }),
      }).catch((err) => console.error('Failed to sync stats:', err));
    }
  }, [stats, sessionId, studentId, isSoloSession]);

  const getCurrentFormatCall = () => {
    if (!currentChallenge || !currentChallenge.formatCalls) return null;
    return currentChallenge.formatCalls[currentFormatCallIndex];
  };

  const handleNameSubmit = (name) => {
    if (!name.trim()) {
      alert('Please enter your name');
      return;
    }

    setStudentName(name);
    localStorage.setItem(`student-name-${sessionId}`, name);

    // Generate a student ID
    const id = `${name}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setStudentId(id);
    localStorage.setItem(`student-id-${sessionId}`, id);

    setNameSubmitted(true);
  };

  const checkAnswer = () => {
    if (!currentChallenge || !currentChallenge.formatCalls) return;

    const calls = currentChallenge.formatCalls;

    if (selectedDifficulty === 'beginner') {
      setHasSubmitted(true);
      if (typeof window !== 'undefined') window.hasSubmitted = true;
      const formatCall = calls[currentFormatCallIndex];
      const userParts = userAnswers[currentFormatCallIndex] || [];
      const expectedParts = splitAnswerParts(formatCall.answer);
      
      const inputsMeta = formatCall.inputs || [];
      const adjustedExpectedParts = expectedParts.map((part, idx) => {
        const meta = inputsMeta[idx];
        if (meta?.type === 'string-literal') {
          return `"${part}"`;
        }
        return part;
      });
      
      const adjustedUserParts = userParts.map((part, idx) => {
        const meta = inputsMeta[idx];
        if (meta?.type === 'string-literal') {
          return `"${part.trim()}"`;
        }
        return part.trim();
      });

      const submitted = adjustedUserParts.join(', ');
      const expected = adjustedExpectedParts.join(', ');
      const isCorrect = submitted === expected;

      let detailedMessage = '';
      let wrongParts = [];
      if (!isCorrect && userParts.length === expectedParts.length) {
        userParts.forEach((part, idx) => {
          const meta = inputsMeta[idx];
          const partName = meta?.type === 'format-string' 
            ? 'format specifier'
            : meta?.type === 'string-literal'
            ? 'string literal'
            : 'variable';
          if (adjustedUserParts[idx] !== adjustedExpectedParts[idx]) {
            const { expected: expDiff, actual: actDiff } = highlightDiff(adjustedExpectedParts[idx], adjustedUserParts[idx] || '');
            wrongParts.push(`${partName} (expected: <code>${expDiff}</code>, got: <code>${actDiff}</code>)`);
          }
        });
        if (wrongParts.length > 0) {
          detailedMessage = `Incorrect ${wrongParts.join(', ')}`;
        }
      }

      if (isCorrect) {
        setSolvedAnswers((prev) => {
          const next = [...prev];
          next[currentFormatCallIndex] = formatCall.answer;
          return next;
        });
      }

      setStats((prev) => {
        const newStats = { ...prev };
        newStats.total += 1;

        if (isCorrect && !hintShown) {
          newStats.correct += 1;
          newStats.streak += 1;
          if (newStats.streak > newStats.longestStreak) {
            newStats.longestStreak = newStats.streak;
          }
        } else if (!isCorrect) {
          newStats.streak = 0;
        } else {
          newStats.streak = 0;
        }

        return newStats;
      });

      let explanation = undefined;
      if (isCorrect) {
        explanation = formatCall.explanation;
      } else if (wrongParts.length > 0) {
        const wrongTypes = userParts.map((part, idx) => adjustedUserParts[idx] !== adjustedExpectedParts[idx] ? (inputsMeta[idx]?.type) : null).filter(Boolean);
        if (wrongTypes.includes('format-string') || wrongTypes.includes('string-literal')) {
          explanation = formatCall.explanation;
        }
      }

      setFeedback({
        isCorrect,
        message: isCorrect
          ? `Correct! ${hintShown ? '(but you used a hint)' : ''}`
          : detailedMessage || 'Not quite. Try again.',
        explanation,
      });
    } else {
      // Intermediate/Advanced mode: validate all lines and collect valid outputs
      setHasSubmitted(true);
      let validOutputs = [];
      const outputsByLine = {};
      
      calls.forEach((call, idx) => {
        const userSubmitted = buildAnswerString(userAnswers[idx] || []);
        if (!userSubmitted) return;
        
        let syntaxError = '';
        let userOutputText = '';
        
        try {
          const userParts = splitArgumentsRespectingQuotes(userSubmitted);
          if (!userParts[0].startsWith('"') || !userParts[0].endsWith('"')) {
            syntaxError = 'Format string must be enclosed in double quotes.';
          } else {
            const userFmt = userParts[0].slice(1, -1);
            const valueMap = {};
            (currentChallenge.variables || []).forEach((v) => {
              let val = v.value;
              if (v.type === 'String') {
                val = val.replace(/^"(.*)"$/, '$1');
              }
              valueMap[v.name] = v.type === 'String' ? val : parseFloat(val) || 0;
            });
            const userArgExprs = userParts.slice(1);
            let userArgValues = [];
            try {
              // Validate that all variable references are defined
              validateVariableReferences(userArgExprs, valueMap);
              userArgValues = evaluateArgs(userArgExprs, valueMap);
              const userOutput = formatWithMask(userFmt, userArgValues);
              userOutputText = userOutput.text;
            } catch (err) {
              syntaxError = `Undefined variable or error: ${err.message}`;
            }
          }
        } catch (err) {
          syntaxError = 'Syntax error in format string.';
        }
        
        // Only store output if there are no syntax errors
        if (!syntaxError && userOutputText) {
          validOutputs.push(userOutputText);
          console.log(`Line ${idx + 1} output:`, userOutputText);
          
          // Calculate expected output for this line from the call's answer
          let expectedOutputText = '';
          let expectedMask = '';
          const answerStr = call.answer || '';
          if (answerStr.trim()) {
            try {
              const answerParts = splitArgumentsRespectingQuotes(answerStr);
              if (answerParts[0].startsWith('"') && answerParts[0].endsWith('"')) {
                const expectedFmt = answerParts[0].slice(1, -1);
                const expectedArgExprs = answerParts.slice(1);
                const valueMap = {};
                (currentChallenge.variables || []).forEach((v) => {
                  let val = v.value;
                  if (v.type === 'String') {
                    val = val.replace(/^"(.*)"$/, '$1');
                  }
                  valueMap[v.name] = v.type === 'String' ? val : parseFloat(val) || 0;
                });
                const expectedArgValues = evaluateArgs(expectedArgExprs, valueMap);
                const expectedOutput = formatWithMask(expectedFmt, expectedArgValues);
                expectedOutputText = expectedOutput.text;
                expectedMask = expectedOutput.mask;
              }
            } catch (err) {
              // If we can't compute expected, just leave it empty
            }
          }
          
          // Extract variable name from skeleton (e.g., "String line1 = ..." -> "line1")
          let varName = '';
          const skeletonMatch = call.skeleton?.match(/String\s+(\w+)\s*=/);
          if (skeletonMatch) {
            varName = skeletonMatch[1];
          }
          
          // Store per-line output comparison
          outputsByLine[idx] = {
            expectedOutput: expectedOutputText,
            userOutput: userOutputText,
            expectedMask: expectedMask,
            varName: varName,
          };
        }
        
        if (syntaxError) {
          setLineErrors((prev) => ({ ...prev, [idx]: syntaxError }));
        } else {
          setLineErrors((prev) => {
            const updated = { ...prev };
            delete updated[idx];
            return updated;
          });
        }
      });
      
      // Update lineOutputs with collected outputs
      setLineOutputs(outputsByLine);

      // Check if all lines match (normalized for grid comparison)
      const allLinesMatch = Object.values(outputsByLine).length > 0 && Object.values(outputsByLine).every(line => {
        const normalize = s => (s || '').replace(/%n/g, '↵').replace(/\n/g, '');
        return normalize(line.expectedOutput) === normalize(line.userOutput);
      });
      if (allLinesMatch) {
        setFeedback({
          isCorrect: true,
          message: 'All lines correct! Great job.',
        });
      } else {
        setFeedback({
          isCorrect: false,
          message: 'Some lines are incorrect. Please check your output and try again.',
        });
      }
    }
  };

  const handleHint = () => {
    setHintShown(true);
  };

  const handleNextChallenge = () => {
    if (!currentChallenge || !currentChallenge.formatCalls) return;

    // For beginner: move to next line within same challenge if available AND answer was correct
    if (selectedDifficulty === 'beginner' && currentFormatCallIndex < currentChallenge.formatCalls.length - 1 && feedback?.isCorrect) {
      // Fill the just-answered line with the expected answer so it shows as solved
      setSolvedAnswers((prev) => {
        const next = [...prev];
        next[currentFormatCallIndex] = currentChallenge.formatCalls[currentFormatCallIndex].answer;
        return next;
      });

      setCurrentFormatCallIndex((idx) => idx + 1);
      setFeedback(null);
      setHintShown(false);
      setHasSubmitted(false);
      setUserAnswers((prev) => {
        const next = [...prev];
        const nextParts = splitAnswerParts(currentChallenge.formatCalls[currentFormatCallIndex + 1]?.answer || '');
        next[currentFormatCallIndex + 1] = new Array(nextParts.length).fill('');
        return next;
      });
      setFocusToken((t) => t + 1);
      return;
    }

    // If beginner and on the last line AND correct, mark it solved before moving on
    if (selectedDifficulty === 'beginner' && currentFormatCallIndex >= currentChallenge.formatCalls.length - 1 && feedback?.isCorrect) {
      setSolvedAnswers((prev) => {
        const next = [...prev];
        next[currentFormatCallIndex] = currentChallenge.formatCalls[currentFormatCallIndex].answer;
        return next;
      });
    }

    const pickChallenge = () => {
      const theme = selectedTheme === 'all' ? null : selectedTheme;
      let next = getRandomChallenge(theme, selectedDifficulty);
      let attempts = 0;
      while (next && currentChallenge && next.id === currentChallenge.id && attempts < 5) {
        next = getRandomChallenge(theme, selectedDifficulty);
        attempts += 1;
      }
      return next;
    };

    const challenge = pickChallenge();
    setCurrentChallenge(challenge);
    setCurrentFormatCallIndex(0);
    setHasSubmitted(false);
    setFocusToken((t) => t + 1);
  };

  const handleDifficultyChange = (difficulty) => {
    setSelectedDifficulty(difficulty);
    if (!isSoloSession) {
      fetch(`/api/java-format-practice/${sessionId}/difficulty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty }),
      }).catch((err) => console.error('Failed to update difficulty:', err));
    }
    const challenge = getRandomChallenge(
      selectedTheme === 'all' ? null : selectedTheme,
      difficulty
    );
    setCurrentChallenge(challenge);
    setCurrentFormatCallIndex(0);
    setFocusToken((t) => t + 1);
  };

  const handleThemeChange = (theme) => {
    setSelectedTheme(theme);
    if (!isSoloSession) {
      fetch(`/api/java-format-practice/${sessionId}/theme`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      }).catch((err) => console.error('Failed to update theme:', err));
    }
    const challenge = getRandomChallenge(
      theme === 'all' ? null : theme,
      selectedDifficulty
    );
    setCurrentChallenge(challenge);
    setCurrentFormatCallIndex(0);
    setFocusToken((t) => t + 1);
  };

  // Show name prompt if not in solo mode and name not submitted
  if (!isSoloSession && !nameSubmitted) {
    return (
      <div className="name-prompt-overlay">
        <div className="name-prompt-dialog">
          <h2>Welcome to Java Format Practice</h2>
          <p>Please enter your name to continue:</p>
          <input
            type="text"
            className="name-input"
            placeholder="Your name"
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleNameSubmit(e.target.value);
              }
            }}
            autoFocus
          />
          <button
            className="name-submit-btn"
            onClick={(e) => {
              const input = e.target.parentElement.querySelector('.name-input');
              handleNameSubmit(input.value);
            }}
          >
            Start
          </button>
        </div>
      </div>
    );
  }

  if (!currentChallenge || !getCurrentFormatCall()) {
    return <div>Loading challenge...</div>;
  }

  const formatCall = getCurrentFormatCall();
  const progressText = `${currentFormatCallIndex + 1}/${currentChallenge.formatCalls.length}`;
  const hasInput = (() => {
    if (selectedDifficulty === 'beginner') {
      const parts = userAnswers[currentFormatCallIndex] || [];
      const expected = splitAnswerParts(formatCall.answer).length;
      return parts.length === expected && parts.every((p) => p.trim());
    }
    const calls = currentChallenge.formatCalls || [];
    if (selectedDifficulty === 'advanced') {
      // After first submission, allow checking partial lines
      if (hasSubmitted) {
        // Allow checking if at least one line has input
        return calls.some((call, idx) => {
          const parts = userAnswers[idx] || [];
          return parts.length === 1 && parts[0].trim();
        });
      }
      // Before first submission, require all lines to be filled
      return calls.every((call, idx) => {
        const parts = userAnswers[idx] || [];
        return parts.length === 1 && parts[0].trim();
      });
    }
    // Intermediate: after first submission, allow checking partial lines; otherwise require all
    if (hasSubmitted) {
      return calls.some((call, idx) => {
        const parts = userAnswers[idx] || [];
        const expected = splitAnswerParts(call.answer).length;
        return parts.length === expected && parts.every((p) => p.trim());
      });
    }
    return calls.every((call, idx) => {
      const parts = userAnswers[idx] || [];
      const expected = splitAnswerParts(call.answer).length;
      return parts.length === expected && parts.every((p) => p.trim());
    });
  })();
  const submitDisabled = !hasInput;

  return (
    <div className="java-format-container">
      <div className="java-format-header">
        <div className="format-title">Format Practice</div>
        <div className="format-subtitle">
          {currentChallenge.theme} - {progressText}
        </div>
      </div>

      <div className="java-format-content">
        <ChallengeSelector
          currentDifficulty={selectedDifficulty}
          currentTheme={selectedTheme}
          onDifficultyChange={handleDifficultyChange}
          onThemeChange={handleThemeChange}
          isDisabled={feedback?.isCorrect === true}
        />

        <div className="challenge-card">
          <div className="challenge-header">
            <div className="theme-title">{currentChallenge.title}</div>
            <span
              className={`difficulty-badge ${currentChallenge.difficulty}`}
            >
              {currentChallenge.difficulty}
            </span>
          </div>

          <p className="scenario-text">{currentChallenge.scenario}</p>

          {/* For intermediate/advanced: show expected output only before submission */}
          {(selectedDifficulty === 'intermediate' || selectedDifficulty === 'advanced') && currentChallenge.expectedOutput && !hasSubmitted && (
            <>
              <h4>Expected Output:</h4>
              {currentChallenge.formatCalls?.[0]?.method === 'format' ? (
                // String.format: show expected output with variable names
                <ExpectedOutputGrid
                  formatCalls={currentChallenge.formatCalls}
                  variables={currentChallenge.variables}
                  width={currentChallenge.gridWidth || 30}
                  height={currentChallenge.gridHeight || 3}
                />
              ) : (
                // printf: show combined expected output
                <CharacterGrid
                  text={currentChallenge.expectedOutput}
                  mask={currentChallenge.expectedOutputMask}
                  width={currentChallenge.gridWidth || 30}
                  height={currentChallenge.gridHeight || 3}
                  showRows={false}
                />
              )}
            </>
          )}
          {/* Single Interleaved Expected/Actual Output Grid for intermediate/advanced after first check */}
          {(selectedDifficulty === 'intermediate' || selectedDifficulty === 'advanced') && hasSubmitted && (
            <>
              <h4>Output Comparison:</h4>
              {currentChallenge.formatCalls?.[0]?.method === 'format' ? (
                // String.format: pass lineData with variable names, keep %n to display as ↵
                <InterleavedOutputGrid
                  lineData={Object.entries(lineOutputs).map(([idx, lo]) => ({
                    expected: lo.expectedOutput || '',
                    actual: lo.userOutput || '',
                    expectedMask: lo.expectedMask || '',
                    varName: lo.varName || `Line ${parseInt(idx) + 1}`,
                  }))}
                  width={currentChallenge.gridWidth || 30}
                  height={currentChallenge.gridHeight || 3}
                />
              ) : (
                // printf: use combined output approach
                <InterleavedOutputGrid
                  expected={Object.values(lineOutputs).map(lo => lo.expectedOutput || '').join('')}
                  actual={Object.values(lineOutputs).map(lo => lo.userOutput || '').join('')}
                  width={currentChallenge.gridWidth || 30}
                  height={currentChallenge.gridHeight || 3}
                />
              )}
            </>
          )}
          {/* Original Expected Output grid for beginner mode */}
          {selectedDifficulty === 'beginner' && currentChallenge.expectedOutput && (
            <>
              <h4>Expected Output:</h4>
              <CharacterGrid
                text={currentChallenge.expectedOutput}
                mask={currentChallenge.expectedOutputMask}
                width={currentChallenge.gridWidth || 30}
                height={currentChallenge.gridHeight || 3}
                showRows={false}
              />
            </>
          )}



          <AnswerSection
            formatCalls={currentChallenge.formatCalls}
            variables={currentChallenge.variables}
            difficulty={selectedDifficulty}
            currentIndex={currentFormatCallIndex}
            userAnswers={userAnswers}
            solvedAnswers={solvedAnswers}
            lineErrors={lineErrors}
            onAnswerChange={(updater) => {
              setUserAnswers(updater);
              if (hasSubmitted && !feedback?.isCorrect) {
                setFeedback(null);
                setLineErrors({});
                setHasSubmitted(false);
              }
            }}
            onSubmit={checkAnswer}
            isDisabled={feedback?.isCorrect === true}
            submitDisabled={submitDisabled}
            hintShown={hintShown}
            onHint={handleHint}
            focusToken={focusToken}
          />

          <FeedbackDisplay
            feedback={feedback}
            onNewChallenge={handleNextChallenge}
            showNextButton={feedback?.isCorrect === true}
          />
        </div>

        <StatsPanel stats={stats} />
      </div>
    </div>
  );
}
