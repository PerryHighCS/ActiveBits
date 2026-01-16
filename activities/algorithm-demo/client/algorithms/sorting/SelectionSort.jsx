import React, { useState, useEffect } from 'react';
import PseudocodeRenderer from '../../components/PseudocodeRenderer';

const PSEUDOCODE = [
  'SelectionSort(A[0..n−1])',
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
    return {
      array: Array.from({ length: arraySize }, () => Math.floor(Math.random() * 100) + 1),
      i: 0,
      minIndex: 0,
      j: 0,
      substep: 0,
      sorted: false,
      currentStep: null,
      highlightedLines: new Set(),
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
      return SelectionSort.initState(state.array.length);
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
      onStateChange(SelectionSort.initState());
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
        </div>
        <ArrayVisualization state={state} />
        <PseudocodeRenderer
          lines={PSEUDOCODE}
          highlightedIds={state.highlightedLines}
        />
      </div>
    );
  },

  /**
   * Student view (read-only)
   */
  StudentView({ session }) {
    const state = session.data.algorithmState || SelectionSort.initState();
    return (
      <div className="algorithm-student">
        <ArrayVisualization state={state} />
        <PseudocodeRenderer
          lines={PSEUDOCODE}
          highlightedIds={state.highlightedLines}
        />
      </div>
    );
  },
};

/**
 * Array visualization component
 */
function ArrayVisualization({ state }) {
  return (
    <div className="array-viz">
      <div className="array-container">
        {state.array.map((val, idx) => (
          <div
            key={idx}
            className={`array-item ${
              idx === state.i ? 'current-i' : ''
            } ${idx === state.minIndex ? 'current-min' : ''} ${
              idx < state.i ? 'sorted' : ''
            } ${
              // Highlight j during inner loop steps
              state.substep >= 3 && idx === state.j ? 'current-j' : ''
            }`}
          >
            {val}
          </div>
        ))}
      </div>
      <div className="status">
        i={state.i}, minIndex={state.minIndex}, j={state.j}
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
  let { i, j, minIndex, substep } = state;
  let highlightedLines = new Set();
  let currentStep = null;

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
      substep = needSwap ? 6.5 : 7; // swap or increment i
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
  } else if (substep === 6.5) {
    // Perform swap
    [arr[i], arr[minIndex]] = [arr[minIndex], arr[i]];
    i++;
    // Emphasize entering next iteration by highlighting for-loop line
    highlightedLines.add('line-1');
    currentStep = `Swap done; advance i to ${i}`;
    substep = 1; // next step will set minIndex ← i
  } else if (substep === 7) {
    // No swap needed, move to next i
    i++;
    highlightedLines.add('line-1');
    currentStep = `No swap; advance i to ${i}`;
    substep = 1; // next step will set minIndex ← i
  }

  return {
    ...state,
    array: arr,
    i,
    j,
    minIndex,
    substep,
    highlightedLines,
    currentStep,
  };
}

export default SelectionSort;
