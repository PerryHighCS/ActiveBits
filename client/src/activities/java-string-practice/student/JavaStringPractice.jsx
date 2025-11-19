import React, { useState, useEffect } from 'react';
import Button from '@src/components/ui/Button';
import '../components/styles.css';
import ChallengeSelector from '../components/ChallengeSelector';
import StringDisplay from '../components/StringDisplay';
import AnswerSection from '../components/AnswerSection';
import FeedbackDisplay from '../components/FeedbackDisplay';
import StatsPanel from '../components/StatsPanel';
import { generateChallenge, validateAnswer, getExplanation } from '../components/challengeLogic';

/**
 * JavaStringPractice - Student view for practicing Java String methods
 * Interactive challenges for substring(), indexOf(), equals(), length(), and compareTo()
 */
export default function JavaStringPractice({ sessionData }) {
  const sessionId = sessionData?.sessionId;
  const studentName = sessionData?.studentName || 'Student';

  const [currentChallenge, setCurrentChallenge] = useState(null);
  const [selectedTypes, setSelectedTypes] = useState(new Set(['all']));
  const [userAnswer, setUserAnswer] = useState('');
  const [selectedIndices, setSelectedIndices] = useState([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [hintShown, setHintShown] = useState(false);
  const [visualHintShown, setVisualHintShown] = useState(false);
  
  const [stats, setStats] = useState({
    total: 0,
    correct: 0,
    streak: 0,
  });

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
    }
  }, [stats, sessionId]);

  // Generate initial challenge
  useEffect(() => {
    if (!currentChallenge) {
      handleNewChallenge();
    }
  }, [currentChallenge]);

  const handleNewChallenge = () => {
    const challenge = generateChallenge(selectedTypes);
    setCurrentChallenge(challenge);
    setUserAnswer('');
    setSelectedIndices([]);
    setIsSelecting(false);
    setFeedback(null);
    setHintShown(false);
    setVisualHintShown(false);
  };

  const handleTypeSelection = (type) => {
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
    setTimeout(() => {
      const challenge = generateChallenge(newTypes);
      setCurrentChallenge(challenge);
      setUserAnswer('');
      setSelectedIndices([]);
      setIsSelecting(false);
      setFeedback(null);
      setHintShown(false);
      setVisualHintShown(false);
    }, 0);
  };

  const handleSubmit = (answer) => {
    const isCorrect = validateAnswer(currentChallenge, answer);
    
    // Update stats
    const newStats = {
      total: stats.total + 1,
      correct: stats.correct + (isCorrect && !visualHintShown ? 1 : 0),
      streak: isCorrect && !visualHintShown ? stats.streak + 1 : 0,
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

  return (
    <div className="java-string-container">
      <div className="java-string-header">
        <div className="game-title">Java String Methods Practice</div>
      </div>

      <div className="java-string-content">
        <div className="challenge-card">
          <div className="challenge-header">
            <ChallengeSelector
              selectedTypes={selectedTypes}
              onTypeSelect={handleTypeSelection}
            />
          </div>

          {currentChallenge && (
            <>
              <StringDisplay
                challenge={currentChallenge}
                selectedIndices={selectedIndices}
                visualHintShown={visualHintShown}
                onLetterClick={(index) => {
                  if (currentChallenge.type === 'substring') {
                    if (!isSelecting) {
                      setSelectedIndices([index]);
                      setIsSelecting(true);
                    } else {
                      const start = Math.min(selectedIndices[0], index);
                      const end = Math.max(selectedIndices[0], index) + 1;
                      setSelectedIndices([start, end]);
                      setIsSelecting(false);
                      const selected = currentChallenge.text.substring(start, end);
                      setUserAnswer(selected);
                    }
                  } else if (currentChallenge.type === 'indexOf') {
                    setSelectedIndices([index]);
                    setUserAnswer(index.toString());
                  }
                }}
              />

              <div className="question-hint-row">
                <div
                  className="question"
                  dangerouslySetInnerHTML={{ __html: currentChallenge.question }}
                />
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

        <StatsPanel stats={stats} />
      </div>
    </div>
  );
}
