import React, { useState, useEffect } from 'react';
import PseudocodeRenderer from '../../components/PseudocodeRenderer';

const PSEUDOCODE = [
  '**BinarySearch(A[0..n−1], target)**',
  '    left ← 0',
  '    right ← n − 1',
  '    while left ≤ right',
  '        mid ← floor((left + right) / 2)',
  '        if A[mid] == target then',
  '            return mid',
  '        else if A[mid] < target then',
  '            left ← mid + 1',
  '        else',
  '            right ← mid − 1',
  '    return −1',
];

const BinarySearch = {
  id: 'binary-search',
  name: 'Binary Search',
  description: 'Efficiently search in a sorted array',
  category: 'search',
  pseudocode: PSEUDOCODE,

  initState(arraySize = 16, target = null) {
    // Generate a random sorted array
    let nextValue = Math.floor(Math.random() * 20);
    const array = Array.from({ length: arraySize }, () => {
      const value = nextValue;
      nextValue += Math.floor(Math.random() * 5) + 1;
      return value;
    });
    const t = target !== null ? target : array[Math.floor(Math.random() * arraySize)];
    return {
      array,
      initialArray: [...array],
      target: t,
      left: 0,
      right: arraySize - 1,
      mid: null,
      substep: 0,
      found: false,
      foundIndex: -1,
      currentStep: null,
      highlightedLines: new Set(),
      history: [],
    };
  },

  reduceEvent(state, event) {
    if (event.type === 'nextStep') {
      return performNextStep(state);
    }
    if (event.type === 'reset') {
      const t = state.target !== null ? state.target : state.initialArray[Math.floor(Math.random() * state.initialArray.length)];
      return {
        array: [...state.initialArray],
        initialArray: state.initialArray,
        target: t,
        left: 0,
        right: state.initialArray.length - 1,
        mid: null,
        substep: 0,
        found: false,
        foundIndex: -1,
        currentStep: null,
        highlightedLines: new Set(),
        history: [],
      };
    }
    if (event.type === 'setTarget') {
      return BinarySearch.initState(state.array.length, event.payload);
    }
    return state;
  },

  ManagerView({ session, onStateChange }) {
    const state = session.data.algorithmState || BinarySearch.initState();
    const [inputTarget, setInputTarget] = useState(state.target);

    useEffect(() => {
      setInputTarget(state.target);
    }, [state.target]);

    const handleNextStep = () => {
      if (inputTarget !== state.target && inputTarget !== '') {
        // Keep the same array, just reset search with new target
        onStateChange({
          ...state,
          target: inputTarget,
          left: 0,
          right: state.array.length - 1,
          mid: null,
          substep: 0,
          found: false,
          foundIndex: -1,
          currentStep: null,
          highlightedLines: new Set(),
          history: [],
        });
      } else {
        onStateChange(performNextStep(state));
      }
    };

    const handleReset = () => {
      onStateChange(BinarySearch.reduceEvent(state, { type: 'reset' }));
    };

    return (
      <div className="algorithm-manager">
        <div className="target-display">
          <button onClick={handleNextStep} disabled={state.found}>
            Next Step
          </button>
          <button onClick={handleReset}>Reset</button>
          <button onClick={() => onStateChange(BinarySearch.initState(state.array.length, null))}>
            Generate New Array
          </button>
          <div style={{ whiteSpace: 'nowrap' }}>
            Searching for:&nbsp;
            {state.found || state.substep > 0 ? (
              <strong>{state.target}</strong>
            ) : (
              <input
                type="number"
                value={inputTarget}
                onChange={(e) => setInputTarget(parseInt(e.target.value) || '')}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && inputTarget !== '') {
                    onStateChange(BinarySearch.initState(state.array.length, inputTarget));
                  }
                }}
              />
            )}
          </div>
          {state.currentStep && (
            <div className="step-info" style={{ margin: 0, flex: '1 1 auto' }}>{state.currentStep}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 auto', width: 'fit-content', minWidth: '240px' }}>
            <PseudocodeRenderer
              lines={PSEUDOCODE}
              highlightedLines={state.highlightedLines}
            />
          </div>
          <div style={{ flex: '1 1 380px', minWidth: '320px' }}>
            <ArrayVisualization state={state} />
          </div>
        </div>
      </div>
    );
  },

  StudentView({ session, onStateChange }) {
    const state = session.data.algorithmState || BinarySearch.initState();
    const [inputTarget, setInputTarget] = useState(state.target);

    useEffect(() => {
      setInputTarget(state.target);
    }, [state.target]);

    const handleNextStep = () => {
      if (!onStateChange) return;
      if (inputTarget !== state.target && inputTarget !== '') {
        // Keep the same array, just reset search with new target
        onStateChange({
          ...state,
          target: inputTarget,
          left: 0,
          right: state.array.length - 1,
          mid: null,
          substep: 0,
          found: false,
          foundIndex: -1,
          currentStep: null,
          highlightedLines: new Set(),
          history: [],
        });
      } else {
        onStateChange(performNextStep(state));
      }
    };

    const handleReset = () => {
      if (!onStateChange) return;
      onStateChange(BinarySearch.reduceEvent(state, { type: 'reset' }));
    };

    const handleGenerate = () => {
      if (!onStateChange) return;
      onStateChange(BinarySearch.initState(state.array.length, null));
    };

    const controls = onStateChange ? (
      <div className="target-display" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={handleNextStep} disabled={state.found}>Next Step</button>
        <button onClick={handleReset}>Reset</button>
        <button onClick={handleGenerate}>Generate New Array</button>
        <div style={{ whiteSpace: 'nowrap' }}>
          Searching for:&nbsp;
          {state.found || state.substep > 0 ? (
            <strong>{state.target}</strong>
          ) : (
            <input
              type="number"
              value={inputTarget}
              onChange={(e) => setInputTarget(parseInt(e.target.value) || '')}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && inputTarget !== '') {
                  onStateChange(BinarySearch.initState(state.array.length, inputTarget));
                }
              }}
            />
          )}
        </div>
        {state.currentStep && (
          <div className="step-info" style={{ margin: 0, flex: '1 1 auto' }}>{state.currentStep}</div>
        )}
      </div>
    ) : (
      <div className="target-display" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ whiteSpace: 'nowrap' }}>Searching for: <strong>{state.target}</strong></div>
        {state.currentStep && (
          <div className="step-info" style={{ margin: 0, flex: '1 1 auto' }}>{state.currentStep}</div>
        )}
      </div>
    );

    return (
      <div className="algorithm-student">
        {controls}
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 auto', width: 'fit-content', minWidth: '240px' }}>
            <PseudocodeRenderer
              lines={PSEUDOCODE}
              highlightedLines={state.highlightedLines}
            />
          </div>
          <div style={{ flex: '1 1 380px', minWidth: '320px' }}>
            <ArrayVisualization state={state} />
          </div>
        </div>
      </div>
    );
  },
};

function ArrayVisualization({ state }) {
  return (
    <div className="array-viz">
      <div className="array-container">
        {state.array.map((val, idx) => (
          <div key={idx} style={{ position: 'relative' }}>
            {idx === state.left && (
              <div className="index-badge badge-left">L</div>
            )}
            {idx === state.right && (
              <div className="index-badge badge-right">R</div>
            )}
            {idx === state.mid && (
              <div className="index-badge badge-mid">M</div>
            )}
            <div
              className={`array-item ${
                idx < state.left || idx > state.right ? 'eliminated' : ''
              } ${idx === state.mid ? 'current-mid' : ''} ${
                idx === state.foundIndex ? 'found' : ''
              }`}
            >
              {val}
            </div>
            <div className="array-index">{idx}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
        <div className="var-box">
          <div className="var-label">left</div>
          <div className="var-value">{state.left}</div>
        </div>
        <div className="var-box">
          <div className="var-label">mid</div>
          <div className="var-value">{state.mid ?? '—'}</div>
        </div>
        <div className="var-box">
          <div className="var-label">right</div>
          <div className="var-value">{state.right}</div>
        </div>
      </div>
      <div className="status">
        {state.found && (
          <span className="completed">
            {state.foundIndex >= 0 ? `✓ Found at index ${state.foundIndex}!` : `✗ Not found`}
          </span>
        )}
      </div>
    </div>
  );
}

function performNextStep(state) {
  let { array, target, left, right, mid, found, foundIndex, history, substep } = state;
  let highlightedLines = new Set();
  let currentStep = null;

  if (found) return state;

  // Step-by-step highlighting
  if (substep === 0) {
    // Initialize left
    highlightedLines.add('line-1');
    currentStep = `Initialize: left ← 0`;
    substep = 1;
  } else if (substep === 1) {
    // Initialize right
    highlightedLines.add('line-2');
    currentStep = `Initialize: right ← n − 1 (${array.length - 1})`;
    substep = 2;
  } else if (substep === 2) {
    // Check while condition
    const cond = left <= right;
    highlightedLines.add('line-3');
    currentStep = `Check while: left=${left} ≤ right=${right}? ${cond ? 'Yes' : 'No'}`;
    substep = cond ? 3 : 99;
  } else if (substep === 3) {
    // Compute mid
    mid = Math.floor((left + right) / 2);
    highlightedLines.add('line-4');
    currentStep = `mid ← floor((${left} + ${right}) / 2) = ${mid} (A[mid]=${array[mid]})`;
    substep = 4;
  } else if (substep === 4) {
    // Check equals
    const eq = array[mid] === target;
    highlightedLines.add('line-5');
    currentStep = `Check: A[${mid}] == ${target}? ${eq ? 'Yes' : 'No'}`;
    substep = eq ? 6 : 5;
  } else if (substep === 6) {
    // Return mid (found)
    highlightedLines.add('line-6');
    found = true;
    foundIndex = mid;
    currentStep = `return ${mid}`;
    substep = 100;
  } else if (substep === 5) {
    // Else if A[mid] < target?
    const lt = array[mid] < target;
    highlightedLines.add('line-7');
    currentStep = `Check: A[${mid}]=${array[mid]} < ${target}? ${lt ? 'Yes' : 'No'}`;
    substep = lt ? 8 : 9;
  } else if (substep === 8) {
    // left ← mid + 1
    highlightedLines.add('line-8');
    left = mid + 1;
    mid = null;
    currentStep = `left ← ${left}`;
    substep = 2; // loop back to while
  } else if (substep === 9) {
    // else
    highlightedLines.add('line-9');
    currentStep = `else`;
    substep = 10;
  } else if (substep === 10) {
    // right ← mid − 1
    highlightedLines.add('line-10');
    right = mid - 1;
    mid = null;
    currentStep = `right ← ${right}`;
    substep = 2; // loop back
  } else if (substep === 99) {
    // return −1 (not found)
    highlightedLines.add('line-11');
    found = true;
    foundIndex = -1;
    currentStep = `return −1 (not found)`;
    substep = 100;
  }

  return {
    ...state,
    left,
    right,
    mid,
    found,
    foundIndex,
    substep,
    highlightedLines,
    currentStep,
    history: [...history, { left, right, mid, action: currentStep }],
  };
}

export default BinarySearch;
