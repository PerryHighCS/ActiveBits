import React, { useState } from 'react';
import PseudocodeRenderer from '../../components/PseudocodeRenderer';

const PSEUDOCODE = [
  'BinarySearchGuessingGame(maxN)',
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
  id: 'binary-search-game',
  name: 'Binary Search Guessing Game',
  description: 'Interactive guessing game demonstrating binary search efficiency',
  category: 'guessing',
  pseudocode: PSEUDOCODE,

  initState(maxN = 128) {
    return {
      maxN,
      secret: Math.floor(Math.random() * maxN) + 1,
      guesses: [],
      won: false,
      hint: null,
      currentStep: null,
      highlightedLines: new Set(),
      maxGuessesNeeded: Math.ceil(Math.log2(maxN)),
    };
  },

  reduceEvent(state, event) {
    if (event.type === 'guess') {
      return handleGuess(state, event.payload);
    }
    if (event.type === 'newGame') {
      return BinarySearchGame.initState(state.maxN);
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
      onStateChange(BinarySearchGame.initState());
      setInputValue('');
    };

    return (
      <div className="algorithm-manager">
        <div className="game-display">
          <h2>Guessing Game (Max: {state.maxN})</h2>
          <p className="hint">I'm thinking of a number between 1 and {state.maxN}.</p>
          <p>You should be able to guess it in {state.maxGuessesNeeded} or fewer guesses!</p>
        </div>

        {!state.won ? (
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
        ) : null}

        {state.hint && <div className={`hint ${state.hint.type}`}>{state.hint.message}</div>}

        <GuessHistory state={state} />

        {state.won && (
          <div className="won-display">
            🎉 You won in {state.guesses.length} guesses!
            <button onClick={handleNewGame} className="btn-primary">
              Play Again
            </button>
          </div>
        )}

        <PseudocodeRenderer
          lines={PSEUDOCODE}
          highlightedIds={state.highlightedLines}
        />
        {state.currentStep && <div className="step-info">{state.currentStep}</div>}
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
      onStateChange(BinarySearchGame.initState(state.maxN));
      setInputValue('');
    };

    const soloControls = onStateChange ? (
      <>
        {!state.won ? (
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
        ) : null}

        {state.hint && <div className={`hint ${state.hint.type}`}>{state.hint.message}</div>}

        <GuessHistory state={state} />

        {state.won && (
          <div className="won-display">
            🎉 You won in {state.guesses.length} guesses!
            <button onClick={handleNewGame} className="btn-primary">
              Play Again
            </button>
          </div>
        )}
      </>
    ) : (
      <>
        {state.hint && <div className={`hint ${state.hint.type}`}>{state.hint.message}</div>}
        <GuessHistory state={state} />
        {state.won && (
          <div className="won-display">
            🎉 Instructor won in {state.guesses.length} guesses!
          </div>
        )}
      </>
    );

    return (
      <div className="algorithm-student">
        <div className="game-display">
          <h2>Guessing Game (Max: {state.maxN})</h2>
          {onStateChange ? (
            <>
              <p className="hint">I'm thinking of a number between 1 and {state.maxN}.</p>
              <p>You should be able to guess it in {state.maxGuessesNeeded} or fewer guesses!</p>
            </>
          ) : (
            <p>Watching instructor play...</p>
          )}
        </div>

        {soloControls}

        <PseudocodeRenderer
          lines={PSEUDOCODE}
          highlightedIds={state.highlightedLines}
        />
        {state.currentStep && <div className="step-info">{state.currentStep}</div>}
      </div>
    );
  },
};

function GuessHistory({ state }) {
  return (
    <div className="guess-history">
      <h3>Guess History:</h3>
      {state.guesses.length === 0 ? (
        <p className="empty">No guesses yet</p>
      ) : (
        <ol>
          {state.guesses.map((g, idx) => (
            <li key={idx}>{g.guess}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function handleGuess(state, guess) {
  let { secret, guesses, won, hint } = state;
  const highlightedLines = new Set();
  let currentStep = null;

  const newGuess = { guess, timestamp: Date.now() };
  guesses = [...guesses, newGuess];

  if (guess === secret) {
    won = true;
    hint = { type: 'success', message: `🎉 Correct! The secret was ${secret}!` };
    currentStep = `Won in ${guesses.length} guesses!`;
  } else if (guess < secret) {
    hint = { type: 'higher', message: '📈 Guess higher!' };
    currentStep = `${guess} is too low`;
  } else {
    hint = { type: 'lower', message: '📉 Guess lower!' };
    currentStep = `${guess} is too high`;
  }

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
