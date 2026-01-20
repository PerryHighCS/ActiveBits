import React, { useState, useEffect } from 'react';
import PseudocodeRenderer from '../../components/PseudocodeRenderer';

const PSEUDOCODE = [
  '**LinearSearch(A[0..n−1], target)**',
  '    for i ← 0 to n − 1',
  '        if A[i] == target then',
  '            return i',
  '    return −1',
];

const LinearSearch = {
  id: 'linear-search',
  name: 'Linear Search',
  description: 'Search by examining each element sequentially',
  category: 'search',
  pseudocode: PSEUDOCODE,

  initState(arraySize = 10, target = null) {
    const array = Array.from({ length: arraySize }, () => Math.floor(Math.random() * 100) + 1);
    const t = target !== null ? target : array[Math.floor(Math.random() * arraySize)];
    return {
      array,
      initialArray: [...array],
      target: t,
      i: 0,
      found: false,
      foundIndex: -1,
      substep: 0,
      currentStep: null,
      highlightedLines: new Set(),
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
        i: 0,
        found: false,
        foundIndex: -1,
        substep: 0,
        currentStep: null,
        highlightedLines: new Set(),
      };
    }
    return state;
  },

  ManagerView({ session, onStateChange }) {
    const state = session.data.algorithmState || LinearSearch.initState();
    const [inputTarget, setInputTarget] = useState(state.target);

    useEffect(() => {
      setInputTarget(state.target);
    }, [state.target]);

    return (
      <div className="algorithm-manager">
        <div className="target-display">
          <button onClick={() => {
            if (inputTarget !== state.target && inputTarget !== '') {
              onStateChange(LinearSearch.initState(state.array.length, inputTarget));
            } else {
              onStateChange(performNextStep(state));
            }
          }} disabled={state.found}>
            Next Step
          </button>
          <button onClick={() => onStateChange(LinearSearch.reduceEvent(state, { type: 'reset' }))}>Reset</button>
          <button onClick={() => onStateChange(LinearSearch.initState(state.array.length, null))}>
            Generate New Array
          </button>
          <div style={{ whiteSpace: 'nowrap' }}>
            Searching for:&nbsp;
            {state.found || state.i > 0 || state.substep > 0 ? (
              <strong>{state.target}</strong>
            ) : (
              <input
                type="number"
                value={inputTarget}
                onChange={(e) => setInputTarget(parseInt(e.target.value) || '')}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && inputTarget !== '') {
                    onStateChange(LinearSearch.initState(state.array.length, inputTarget));
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
          <div style={{ flex: '1 1 320px', minWidth: '280px' }}>
            <PseudocodeRenderer lines={PSEUDOCODE} highlightedIds={state.highlightedLines} />
          </div>
          <div style={{ flex: '1 1 380px', minWidth: '320px' }}>
            <ArrayVisualization state={state} />
          </div>
        </div>
      </div>
    );
  },

  StudentView({ session, onStateChange }) {
    const state = session.data.algorithmState || LinearSearch.initState();
    const [inputTarget, setInputTarget] = useState(state.target);

    useEffect(() => {
      setInputTarget(state.target);
    }, [state.target]);

    const handleNextStep = () => {
      if (!onStateChange) return;
      if (inputTarget !== state.target && inputTarget !== '') {
        onStateChange(LinearSearch.initState(state.array.length, inputTarget));
      } else {
        onStateChange(performNextStep(state));
      }
    };

    const handleReset = () => {
      if (!onStateChange) return;
      onStateChange(LinearSearch.reduceEvent(state, { type: 'reset' }));
    };

    const handleGenerate = () => {
      if (!onStateChange) return;
      onStateChange(LinearSearch.initState(state.array.length, null));
    };

    const controls = onStateChange ? (
      <div className="target-display" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={handleNextStep} disabled={state.found}>Next Step</button>
        <button onClick={handleReset}>Reset</button>
        <button onClick={handleGenerate}>Generate New Array</button>
        <div style={{ whiteSpace: 'nowrap' }}>
          Searching for:&nbsp;
          {state.found || state.i > 0 || state.substep > 0 ? (
            <strong>{state.target}</strong>
          ) : (
            <input
              type="number"
              value={inputTarget}
              onChange={(e) => setInputTarget(parseInt(e.target.value) || '')}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && inputTarget !== '') {
                  onStateChange(LinearSearch.initState(state.array.length, inputTarget));
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
          <div style={{ flex: '1 1 320px', minWidth: '280px' }}>
            <PseudocodeRenderer lines={PSEUDOCODE} highlightedIds={state.highlightedLines} />
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
            {idx === state.i && (
              <div className="index-badge">i</div>
            )}
            <div
              className={`array-item ${idx < state.i ? 'checked' : ''} ${
                idx === state.i ? 'current' : ''
              } ${idx === state.foundIndex ? 'found' : ''}`}
            >
              {val}
            </div>
            <div className="array-index">{idx}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '8px' }}>
        <div className="var-box">
          <div className="var-label">i</div>
          <div className="var-value">{state.i}</div>
        </div>
      </div>
      <div className="status">
        {state.found && (
          <span className="completed">
            {state.foundIndex >= 0 ? ` ✓ Found at index ${state.foundIndex}!` : ` ✗ Not found`}
          </span>
        )}
      </div>
    </div>
  );
}

function performNextStep(state) {
  let { array, target, i, found, foundIndex, substep } = state;
  let highlightedLines = new Set();
  let currentStep = null;

  if (found) return state;

  // Substep 0: Check for condition (line 1: for i ← 0 to n − 1)
  if (substep === 0) {
    const canContinue = i < array.length;
    highlightedLines.add('line-1');
    if (!canContinue) {
      substep = 99; // jump to return not found
      currentStep = `Loop complete: i=${i} >= array.length=${array.length}`;
    } else {
      substep = 1;
      currentStep = `Check loop: i=${i} < array.length=${array.length}? Yes`;
    }
  }
  // Substep 1: Check if condition (line 2: if A[i] == target then)
  else if (substep === 1) {
    const matches = array[i] === target;
    highlightedLines.add('line-2');
    if (matches) {
      substep = 2;
      currentStep = `Check: A[${i}] == ${target}? Yes`;
    } else {
      substep = 3;
      currentStep = `Check: A[${i}] == ${target}? No (A[${i}]=${array[i]})`;
    }
  }
  // Substep 2: Return if found (line 3: return i)
  else if (substep === 2) {
    found = true;
    foundIndex = i;
    highlightedLines.add('line-3');
    currentStep = `return ${i}`;
    substep = 100;
  }
  // Substep 3: Increment i (back to line 1 for next iteration)
  else if (substep === 3) {
    i++;
    highlightedLines.add('line-1');
    substep = 0;
    currentStep = `Increment: i ← ${i}`;
  }
  // Substep 99: Return not found (line 4: return −1)
  else if (substep === 99) {
    found = true;
    foundIndex = -1;
    highlightedLines.add('line-4');
    currentStep = `return −1`;
    substep = 100;
  }

  return {
    ...state,
    i,
    found,
    foundIndex,
    substep,
    highlightedLines,
    currentStep,
  };
}

export default LinearSearch;
