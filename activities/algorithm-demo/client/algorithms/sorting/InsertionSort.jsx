import React, { useLayoutEffect, useRef, useState } from 'react';
import PseudocodeRenderer from '../../components/PseudocodeRenderer';

const PSEUDOCODE = [
  'InsertionSort(A[0..n−1])',
  '    for i ← 1 to n − 1',
  '        tmp ← A[i]',
  '        j ← i − 1',
  '        while j ≥ 0 and A[j] > tmp',
  '            A[j + 1] ← A[j]',
  '            j ← j − 1',
  '        A[j + 1] ← tmp',
];

const ITEM_PX = 52; // used for shift animation offset only

/**
 * Algorithm module for Insertion Sort
 */
const InsertionSort = {
  id: 'insertion-sort',
  name: 'Insertion Sort',
  description: 'Build sorted array by inserting elements one by one',
  category: 'sorting',
  pseudocode: PSEUDOCODE,

  initState(arraySize = 8) {
    const array = Array.from({ length: arraySize }, () => Math.floor(Math.random() * 100) + 1);
    return {
      array,
      initialArray: [...array],
      i: 1,
      j: 0,
      tmp: null,
      substep: 0,
      sorted: false,
      currentStep: null,
      highlightedLines: new Set(),
      shiftedIndices: [],
      transitionIndices: [],
      moveAnimations: {},
      tmpAnim: null,
      tmpPos: null,
    };
  },

  reduceEvent(state, event) {
    if (event.type === 'nextStep') {
      return performNextStep(state);
    }
    if (event.type === 'reset') {
      return {
        array: [...state.initialArray],
        initialArray: state.initialArray,
        i: 1,
        j: 0,
        tmp: null,
        substep: 0,
        sorted: false,
        currentStep: null,
        highlightedLines: new Set(),
        shiftedIndices: [],
        transitionIndices: [],
        moveAnimations: {},
        tmpAnim: null,
        tmpPos: null,
      };
    }
    if (event.type === 'setArraySize') {
      return InsertionSort.initState(event.payload);
    }
    return state;
  },

  ManagerView({ session, onStateChange }) {
    const state = session.data.algorithmState || InsertionSort.initState();

    const handleNextStep = () => {
      const newState = performNextStep(state);
      onStateChange(newState);
    };

    const handleReset = () => {
      onStateChange(InsertionSort.reduceEvent(state, { type: 'reset' }));
    };

    const handleRegenerate = () => {
      onStateChange(InsertionSort.initState());
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
    const state = session.data.algorithmState || InsertionSort.initState();

    const handleNextStep = () => {
      if (!onStateChange) return;
      const newState = performNextStep(state);
      onStateChange(newState);
    };

    const handleReset = () => {
      if (!onStateChange) return;
      onStateChange(InsertionSort.reduceEvent(state, { type: 'reset' }));
    };

    const handleRegenerate = () => {
      if (!onStateChange) return;
      onStateChange(InsertionSort.initState());
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
  const shiftedSet = new Set(Array.isArray(state.shiftedIndices) ? state.shiftedIndices : []);
  const transitionSet = new Set(Array.isArray(state.transitionIndices) ? state.transitionIndices : []);
  const itemRefs = useRef({});
  const tmpRef = useRef(null);
  const [tmpOffsets, setTmpOffsets] = useState({ offsetX: 0, offsetY: 0, targetX: 0, targetY: 0 });

  const registerItemRef = (idx) => (el) => {
    if (el) itemRefs.current[idx] = el;
  };

  useLayoutEffect(() => {
    const tmpEl = tmpRef.current;
    if (!tmpEl) return;
    const tmpRect = tmpEl.getBoundingClientRect();
    const tmpCenterX = tmpRect.left + tmpRect.width / 2;
    const tmpCenterY = tmpRect.top + tmpRect.height / 2;

    if (state.tmpAnim === 'from-array' && itemRefs.current[state.i]) {
      const srcRect = itemRefs.current[state.i].getBoundingClientRect();
      const srcCenterX = srcRect.left + srcRect.width / 2;
      const srcCenterY = srcRect.top + srcRect.height / 2;
      setTmpOffsets({ 
        offsetX: srcCenterX - tmpCenterX, 
        offsetY: srcCenterY - tmpCenterY,
        targetX: 0,
        targetY: 0
      });
    } else if (state.tmpAnim === 'to-array' && state.tmpPos != null && itemRefs.current[state.tmpPos]) {
      const dstRect = itemRefs.current[state.tmpPos].getBoundingClientRect();
      const dstCenterX = dstRect.left + dstRect.width / 2;
      const dstCenterY = dstRect.top + dstRect.height / 2;
      setTmpOffsets({ 
        offsetX: 0,
        offsetY: 0,
        targetX: dstCenterX - tmpCenterX,
        targetY: dstCenterY - tmpCenterY
      });
    } else {
      setTmpOffsets({ offsetX: 0, offsetY: 0, targetX: 0, targetY: 0 });
    }
  }, [state.tmpAnim, state.tmpPos, state.i, state.array.length]);

  return (
    <div className="array-viz">
      <div className="array-container">
        {state.array.map((val, idx) => {
          const moveOffset = state.moveAnimations?.[idx];
          const moveStyle = moveOffset ? { '--move-offset': `${moveOffset}px` } : undefined;

          return (
            <div key={idx} style={{ position: "relative" }} ref={registerItemRef(idx)}>
              {idx === state.i && (
                <div className="index-badge badge-i-centered">i</div>
              )}
              {idx === state.j && state.substep >= 3 && (
                <div className="index-badge badge-j-centered">j</div>
              )}
              <div
                className={`array-item ${idx < state.i ? "sorted" : ""} ${idx === state.i ? "current-i" : ""} ${shiftedSet.has(idx) ? "shifted" : ""} ${transitionSet.has(idx) ? "transition" : ""} ${state.tmpPos === idx ? "tmp-placed" : ""} ${moveOffset ? "move-anim" : ""}`}
                style={moveStyle}
              >
                {val}
              </div>
              <div className="array-index">{idx}</div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "16px", justifyContent: "center", marginTop: "20px" }}>
        <div className="tmp-box">
          <div className="tmp-label">tmp</div>
          <div
            className={`tmp-value${state.tmpAnim === 'from-array' ? ' tmp-from-array' : ''}${state.tmpAnim === 'to-array' ? ' tmp-to-array' : ''}`}
            ref={tmpRef}
            style={{ 
              '--tmp-offset-x': `${tmpOffsets.offsetX}px`,
              '--tmp-offset-y': `${tmpOffsets.offsetY}px`,
              '--tmp-target-x': `${tmpOffsets.targetX}px`,
              '--tmp-target-y': `${tmpOffsets.targetY}px`
            }}
          >
            {state.tmp}
          </div>
        </div>
        <div className="var-box">
          <div className="var-label">i</div>
          <div className="var-value">{state.i}</div>
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

function performNextStep(state) {
  const arr = [...state.array];
  let { i, j, tmp, substep, shiftedIndices, transitionIndices, tmpPos, moveAnimations, tmpAnim } = state;
  let highlightedLines = new Set();
  let currentStep = null;

  if (state.sorted) return state;

  if (i >= arr.length) {
    return { ...state, sorted: true, currentStep: 'Algorithm complete', highlightedLines: new Set() };
  }

  // Clear shifted/transition indices and tmpPos on new iteration
  if (substep === 0) {
    shiftedIndices = [];
    transitionIndices = [];
    moveAnimations = {};
    tmpAnim = null;
    tmp = null;
    tmpPos = null;
    // Start new iteration: highlight for loop
    highlightedLines.add('line-1');
    currentStep = `Outer loop: i=${i}`;
    substep = 1;
  } else if (substep === 1) {
    // Get tmp value
    tmp = arr[i];
    tmpAnim = 'from-array';
    highlightedLines.add('line-2');
    currentStep = `Set tmp = A[${i}] = ${tmp}`;
    substep = 2;
  } else if (substep === 2) {
    // Initialize j
    j = i - 1;
    highlightedLines.add('line-3');
    currentStep = `Set j = ${i} - 1 = ${j}`;
    substep = 3;
  } else if (substep === 3) {
    // Check while condition
    const conditionMet = j >= 0 && arr[j] > tmp;
    highlightedLines.add('line-4');
    currentStep = `Check while: j=${j} >= 0 and A[${j}]=${arr[j]} > ${tmp}? ${conditionMet ? 'Yes' : 'No'}`;
    substep = conditionMet ? 4 : 5; // 4 = enter loop body, 5 = skip to insert
  } else if (substep === 4) {
    // Inside while: shift element
    arr[j + 1] = arr[j];
    shiftedIndices = [...shiftedIndices, j]; // Track the position we're shifting FROM (gray)
    transitionIndices = [...transitionIndices, j + 1]; // Track where we're shifting TO (blue)
    moveAnimations = { ...moveAnimations, [j + 1]: -52 };
    highlightedLines.add('line-5');
    currentStep = `Shift: A[${j + 1}] = A[${j}] = ${arr[j + 1]}`;
    substep = 4.5;
  } else if (substep === 4.5) {
    // Inside while: decrement j
    j--;
    highlightedLines.add('line-6');
    currentStep = `Decrement: j = ${j}`;
    substep = 3; // Loop back to check condition again
  } else if (substep === 5) {
    // After loop: insert tmp
    arr[j + 1] = tmp;
    tmpPos = j + 1; // Mark where tmp is placed (green)
    moveAnimations = {}; // let tmp animation show the travel
    tmpAnim = 'to-array';
    // Keep tmp visible during travel; value arrives visually, then next iteration clears tmp
    i++;
    substep = 0;
    highlightedLines.add('line-7');
    currentStep = `Insert: A[${j + 1}] = ${arr[j + 1]}`;
  }

  return {
    ...state,
    array: arr,
    i,
    j,
    tmp,
    substep,
    highlightedLines,
    currentStep,
    shiftedIndices,
    transitionIndices,
    tmpPos,
    moveAnimations,
    tmpAnim,
  };
}

export default InsertionSort;
