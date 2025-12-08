import React, { useState, useEffect, useRef, useCallback } from 'react';
import InterleavedOutputGrid from '../components/InterleavedOutputGrid';
import ExpectedOutputGrid from '../components/ExpectedOutputGrid';
import { useNavigate } from 'react-router-dom';
import '../components/styles.css';
import ChallengeSelector from '../components/ChallengeSelector';
import CharacterGrid from '../components/CharacterGrid';
import AnswerSection from '../components/AnswerSection';
import FeedbackDisplay from '../components/FeedbackDisplay';
import StatsPanel from '../components/StatsPanel';
import ReferenceModal from '../components/ReferenceModal';
import { formatReferenceData } from '../data/referenceData';
import { getRandomChallenge, formatWithMask, evaluateArgs } from '../challenges';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import { splitArgumentsRespectingQuotes, buildAnswerString, highlightDiff } from '../utils/stringUtils';
import { validateVariableReferences } from '../utils/validationUtils';

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

// Generate multiple cycles of alternative variable values for testing format robustness
// Cycle 0 is the original values, cycles 1-2 use alternative theme-appropriate values
function generateVariableCycles(variables, variableTemplates, numCycles = 3) {
  if (!variables || variables.length === 0) return [];
  
  const cycles = [];
  
  // Cycle 0: Original values
  const originalCycle = {};
  variables.forEach(v => {
    let val = v.value;
    // Remove quotes from string literals for the value map
    if (v.type === 'String' && val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    originalCycle[v.name] = v.type === 'String' ? val : parseFloat(val) || 0;
  });
  cycles.push(originalCycle);
  
  // Cycles 1+: Alternative values from variableTemplates
  for (let c = 1; c < numCycles; c++) {
    const cycleVarMap = {};
    
    variables.forEach(v => {
      // Find the corresponding template for this variable
      const template = variableTemplates?.find(vt => vt.names?.includes(v.name));
      
      let newValue;
      if (template?.values && Array.isArray(template.values)) {
        // Use theme-specific values from the template
        const valueIndex = c % template.values.length;
        newValue = template.values[valueIndex];
      } else if (template?.range) {
        // Generate from range
        const { min, max, step = 1, precision } = template.range;
        if (v.type === 'double') {
          const options = [];
          for (let val = min; val <= max && options.length < 5; val += (max - min) / 4) {
            options.push(parseFloat(val.toFixed(precision ?? 2)));
          }
          newValue = options[c % options.length];
        } else {
          const options = [];
          for (let val = min; val <= max && options.length < 5; val += Math.max(step, (max - min) / 4)) {
            options.push(Math.round(val));
          }
          newValue = options[c % options.length];
        }
      } else {
        // Fallback to generic values if no template found
        if (v.type === 'String') {
          const stringOptions = ['test', 'sample', 'data'];
          newValue = stringOptions[c % stringOptions.length];
        } else if (v.type === 'double') {
          const doubleOptions = [1.5, 2.75, 3.333];
          newValue = doubleOptions[c % doubleOptions.length];
        } else {
          const intOptions = [10, 25, 50];
          newValue = intOptions[c % intOptions.length];
        }
      }
      
      // Store raw value (not quoted for strings)
      cycleVarMap[v.name] = v.type === 'String' ? String(newValue) : Number(newValue);
    });
    
    cycles.push(cycleVarMap);
  }
  return cycles;
}

export default function JavaFormatPractice({ sessionData }) {
  const sessionId = sessionData?.sessionId;
  const isSoloSession = sessionId ? sessionId.startsWith('solo-') : false;
  const studentIdRef = useRef(null);
  const cycleTimerRef = useRef(null);
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
  const [showReference, setShowReference] = useState(false);

  const [stats, setStats] = useState({
    total: 0,
    correct: 0,
    streak: 0,
    longestStreak: 0,
  });
  const [focusToken, setFocusToken] = useState(0);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // Cycling feature: for advanced mode after correct answer
  const [isCyclingMode, setIsCyclingMode] = useState(false);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [variableCycles, setVariableCycles] = useState([]);
  const [cycleOutputs, setCycleOutputs] = useState({});
  const [cycleMismatchLine, setCycleMismatchLine] = useState(null);

  const splitAnswerParts = useCallback((answer = '') => splitArgumentsRespectingQuotes(answer), []);

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
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'session-ended') {
          navigate('/session-ended');
          return;
        }
        if (message.type === 'studentId') {
          const newStudentId = message.payload.studentId;
          setStudentId(newStudentId);
          localStorage.setItem(`student-id-${sessionId}`, newStudentId);
        } else if (message.type === 'difficultyUpdate') {
          const difficulty = message.payload.difficulty || 'beginner';
          setSelectedDifficulty(difficulty);
          const challenge = getRandomChallenge(
            selectedTheme === 'all' ? null : selectedTheme,
            difficulty
          );
          setCurrentChallenge(challenge);
        } else if (message.type === 'themeUpdate') {
          const theme = message.payload.theme || 'all';
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
            : meta?.type === 'variable'
            ? 'argument'
            : 'entry';
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

        if (isCorrect) {
          newStats.correct += 1;
          newStats.streak += 1;
          if (newStats.streak > newStats.longestStreak) {
            newStats.longestStreak = newStats.streak;
          }
        } else {
          newStats.streak = 0;
        }

        return newStats;
      });

      let explanation = undefined;
      let firstWrongPartIdx = -1;
      if (isCorrect) {
        explanation = formatCall.explanation;
      } else if (wrongParts.length > 0) {
        const wrongTypes = userParts.map((part, idx) => adjustedUserParts[idx] !== adjustedExpectedParts[idx] ? (inputsMeta[idx]?.type) : null).filter(Boolean);
        if (wrongTypes.includes('format-string') || wrongTypes.includes('string-literal')) {
          explanation = formatCall.explanation;
        }
        // Find the first wrong part index
        for (let i = 0; i < adjustedUserParts.length; i++) {
          if (adjustedUserParts[i] !== adjustedExpectedParts[i]) {
            firstWrongPartIdx = i;
            break;
          }
        }
      }

      setFeedback({
        isCorrect,
        message: isCorrect
          ? 'Correct!'
          : detailedMessage || 'Not quite. Try again.',
        explanation,
        wrongPartIdx: firstWrongPartIdx,
      });
    } else {
      // Intermediate/Advanced mode: validate all lines and collect valid outputs
      setHasSubmitted(true);
      let validOutputs = [];
      const outputsByLine = {};
      const newLineErrors = {}; // Track errors locally during this check
      
      calls.forEach((call, idx) => {
        const userSubmitted = buildAnswerString(userAnswers[idx] || []);
        if (!userSubmitted) return;
        
        let syntaxError = '';
        let userOutputText = '';
        let userMask = '';
        
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
              userMask = userOutput.mask;
            } catch (err) {
              const availableVars = Object.keys(valueMap).join(', ');
              syntaxError = `${err.message}. Check your variable names and expressions. Available variables: ${availableVars}`;
              console.error('Format evaluation error:', err, 'User expressions:', userArgExprs, 'Available vars:', valueMap);
            }
          }
        } catch (err) {
          syntaxError = 'Syntax error in format string.';
        }
        
        if (syntaxError) {
          newLineErrors[idx] = syntaxError;
        }
        
        // Store valid outputs if no syntax errors
        if (!syntaxError && userOutputText) {
          validOutputs.push(userOutputText);
        }
        
        // Always calculate expected output for this line from the call's answer
        // (even if there are syntax errors, so the grid shows what was expected)
        let expectedOutputText = '';
        let expectedMask = '';
        const answerStr = call.answer || '';
        if (answerStr.trim()) {
          try {
            const answerParts = splitArgumentsRespectingQuotes(answerStr);
            if (answerParts.length > 0) {
              // Support both quoted (advanced) and unquoted (beginner/intermediate) format strings
              const expectedFmt = answerParts[0].replace(/^"(.*)"$/, '$1');
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
          userMask: userMask,
          varName: varName,
        };
      });
      
      // Update lineOutputs and lineErrors with all collected data
      setLineOutputs(outputsByLine);
      setLineErrors(newLineErrors);

      // Check if any line has an error
      const hasAnyLineErrors = Object.keys(newLineErrors).length > 0;

      // Check if all lines match (normalized for grid comparison)
      const allLinesMatch = Object.values(outputsByLine).length > 0 && Object.values(outputsByLine).every(line => {
        const normalize = (s) => (s || '').replace(/%n/g, '\n').replace(/\r\n/g, '\n');
        const normalizeMask = (m) => (m || '').replace(/\r\n/g, '\n');
        return (
          normalize(line.expectedOutput) === normalize(line.userOutput) &&
          normalizeMask(line.expectedMask) === normalizeMask(line.userMask)
        );
      });

      if (hasAnyLineErrors) {
        // Don't enter cycling mode if there are syntax errors
        setFeedback({
          isCorrect: false,
          message: 'Some lines have syntax errors. Please check your format strings.',
        });
      } else if (allLinesMatch) {
        // For advanced difficulty, enter cycling mode to test with different values
        if (selectedDifficulty === 'advanced') {
          const cycles = generateVariableCycles(currentChallenge.variables, currentChallenge.variableTemplates, 3);
          setVariableCycles(cycles);
          setCycleIndex(0);
          setIsCyclingMode(true);
          setCycleMismatchLine(null);
          // Initialize cycleOutputs with the current (original) lineOutputs for cycle 0
          setCycleOutputs(outputsByLine);
          setFeedback({
            isCorrect: true,
            message: 'All lines correct! Testing with different values...',
          });
          // Automatic cycling will start via useEffect
        } else {
          setFeedback({
            isCorrect: true,
            message: 'All lines correct! Great job.',
          });
        }
      } else {
        setFeedback({
          isCorrect: false,
          message: 'Some lines are incorrect. Please check your output and try again.',
        });
      }
    }
  };

  const handleCycleNext = () => {
    if (!variableCycles || cycleIndex >= variableCycles.length - 1) {
      // All cycles completed successfully - advance to next challenge
      setIsCyclingMode(false);
      setCycleIndex(0);
      setVariableCycles([]);
      setCycleOutputs({});
      handleNextChallenge();
      return false;
    }
    
    const nextIndex = cycleIndex + 1;
    const nextVariables = variableCycles[nextIndex];
    
    // Re-evaluate with new variables and check for mismatches
    const result = validateCycleOutputs(nextVariables);
    setCycleIndex(nextIndex);
    setCycleOutputs(result.outputs);
    
    if (result.hasMismatch) {
      setCycleMismatchLine(result.mismatchInfo);
      const varName = (currentChallenge?.formatCalls?.[result.mismatchInfo.lineNumber - 1]?.skeleton?.match(/String\s+(\w+)\s*=/) || [, `variable ${result.mismatchInfo.lineNumber}`])[1];
      setFeedback({
        isCorrect: false,
        message: `Your format works with the original values but fails with different values (error in ${varName}).`,
      });
      return false; // Stop cycling
    } else {
      setCycleMismatchLine(null);
      return true; // Continue cycling
    }
  };

  const handleCyclePrevious = () => {
    if (cycleIndex <= 0) return;
    
    const prevIndex = cycleIndex - 1;
    const prevVariables = variableCycles[prevIndex];
    
    // Re-evaluate with previous variables
    const result = validateCycleOutputs(prevVariables);
    setCycleIndex(prevIndex);
    setCycleOutputs(result.outputs);
    setCycleMismatchLine(null);
  };

  // Automatic cycling effect
  useEffect(() => {
    // Clear any existing timer
    if (cycleTimerRef.current) {
      clearTimeout(cycleTimerRef.current);
      cycleTimerRef.current = null;
    }

    // Only auto-cycle if in cycling mode and no mismatch detected
    if (isCyclingMode && !cycleMismatchLine) {
      cycleTimerRef.current = setTimeout(() => {
        handleCycleNext();
      }, 1000);
    }

    // Cleanup on unmount or when cycling stops
    return () => {
      if (cycleTimerRef.current) {
        clearTimeout(cycleTimerRef.current);
        cycleTimerRef.current = null;
      }
    };
  }, [isCyclingMode, cycleIndex, cycleMismatchLine]);

  const validateCycleOutputs = (cycleVariables) => {
    const outputs = {};
    let hasMismatch = false;
    let mismatchInfo = null;

    // Re-evaluate all format calls with new variable values
    for (let i = 0; i < currentChallenge.formatCalls.length; i++) {
      const formatCall = currentChallenge.formatCalls[i];
      const userSubmitted = buildAnswerString(userAnswers[i] || []);
      
      try {
        // Parse and evaluate expected output with cycle variables
        const answerParts = splitArgumentsRespectingQuotes(formatCall.answer || '');
        let expectedOutputText = '';
        let expectedMask = '';
        if (answerParts[0]?.startsWith('"') && answerParts[0]?.endsWith('"')) {
          const expectedFmt = answerParts[0].slice(1, -1);
          const expectedArgExprs = answerParts.slice(1);
          const expectedArgValues = evaluateArgs(expectedArgExprs, cycleVariables);
          const expectedOutput = formatWithMask(expectedFmt, expectedArgValues);
          expectedOutputText = expectedOutput.text;
          expectedMask = expectedOutput.mask;
        }
        
        // Parse and evaluate user output with cycle variables
        const userParts = splitArgumentsRespectingQuotes(userSubmitted);
        let userOutputText = '';
        let userMask = '';
        if (userParts[0]?.startsWith('"') && userParts[0]?.endsWith('"')) {
          const userFmt = userParts[0].slice(1, -1);
          const userArgExprs = userParts.slice(1);
          const userArgValues = evaluateArgs(userArgExprs, cycleVariables);
          const userOutput = formatWithMask(userFmt, userArgValues);
          userOutputText = userOutput.text;
          userMask = userOutput.mask;
        }
        
        // Normalize and compare
        const normalize = (s) => (s || '').replace(/%n/g, '\n').replace(/\r\n/g, '\n');
        const normalizeMask = (m) => (m || '').replace(/\r\n/g, '\n');
        if (
          normalize(expectedOutputText) !== normalize(userOutputText) ||
          normalizeMask(expectedMask) !== normalizeMask(userMask)
        ) {
          hasMismatch = true;
          mismatchInfo = {
            lineNumber: i + 1,
            expectedOutput: expectedOutputText,
            userOutput: userOutputText
          };
        }

        // Extract variable name from skeleton
        let varName = '';
        const skeletonMatch = formatCall.skeleton?.match(/String\s+(\w+)\s*=/);
        if (skeletonMatch) {
          varName = skeletonMatch[1];
        }

        outputs[i] = {
          expectedOutput: expectedOutputText,
          userOutput: userOutputText,
          expectedMask: expectedMask,
          userMask: userMask,
          varName: varName,
        };
      } catch (error) {
        hasMismatch = true;
        mismatchInfo = {
          lineNumber: i + 1,
          error: error.message
        };
        outputs[i] = {
          expectedOutput: '(error)',
          userOutput: '(error)',
          error: error.message
        };
      }
    }
    
    return { outputs, hasMismatch, mismatchInfo };
  };

  // Get display variables - use cycling values if in cycling mode, otherwise original
  const getDisplayVariables = () => {
    if (!isCyclingMode || !variableCycles || !variableCycles[cycleIndex]) {
      return currentChallenge?.variables || [];
    }
    
    const cycleVars = variableCycles[cycleIndex];
    return (currentChallenge?.variables || []).map(v => {
      const cycleValue = cycleVars[v.name];
      if (cycleValue !== undefined) {
        return {
          ...v,
          value: v.type === 'String' ? `"${cycleValue}"` : String(cycleValue)
        };
      }
      return v;
    });
  };

  const handleShowReference = () => {
    setShowReference(true);
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

    // Reset cycling state
    setIsCyclingMode(false);
    setCycleIndex(0);
    setVariableCycles([]);
    setCycleOutputs({});
    setCycleMismatchLine(null);

    const pickChallenge = () => {
      const theme = selectedTheme === 'all' ? null : selectedTheme;
      let next = getRandomChallenge(theme, selectedDifficulty);
      let attempts = 0;
      while (next && currentChallenge && next.id === currentChallenge.id && attempts < 10) {
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
    setFeedback(null);
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
    setHasSubmitted(false);
    setFeedback(null);
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
    setHasSubmitted(false);
    setFeedback(null);
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
        <StatsPanel stats={stats} />
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
                  preComputedOutput={currentChallenge.expectedOutput}
                  preComputedMask={currentChallenge.expectedOutputMask}
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
              <h4>Output Comparison{isCyclingMode ? ` (Testing Set ${cycleIndex + 1} of ${variableCycles?.length || 0})` : ''}:</h4>
              {currentChallenge.formatCalls?.[0]?.method === 'format' ? (
                // String.format: pass lineData with variable names, keep %n to display as ↵
                <InterleavedOutputGrid
                  lineData={Object.entries(isCyclingMode && cycleOutputs && Object.keys(cycleOutputs).length > 0 ? cycleOutputs : lineOutputs).map(([idx, lo]) => ({
                    expected: lo.expectedOutput || '',
                    actual: lo.userOutput || '',
                    expectedMask: lo.expectedMask || '',
                    userMask: lo.userMask || '',
                    varName: lo.varName || `Line ${parseInt(idx) + 1}`,
                  }))}
                  width={currentChallenge.gridWidth || 30}
                  height={currentChallenge.gridHeight || 3}
                />
              ) : (
                // printf: use combined output approach
                <InterleavedOutputGrid
                  expected={Object.values(isCyclingMode && cycleOutputs && Object.keys(cycleOutputs).length > 0 ? cycleOutputs : lineOutputs).map(lo => lo.expectedOutput || '').join('')}
                  actual={Object.values(isCyclingMode && cycleOutputs && Object.keys(cycleOutputs).length > 0 ? cycleOutputs : lineOutputs).map(lo => lo.userOutput || '').join('')}
                  width={currentChallenge.gridWidth || 30}
                  height={currentChallenge.gridHeight || 3}
                />
              )}

              {/* Cycling controls - positioned below the grid */}
              {isCyclingMode && (
                <div style={{ marginTop: '12px', textAlign: 'center' }}>
                  {cycleMismatchLine ? (
                    // Show navigation buttons when mismatch detected (stopped)
                    <>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '8px' }}>
                        <button 
                          onClick={handleCyclePrevious}
                          disabled={cycleIndex === 0}
                          style={{
                            padding: '4px 10px',
                            backgroundColor: cycleIndex === 0 ? '#ccc' : '#2196F3',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: cycleIndex === 0 ? 'not-allowed' : 'pointer',
                            fontSize: '11px'
                          }}
                        >
                          ← Previous
                        </button>
                        <span style={{ 
                          padding: '4px 10px',
                          color: '#666',
                          fontSize: '11px',
                          display: 'flex',
                          alignItems: 'center'
                        }}>
                          Testing Set {cycleIndex + 1} of {variableCycles?.length || 0}
                        </span>
                      </div>
                      <div style={{ 
                        padding: '8px', 
                        backgroundColor: '#ffebee', 
                        borderRadius: '4px',
                        borderLeft: '4px solid #d32f2f'
                      }}>
                        <div style={{ fontWeight: 'bold', color: '#c62828', fontSize: '12px' }}>
                          ✗ Format Error on Line {cycleMismatchLine.lineNumber}
                        </div>
                      </div>
                    </>
                  ) : (
                    // Show automatic progress indicator with visual emphasis
                    <div style={{ 
                      display: 'flex', 
                      flexDirection: 'column',
                      gap: '8px',
                      alignItems: 'center',
                      backgroundColor: cycleIndex > 0 ? '#e8f5e9' : '#fff',
                      padding: '12px',
                      borderRadius: '8px',
                      border: cycleIndex > 0 ? '2px solid #4CAF50' : '1px solid #e0e0e0',
                      transition: 'all 0.3s ease',
                      animation: cycleIndex > 0 ? 'pulse 0.5s ease' : 'none'
                    }}>
                      <span style={{ 
                        padding: '4px 10px',
                        color: cycleIndex > 0 ? '#2e7d32' : '#666',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        {cycleIndex === 0 ? '📋 Original Values' : `🔄 Testing Set ${cycleIndex + 1} of ${variableCycles?.length || 0}`}
                      </span>
                      <div style={{
                        width: '250px',
                        height: '6px',
                        backgroundColor: '#e0e0e0',
                        borderRadius: '3px',
                        overflow: 'hidden',
                        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)'
                      }}>
                        <div style={{
                          width: `${((cycleIndex + 1) / (variableCycles?.length || 1)) * 100}%`,
                          height: '100%',
                          backgroundColor: cycleIndex >= (variableCycles?.length || 0) - 1 ? '#4CAF50' : '#2196F3',
                          transition: 'width 0.5s ease, background-color 0.3s ease',
                          boxShadow: '0 0 10px rgba(33, 150, 243, 0.5)'
                        }} />
                      </div>
                      <span style={{
                        fontSize: '11px',
                        color: cycleIndex >= (variableCycles?.length || 0) - 1 ? '#2e7d32' : '#555',
                        fontWeight: cycleIndex >= (variableCycles?.length || 0) - 1 ? 'bold' : 'normal'
                      }}>
                        {cycleIndex >= (variableCycles?.length || 0) - 1 ? '✓ All tests passing! Moving to next...' : '⏱️ Auto-testing with different values...'}
                      </span>
                    </div>
                  )}
                </div>
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



          <div style={{
            transition: 'all 0.3s ease',
            backgroundColor: isCyclingMode && cycleIndex > 0 ? '#f1f8e9' : 'transparent',
            padding: isCyclingMode && cycleIndex > 0 ? '12px' : '0',
            borderRadius: '8px',
            border: isCyclingMode && cycleIndex > 0 ? '2px solid #81c784' : 'none',
            animation: isCyclingMode && cycleIndex > 0 ? 'pulse 0.5s ease' : 'none'
          }}>
            <AnswerSection
              formatCalls={currentChallenge.formatCalls}
              variables={getDisplayVariables()}
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
              showReference={showReference}
              onShowReference={handleShowReference}
              focusToken={focusToken}
              fileName={currentChallenge.fileName}
              startingLine={currentChallenge.startingLine}
              feedback={feedback}
              onNewChallenge={handleNextChallenge}
              showNextButton={feedback?.isCorrect === true && !isCyclingMode}
              onFeedbackDismiss={() => setFeedback(null)}
            />
          </div>

          <ReferenceModal 
            isOpen={showReference}
            onClose={() => setShowReference(false)}
            referenceData={formatReferenceData}
          />
        </div>
      </div>
    </div>
  );
}
