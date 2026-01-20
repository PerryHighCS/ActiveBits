import React, { useState } from 'react';
import PseudocodeRenderer from '../../components/PseudocodeRenderer';

const PSEUDOCODE = [
  '**GuessingGame(maxN)**',
  '    secret ← Random(1, maxN)',
  '    while true',
  '        guess ← GetUserGuess()',
  '        if guess == secret then',
  '            return "Won in X guesses"',
  '        else if guess < secret then',
  '            print "Guess higher"',
  '        else',
  '            print "Guess lower"',
];

const BinarySearchGame = {
  id: 'guessing-game',
  name: 'Guessing Game',
  description: 'Interactive guessing game demonstrating search efficiency',
  category: 'guessing',
  pseudocode: PSEUDOCODE,

  initState(maxN = 128, mode = 'human') {
    const computerState = mode === 'computer' ? {
      low: 1,
      high: maxN,
      currentGuess: Math.floor((1 + maxN) / 2),
      waitingForFeedback: false,
      started: false
    } : null;
    
    return {
      maxN,
      secret: mode === 'human' ? Math.floor(Math.random() * maxN) + 1 : null,
      guesses: [],
      won: false,
      hint: mode === 'computer' ? { type: 'info', message: 'Click Start when you have a number in mind!' } : null,
      currentStep: null,
      highlightedLines: new Set(),
      maxGuessesNeeded: Math.ceil(Math.log2(maxN)),
      mode, // 'human' or 'computer'
      computerState,
    };
  },

  reduceEvent(state, event) {
    if (event.type === 'guess') {
      return handleGuess(state, event.payload);
    }
    if (event.type === 'newGame') {
      return BinarySearchGame.initState(state.maxN, state.mode);
    }
    if (event.type === 'setMode') {
      return BinarySearchGame.initState(state.maxN, event.payload);
    }
    if (event.type === 'computerStart') {
      return {
        ...state,
        computerState: {
          ...state.computerState,
          started: true,
          waitingForFeedback: true
        },
        hint: null
      };
    }
    if (event.type === 'computerFeedback') {
      return handleComputerFeedback(state, event.payload);
    }
    return state;
  },

  ManagerView({ session, onStateChange }) {
    const state = session.data.algorithmState || BinarySearchGame.initState();
    const [inputValue, setInputValue] = useState('');

    const handleSubmitGuess = () => {
      const guess = parseInt(inputValue);
      if (!isNaN(guess) && guess >= 1 && guess <= state.maxN) {
        onStateChange(handleGuess(state, guess));
        setInputValue('');
      }
    };

    const handleNewGame = () => {
      onStateChange(BinarySearchGame.initState(state.maxN, state.mode));
      setInputValue('');
    };

    const handleComputerFeedback = (feedback) => {
      onStateChange(BinarySearchGame.reduceEvent(state, { type: 'computerFeedback', payload: feedback }));
    };

    const handleStart = () => {
      onStateChange(BinarySearchGame.reduceEvent(state, { type: 'computerStart' }));
    };

    const handleModeChange = (mode) => {
      onStateChange(BinarySearchGame.initState(state.maxN, mode));
      setInputValue('');
    };

    return (
      <div className="algorithm-manager">
        <div className="controls" style={{ marginBottom: '16px' }}>
          <button onClick={handleNewGame}>New Game</button>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontWeight: 500 }}>Mode:</span>
            <button 
              onClick={() => handleModeChange('human')}
              style={{
                background: state.mode === 'human' ? '#4a90e2' : '#ccc',
                color: state.mode === 'human' ? 'white' : '#666'
              }}
            >
              Human Guesses
            </button>
            <button 
              onClick={() => handleModeChange('computer')}
              style={{
                background: state.mode === 'computer' ? '#4a90e2' : '#ccc',
                color: state.mode === 'computer' ? 'white' : '#666'
              }}
            >
              Computer Guesses
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 auto', width: 'fit-content', minWidth: '240px' }}>
            <PseudocodeRenderer
              lines={PSEUDOCODE}
              highlightedIds={state.highlightedLines}
            />
          </div>

          <div style={{ flex: '1 1 400px', minWidth: '320px' }}>
            <div className="game-display">
              <h2>Guessing Game (Max: {state.maxN})</h2>
              <p>Should be guessed in {state.maxGuessesNeeded} or fewer guesses!</p>
              <p className="hint">
                {state.mode === 'human' 
                  ? `I'm thinking of a number between 1 and ${state.maxN}.`
                  : (state.guesses.length > 0 || state.computerState?.started
                      ? `Computer is guessing a number between ${state.computerState.low} and ${state.computerState.high}.`
                      : `Think of a number between 1 and ${state.maxN}...`)
                }
              </p>
            </div>

            {!state.won && state.mode === 'human' && (
              <div className="guess-controls">
                <input
                  type="number"
                  min="1"
                  max={state.maxN}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSubmitGuess()}
                  placeholder="Enter your guess"
                />
                <button onClick={handleSubmitGuess}>Guess</button>
              </div>
            )}

            {!state.won && state.mode === 'computer' && !state.computerState?.started && (
              <div className="guess-controls">
                <button onClick={handleStart} style={{ background: '#4caf50', fontSize: '16px', padding: '12px 24px' }}>
                  {state.guesses.length === 0 ? 'Start Guessing' : 'Next Guess'}
                </button>
              </div>
            )}

            {!state.won && state.mode === 'computer' && state.computerState?.started && state.computerState?.waitingForFeedback && (
              <>
                <div style={{ marginBottom: '16px', padding: '16px', background: '#e3f2fd', borderRadius: '8px', border: '2px solid #1976d2' }}>
                  <div style={{ fontSize: '18px', fontWeight: 600, color: '#1976d2', textAlign: 'center' }}>
                    Computer's guess #{state.guesses.length + 1}: {state.computerState.currentGuess}
                  </div>
                </div>
                <div className="guess-controls">
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button onClick={() => handleComputerFeedback('low')} style={{ background: '#0288d1' }}>Too Low (Higher)</button>
                    <button onClick={() => handleComputerFeedback('correct')} style={{ background: '#4caf50' }}>Correct!</button>
                    <button onClick={() => handleComputerFeedback('high')} style={{ background: '#d32f2f' }}>Too High (Lower)</button>
                  </div>
                </div>
              </>
            )}

            {state.hint && <div className={`hint ${state.hint.type}`}>{state.hint.message}</div>}

            <GuessHistory state={state} />
          </div>
        </div>
      </div>
    );
  },

  StudentView({ session, onStateChange }) {
    const state = session.data.algorithmState || BinarySearchGame.initState();
    const [inputValue, setInputValue] = useState('');

    const handleSubmitGuess = () => {
      if (!onStateChange) return;
      const guess = parseInt(inputValue);
      if (!isNaN(guess) && guess >= 1 && guess <= state.maxN) {
        onStateChange(handleGuess(state, guess));
        setInputValue('');
      }
    };

    const handleNewGame = () => {
      if (!onStateChange) return;
      onStateChange(BinarySearchGame.initState(state.maxN, state.mode));
      setInputValue('');
    };

    const handleComputerFeedback = (feedback) => {
      if (!onStateChange) return;
      onStateChange(BinarySearchGame.reduceEvent(state, { type: 'computerFeedback', payload: feedback }));
    };

    const handleStart = () => {
      if (!onStateChange) return;
      onStateChange(BinarySearchGame.reduceEvent(state, { type: 'computerStart' }));
    };

    const handleModeChange = (mode) => {
      if (!onStateChange) return;
      onStateChange(BinarySearchGame.initState(state.maxN, mode));
      setInputValue('');
    };

    const soloControls = onStateChange ? (
      <>
        {!state.won && state.mode === 'human' && (
          <div className="guess-controls">
            <input
              type="number"
              min="1"
              max={state.maxN}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSubmitGuess()}
              placeholder="Enter your guess"
            />
            <button onClick={handleSubmitGuess}>Guess</button>
          </div>
        )}

        {!state.won && state.mode === 'computer' && !state.computerState?.started && (
          <div className="guess-controls">
            <button onClick={handleStart} style={{ background: '#4caf50', fontSize: '16px', padding: '12px 24px' }}>
              {state.guesses.length === 0 ? 'Start Guessing' : 'Next Guess'}
            </button>
          </div>
        )}

        {!state.won && state.mode === 'computer' && state.computerState?.waitingForFeedback && (
          <div className="guess-controls">
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <button onClick={() => handleComputerFeedback('low')} style={{ background: '#0288d1' }}>Too Low (Higher)</button>
              <button onClick={() => handleComputerFeedback('correct')} style={{ background: '#4caf50' }}>Correct!</button>
              <button onClick={() => handleComputerFeedback('high')} style={{ background: '#d32f2f' }}>Too High (Lower)</button>
            </div>
          </div>
        )}

        {state.hint && <div className={`hint ${state.hint.type}`}>{state.hint.message}</div>}

        <GuessHistory state={state} />
      </>
    ) : (
      <>
        {state.hint && <div className={`hint ${state.hint.type}`}>{state.hint.message}</div>}
        <GuessHistory state={state} />
      </>
    );

    const controlBar = onStateChange ? (
      <div className="controls" style={{ marginBottom: '16px' }}>
        <button onClick={handleNewGame}>New Game</button>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontWeight: 500 }}>Mode:</span>
          <button 
            onClick={() => handleModeChange('human')}
            style={{
              background: state.mode === 'human' ? '#4a90e2' : '#ccc',
              color: state.mode === 'human' ? 'white' : '#666'
            }}
          >
            Human Guesses
          </button>
          <button 
            onClick={() => handleModeChange('computer')}
            style={{
              background: state.mode === 'computer' ? '#4a90e2' : '#ccc',
              color: state.mode === 'computer' ? 'white' : '#666'
            }}
          >
            Computer Guesses
          </button>
        </div>
      </div>
    ) : null;

    return (
      <div className="algorithm-student">
        {controlBar}
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 auto', width: 'fit-content', minWidth: '240px' }}>
            <PseudocodeRenderer
              lines={PSEUDOCODE}
              highlightedIds={state.highlightedLines}
            />
          </div>

          <div style={{ flex: '1 1 400px', minWidth: '320px' }}>
            <div className="game-display">
              <h2>Guessing Game (Max: {state.maxN})</h2>
              <p>Should be guessed in {state.maxGuessesNeeded} or fewer guesses!</p>
              {onStateChange ? (
                <>
                  <p className="hint">
                    {state.mode === 'human'
                      ? `I'm thinking of a number between 1 and ${state.maxN}.`
                      : (state.guesses.length > 0 || state.computerState?.started
                          ? `Computer is guessing a number between ${state.computerState.low} and ${state.computerState.high}.`
                          : `Think of a number between 1 and ${state.maxN}...`)
                    }
                  </p>
                </>
              ) : (
                <>
                  <p>Watching instructor play...</p>
                  {state.mode === 'computer' && (state.guesses.length > 0 || state.computerState?.started) && (
                    <p className="hint">
                      Computer is guessing a number between {state.computerState.low} and {state.computerState.high}.
                    </p>
                  )}
                </>
              )}
            </div>

            {!state.won && state.mode === 'computer' && state.computerState?.started && state.computerState?.waitingForFeedback && (
              <div style={{ marginBottom: '16px', padding: '16px', background: '#e3f2fd', borderRadius: '8px', border: '2px solid #1976d2' }}>
                <div style={{ fontSize: '18px', fontWeight: 600, color: '#1976d2', textAlign: 'center' }}>
                  Computer's guess #{state.guesses.length + 1}: {state.computerState.currentGuess}
                </div>
              </div>
            )}

            {soloControls}
          </div>
        </div>
      </div>
    );
  },
};

function GuessHistory({ state }) {
  const guesses = Array.isArray(state.guesses) ? state.guesses : [];

  return (
    <div className="guess-history">
      <h3>Guess History:</h3>
      {guesses.length === 0 ? (
        <p className="empty">No guesses yet</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: '6px' }}>
          {guesses.map((g, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 'bold', minWidth: '24px' }}>#{idx + 1}:</span>
              <strong>{g.guess}</strong>
              <span style={{ color: g.result === 'win' ? '#2e7d32' : g.result === 'low' ? '#0288d1' : '#d32f2f' }}>
                {g.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function handleComputerFeedback(state, feedback) {
  if (state.won || state.mode !== 'computer') return state;

  const { computerState } = state;
  const guess = computerState.currentGuess;
  let guesses = [...state.guesses];
  let won = false;
  let hint = null;
  let message;
  let result;
  let newComputerState = { ...computerState };

  const attemptNumber = guesses.length + 1;

  if (feedback === 'correct') {
    won = true;
    hint = { type: 'success', message: `Correct! The computer guessed ${guess} in ${attemptNumber} tries.` };
    message = 'Correct!';
    result = 'win';
    newComputerState.waitingForFeedback = false;
    newComputerState.started = false;
  } else if (feedback === 'low') {
    hint = { type: 'higher', message: 'Adjusting range higher...' };
    message = 'Too low';
    result = 'low';
    newComputerState = {
      low: guess + 1,
      high: computerState.high,
      currentGuess: Math.floor((guess + 1 + computerState.high) / 2),
      waitingForFeedback: false,
      started: false
    };
  } else if (feedback === 'high') {
    hint = { type: 'lower', message: 'Adjusting range lower...' };
    message = 'Too high';
    result = 'high';
    newComputerState = {
      low: computerState.low,
      high: guess - 1,
      currentGuess: Math.floor((computerState.low + guess - 1) / 2),
      waitingForFeedback: false,
      started: false
    };
  }

  const newGuess = { guess, message, result, timestamp: Date.now() };
  guesses = [...guesses, newGuess];

  return {
    ...state,
    guesses,
    won,
    hint,
    computerState: newComputerState,
    highlightedLines: new Set(),
    currentStep: won ? `Won in ${attemptNumber} guesses!` : `Computer guessed ${guess}: ${message}`,
  };
}

function handleGuess(state, guess) {
  let { secret, guesses, won, hint } = state;
  const highlightedLines = new Set();
  let currentStep = null;

  let message;
  let result;

  const attemptNumber = guesses.length + 1;

  if (guess === secret) {
    won = true;
    hint = { type: 'success', message: `Correct! The secret was ${secret}! Guessed in ${attemptNumber} tries.` };
    message = 'Correct!';
    result = 'win';
    currentStep = `Won in ${attemptNumber} guesses!`;
  } else if (guess < secret) {
    hint = { type: 'higher', message: 'Guess higher!' };
    message = 'Too low';
    result = 'low';
    currentStep = `${guess} is too low`;
  } else {
    hint = { type: 'lower', message: 'Guess lower!' };
    message = 'Too high';
    result = 'high';
    currentStep = `${guess} is too high`;
  }

  const newGuess = { guess, message, result, timestamp: Date.now() };
  guesses = [...guesses, newGuess];

  return {
    ...state,
    guesses,
    won,
    hint,
    highlightedLines,
    currentStep,
  };
}

export default BinarySearchGame;
