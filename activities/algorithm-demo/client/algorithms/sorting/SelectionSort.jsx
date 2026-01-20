import React, { useState, useEffect } from 'react';
import PseudocodeRenderer from '../../components/PseudocodeRenderer';

const PSEUDOCODE = [
  '**SelectionSort(A[0..n−1])**',
  '    for i ← 0 to n − 2',
  '        minIndex ← i',
  '        for j ← i + 1 to n − 1',
  '            if A[j] < A[minIndex] then',
  '                minIndex ← j',
  '        if minIndex ≠ i then',
  '            swap A[i] and A[minIndex]',
];

/**
 * Algorithm module for Selection Sort
 */
const SelectionSort = {
  id: 'selection-sort',
  name: 'Selection Sort',
  description: 'Find minimum element and swap with current position',
  category: 'sorting',
  pseudocode: PSEUDOCODE,

  /**
   * Initialize algorithm state with random array
   */
  initState(arraySize = 8) {
    const array = Array.from({ length: arraySize }, () => Math.floor(Math.random() * 100) + 1);
    return {
      array,
      initialArray: [...array],
      i: 0,
      minIndex: 0,
      j: 0,
      substep: 0,
      sorted: false,
      currentStep: null,
      highlightedLines: new Set(),
      swappingIndices: [],
      swapAnimation: {},
    };
  },

  /**
   * Reduce events: nextStep, reset, setArraySize
   */
  reduceEvent(state, event) {
    if (event.type === 'nextStep') {
      return performNextStep(state);
    }
    if (event.type === 'reset') {
      return {
        array: [...state.initialArray],
        initialArray: state.initialArray,
        i: 0,
        minIndex: 0,
        j: 0,
        substep: 0,
        sorted: false,
        currentStep: null,
        highlightedLines: new Set(),
        swappingIndices: [],
        swapAnimation: {},
      };
    }
    if (event.type === 'setArraySize') {
      return SelectionSort.initState(event.payload);
    }
    return state;
  },

  /**
   * Manager view with controls
   */
  ManagerView({ session, onStateChange }) {
    const state = session.data.algorithmState || SelectionSort.initState();

    const handleNextStep = () => {
      const newState = performNextStep(state);
      onStateChange(newState);
    };

    const handleReset = () => {
      onStateChange(SelectionSort.reduceEvent(state, { type: 'reset' }));
    };

    const handleRegenerate = () => {
      onStateChange(SelectionSort.initState());
    };

    return (
      <div className="algorithm-manager">
        <div className="controls">
          <button onClick={handleNextStep} disabled={state.sorted}>
            Next Step
          </button>
          <button onClick={handleReset}>Reset</button>
          <button onClick={handleRegenerate}>Generate New Array</button>
          {state.currentStep && (
            <div className="step-info" style={{ margin: 0, flex: '1 1 auto' }}>{state.currentStep}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', minWidth: '280px' }}>
            <PseudocodeRenderer
              lines={PSEUDOCODE}
              highlightedIds={state.highlightedLines}
            />
          </div>
          <div style={{ flex: '1 1 380px', minWidth: '320px' }}>
            <ArrayVisualization state={state} />
          </div>
        </div>
      </div>
    );
  },

  /**
   * Student view (read-only)
   */
  StudentView({ session, onStateChange }) {
    const state = session.data.algorithmState || SelectionSort.initState();

    const handleNextStep = () => {
      if (!onStateChange) return;
      const newState = performNextStep(state);
      onStateChange(newState);
    };

    const handleReset = () => {
      if (!onStateChange) return;
      onStateChange(SelectionSort.reduceEvent(state, { type: 'reset' }));
    };

    const handleRegenerate = () => {
      if (!onStateChange) return;
      onStateChange(SelectionSort.initState());
    };

    const controls = onStateChange ? (
      <div className="controls">
        <button onClick={handleNextStep} disabled={state.sorted}>
          Next Step
        </button>
        <button onClick={handleReset}>Reset</button>
        <button onClick={handleRegenerate}>Generate New Array</button>
        {state.currentStep && (
          <div className="step-info" style={{ margin: 0, flex: '1 1 auto' }}>{state.currentStep}</div>
        )}
      </div>
    ) : (
      state.currentStep && <div className="step-info" style={{ margin: '0 0 16px 0' }}>{state.currentStep}</div>
    );

    return (
      <div className="algorithm-student">
        {controls}
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', minWidth: '280px' }}>
            <PseudocodeRenderer
              lines={PSEUDOCODE}
              highlightedIds={state.highlightedLines}
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

/**
 * Array visualization component
 */
function ArrayVisualization({ state }) {
  const swappingSet = new Set(Array.isArray(state.swappingIndices) ? state.swappingIndices : []);

  return (
    <div className="array-viz">
      <div className="array-container">
        {state.array.map((val, idx) => {
          const offset = state.swapAnimation?.[idx] || 0;
          const swapStyle = offset ? { '--swap-offset': `${offset * 52}px` } : undefined;

          return (
            <div key={idx} style={{ position: 'relative' }}>
              {idx === state.i && (
                <div className="index-badge badge-i">i</div>

              )}
              {idx === state.j && state.substep >= 3 && (
                <div className="index-badge badge-j">j</div>
              )}
              {idx === state.minIndex && (
                <div className="index-badge badge-min">m</div>
              )}
              <div
                className={`array-item ${
                  idx === state.i ? 'current-i' : ''
                } ${idx === state.minIndex ? 'current-min' : ''} ${
                  idx < state.i ? 'sorted' : ''
                } ${
                  state.substep >= 3 && idx === state.j ? 'current-j' : ''
                } ${offset ? 'swap-anim' : ''}`}
                style={swapStyle}
              >
                {val}
              </div>
              <div className="array-index">{idx}</div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '20px' }}>
        <div className="var-box">
          <div className="var-label">i</div>
          <div className="var-value">{state.i}</div>
        </div>
        <div className="var-box">
          <div className="var-label">minIndex</div>
          <div className="var-value">{state.minIndex}</div>
        </div>
        <div className="var-box">
          <div className="var-label">j</div>
          <div className="var-value">{state.j}</div>
        </div>
      </div>
      <div className="status">
        {state.sorted && <span className="completed"> ✓ Sorted!</span>}
      </div>
    </div>
  );
}

/**
 * Perform one step of the algorithm
 */
function performNextStep(state) {
  const arr = [...state.array];
  let { i, j, minIndex, substep, swapAnimation } = state;
  let highlightedLines = new Set();
  let currentStep = null;

  // If we have an active swap animation from the previous step, clear it now
  if (substep !== 6 && swapAnimation && Object.keys(swapAnimation).length) {
    swapAnimation = {};
  }

  // Already sorted
  if (state.sorted) return state;

  // Completed outer loop
  if (i >= arr.length - 1) {
    return {
      ...state,
      sorted: true,
      currentStep: 'Algorithm complete',
      highlightedLines: new Set(),
    };
  }

  // Step control
  if (substep === 0) {
    // Highlight outer loop line
    highlightedLines.add('line-1');
    currentStep = `Outer loop: i=${i}`;
    substep = 1;
  } else if (substep === 1) {
    // Set minIndex ← i
    minIndex = i;
    highlightedLines.add('line-2');
    currentStep = `Set minIndex = i (${i})`;
    substep = 2;
  } else if (substep === 2) {
    // Initialize inner loop
    j = i + 1;
    highlightedLines.add('line-3');
    currentStep = `Inner loop: j starts at ${j}`;
    substep = 3;
  } else if (substep === 3) {
    // Check if j within bounds and compare
    if (j < arr.length) {
      highlightedLines.add('line-4');
      const isSmaller = arr[j] < arr[minIndex];
      currentStep = `Check: A[${j}]=${arr[j]} < A[${minIndex}]=${arr[minIndex]}? ${isSmaller ? 'Yes' : 'No'}`;
      substep = isSmaller ? 4 : 5; // go assign or advance j
    } else {
      // End inner loop, check swap condition
      highlightedLines.add('line-6');
      const needSwap = minIndex !== i;
      currentStep = `Check swap: minIndex (${minIndex}) ${needSwap ? '≠' : '='} i (${i})`;
      substep = needSwap ? 6 : 7; // animate swap or increment i
    }
  } else if (substep === 4) {
    // Assign new minIndex ← j
    minIndex = j;
    highlightedLines.add('line-5');
    currentStep = `Update minIndex = j (${j})`;
    substep = 4.2; // separate step to advance j and show inner for
  } else if (substep === 4.2) {
    // Advance j and emphasize inner for increment
    j++;
    highlightedLines.add('line-3');
    currentStep = `Advance j to ${j}`;
    substep = 3; // loop back to condition
  } else if (substep === 5) {
    // Condition false, advance j and emphasize inner for increment
    j++;
    highlightedLines.add('line-3');
    currentStep = `Advance j to ${j}`;
    substep = 3;
  } else if (substep === 6) {
    // Single-step swap: swap data now and animate elements moving to their new spots
    highlightedLines.add('line-7');
    // Compute offsets based on where values came from
    const offsets = {
      [i]: minIndex - i,
      [minIndex]: i - minIndex,
    };
    [arr[i], arr[minIndex]] = [arr[minIndex], arr[i]];
    swapAnimation = offsets;
    currentStep = `Swap A[${i}] with A[${minIndex}]`;
    substep = 6.5; // highlight loop and advance i next
  } else if (substep === 6.5) {
    // Advance i after swap, highlighting the for loop line
    highlightedLines.add('line-1');
    i++;
    currentStep = `Advance i to ${i}`;
    substep = 1; // move to next outer iteration
  } else if (substep === 7) {
    // No swap needed, move to next i
    i++;
    highlightedLines.add('line-1');
    currentStep = `No swap; advance i to ${i}`;
    substep = 1; // next step will set minIndex ← i
  }

  const swappingIndices = swapAnimation && Object.keys(swapAnimation).length
    ? Object.keys(swapAnimation).map((k) => parseInt(k, 10))
    : [];

  return {
    ...state,
    array: arr,
    i,
    j,
    minIndex,
    substep,
    highlightedLines,
    currentStep,
    swappingIndices,
    swapAnimation,
  };
}

export default SelectionSort;
