# Algorithm Demo - Extension Guide

This guide provides detailed instructions for extending the Algorithm Demo activity with new algorithms, visualizations, and features.

---

## Adding a New Algorithm

### Step 1: Create the Algorithm Module

Create a new file in `client/algorithms/{category}/YourAlgorithm.jsx`:

```javascript
import React from 'react';
import PseudocodeRenderer from '../../components/PseudocodeRenderer';

const PSEUDOCODE = [
  'YourAlgorithm(input)',
  '    initialize',
  '    process',
  '    return result',
];

const YourAlgorithm = {
  id: 'your-algorithm',           // Unique ID (kebab-case)
  name: 'Your Algorithm',          // Display name
  description: 'Brief description',
  category: 'category-name',       // sorting|search|recursion|guessing|other
  pseudocode: PSEUDOCODE,          // Array of code lines

  /**
   * Initialize algorithm state
   * Called when algorithm is selected or reset
   */
  initState(param1 = defaultValue) {
    return {
      // Your state structure
      currentStep: 0,
      highlightedLines: new Set(),
      currentStep: null,
      complete: false,
    };
  },

  /**
   * Handle events (optional)
   * Called by framework for 'nextStep', 'reset', custom events
   */
  reduceEvent(state, event) {
    if (event.type === 'nextStep') {
      return performNextStep(state);
    }
    if (event.type === 'reset') {
      return YourAlgorithm.initState();
    }
    return state;
  },

  /**
   * Manager view - instructor interface with controls
   */
  ManagerView({ session, onStateChange }) {
    const state = session.data.algorithmState || YourAlgorithm.initState();

    const handleNextStep = () => {
      const newState = performNextStep(state);
      onStateChange(newState);
    };

    return (
      <div className="algorithm-manager">
        <div className="controls">
          <button onClick={handleNextStep} disabled={state.complete}>
            Next Step
          </button>
          <button onClick={() => onStateChange(YourAlgorithm.initState())}>
            Reset
          </button>
        </div>

        {/* Your visualization component */}
        <YourVisualization state={state} />

        {/* Standard pseudocode renderer */}
        <PseudocodeRenderer
          lines={PSEUDOCODE}
          highlightedIds={state.highlightedLines}
        />

        {/* Optional: step description */}
        {state.currentStep && (
          <div className="step-info">{state.currentStep}</div>
        )}
      </div>
    );
  },

  /**
   * Student view - read-only in shared mode, controlled in solo
   */
  StudentView({ session }) {
    const state = session.data.algorithmState || YourAlgorithm.initState();

    return (
      <div className="algorithm-student">
        <YourVisualization state={state} />
        <PseudocodeRenderer
          lines={PSEUDOCODE}
          highlightedIds={state.highlightedLines}
        />
        {state.currentStep && (
          <div className="step-info">{state.currentStep}</div>
        )}
      </div>
    );
  },
};

/**
 * Your visualization component
 */
function YourVisualization({ state }) {
  return (
    <div className="your-viz">
      {/* Render your algorithm state */}
    </div>
  );
}

/**
 * Perform one step of your algorithm
 */
function performNextStep(state) {
  // Implement your step logic
  // Update state, compute highlighted lines, set description
  return newState;
}

export default YourAlgorithm;
```

### Step 2: Register the Algorithm

Add import to `activities/algorithm-demo/client/algorithms/index.js`:

```javascript
import YourAlgorithm from './category/YourAlgorithm.jsx';

const ALGORITHMS = [
  // ... existing algorithms
  YourAlgorithm,  // Add here
];
```

### Step 3: Update Tests

Add to `client/src/activities/index.test.js`:
```javascript
const EXPECTED_ACTIVITIES = [
  "algorithm-demo",
  // ... other activities
];
```

### Step 4: Test Registry Validation

Run tests to verify:
```bash
npm test --workspace client
```

Should see:
- ✅ Algorithm count matches expected (now 7)
- ✅ All pseudocode line references valid
- ✅ No duplicate IDs

---

## Custom Visualizations

### Array Visualization Example

```javascript
function ArrayVisualization({ array, highlightedIndices }) {
  return (
    <div className="array-container">
      {array.map((value, idx) => (
        <div
          key={idx}
          className={`array-item ${
            highlightedIndices.includes(idx) ? 'highlighted' : ''
          }`}
        >
          {value}
        </div>
      ))}
    </div>
  );
}
```

CSS:
```css
.array-container {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.array-item {
  min-width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e8f0fe;
  border: 2px solid #4a90e2;
  border-radius: 4px;
  transition: all 0.3s;
}

.array-item.highlighted {
  background: #fffacd;
  border-color: #ffd700;
  font-weight: bold;
}
```

### Graph Visualization Example

```javascript
function GraphVisualization({ nodes, edges, highlightedNodes }) {
  return (
    <svg className="graph-svg" width="400" height="300">
      {/* Draw edges */}
      {edges.map((edge, i) => (
        <line
          key={`edge-${i}`}
          x1={nodes[edge.from].x}
          y1={nodes[edge.from].y}
          x2={nodes[edge.to].x}
          y2={nodes[edge.to].y}
          stroke="#999"
          strokeWidth="2"
        />
      ))}

      {/* Draw nodes */}
      {nodes.map((node, i) => (
        <circle
          key={`node-${i}`}
          cx={node.x}
          cy={node.y}
          r="20"
          fill={highlightedNodes.includes(i) ? '#ffff00' : '#e8f0fe'}
          stroke="#4a90e2"
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}
```

---

## State Management Patterns

### Simple Step Counter

```javascript
function performNextStep(state) {
  if (state.step >= PSEUDOCODE.length - 1) {
    return { ...state, complete: true };
  }

  const newStep = state.step + 1;
  return {
    ...state,
    step: newStep,
    highlightedLines: new Set([`line-${newStep}`]),
  };
}
```

### Complex State with Nested Updates

```javascript
function performNextStep(state) {
  let array = [...state.array];
  let { i, j, minIdx } = state;
  let lines = new Set();
  let desc = '';

  // Implement algorithm logic
  if (j < array.length) {
    if (array[j] < array[minIdx]) {
      minIdx = j;
      lines.add('line-5');
      desc = `Found smaller element at index ${j}`;
    }
    j++;
  } else {
    // Swap
    [array[i], array[minIdx]] = [array[minIdx], array[i]];
    i++;
    j = i + 1;
    lines.add('line-7');
    desc = `Swapped elements`;
  }

  return {
    ...state,
    array,
    i,
    j,
    minIdx,
    highlightedLines: lines,
    currentStep: desc,
  };
}
```

---

## Advanced Features

### Algorithm with Configurable Parameters

```javascript
// In initState
initState(arraySize = 8, maxValue = 100) {
  const array = Array.from({ length: arraySize }, () =>
    Math.floor(Math.random() * maxValue) + 1
  );
  return {
    array,
    // ... rest of state
  };
}

// In ManagerView
<div className="controls">
  <label>
    Array Size:
    <input
      type="number"
      min="3"
      max="20"
      value={arraySize}
      onChange={(e) =>
        onStateChange(YourAlgorithm.initState(parseInt(e.target.value)))
      }
    />
  </label>
</div>
```

### Algorithm with History Tracking

```javascript
initState() {
  return {
    // ... state
    history: [],
  };
}

function performNextStep(state) {
  // ... compute newState
  
  return {
    ...newState,
    history: [
      ...state.history,
      {
        step: state.step + 1,
        action: 'description',
        timestamp: Date.now(),
      },
    ],
  };
}

// Display history
<div className="history">
  {state.history.map((entry, i) => (
    <div key={i}>{entry.step}: {entry.action}</div>
  ))}
</div>
```

### Algorithm with Input Validation

```javascript
const YourAlgorithm = {
  // ... other fields

  validateInput(input) {
    const errors = [];
    if (!Array.isArray(input)) errors.push('Must be an array');
    if (input.length < 2) errors.push('Minimum size is 2');
    if (input.length > 1000) errors.push('Maximum size is 1000');
    return errors;
  },
};
```

---

## Server-side Extensions

### Custom Endpoint

Add to `server/routes.js`:

```javascript
app.post('/api/algorithm-demo/:sessionId/custom-action', async (req, res) => {
  try {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'algorithm-demo') {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Your logic here
    const result = processRequest(req.body);

    // Optionally broadcast to students
    await broadcast('event', { type: 'custom', result }, session.id);

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### Recording Demonstrations

```javascript
// In session data
session.data.recording = {
  startTime: Date.now(),
  steps: [
    { timestamp, algorithmState, action },
    // ...
  ],
};

// Save on state-sync
session.data.recording.steps.push({
  timestamp: Date.now(),
  algorithmState,
  action: 'state-update',
});
```

---

## Styling Guidelines

### Use Consistent Classes

```css
/* Reuse these across all algorithms */
.algorithm-manager { }
.algorithm-student { }
.controls { }
.step-info { }
.complete { }
.error { }
```

### Color Palette

```javascript
const colors = {
  primary: '#4a90e2',       // Blue - current
  highlight: '#fffacd',    // Yellow - highlighted
  success: '#4caf50',       // Green - sorted/found
  warning: '#ffc107',       // Amber - checking
  danger: '#d32f2f',        // Red - incorrect
  neutral: '#e8f0fe',       // Light blue - neutral
};
```

---

## Performance Tips

1. **Memoize expensive computations**
   ```javascript
   const memoizedState = useMemo(() => computeState(state), [state]);
   ```

2. **Avoid re-creating objects in render**
   ```javascript
   // Bad
   highlightedIds={new Set(['line-0', 'line-1'])}
   
   // Good
   const highlightedIds = useMemo(() => 
     new Set(['line-0', 'line-1']), [line1, line2]
   );
   ```

3. **Optimize array operations**
   ```javascript
   // Use slice/concat instead of spread for large arrays
   const newArray = state.array.slice();
   newArray[i] = value;
   ```

4. **Debounce rapid updates**
   ```javascript
   const [debouncedState, setDebouncedState] = useState(state);
   useEffect(() => {
     const timer = setTimeout(() => setDebouncedState(state), 100);
     return () => clearTimeout(timer);
   }, [state]);
   ```

---

## Testing New Algorithms

### Unit Test Template

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import YourAlgorithm from '../YourAlgorithm.jsx';

test('YourAlgorithm - initialization', () => {
  const state = YourAlgorithm.initState(10);
  assert.ok(state.array);
  assert.equal(state.array.length, 10);
  assert.equal(state.step, 0);
});

test('YourAlgorithm - step progression', () => {
  let state = YourAlgorithm.initState(10);
  const initialStep = state.step;

  state = YourAlgorithm.reduceEvent(state, { type: 'nextStep' });
  assert.ok(state.step > initialStep);
});

test('YourAlgorithm - completion', () => {
  let state = YourAlgorithm.initState(3);
  
  while (!state.complete) {
    state = YourAlgorithm.reduceEvent(state, { type: 'nextStep' });
  }
  
  assert.ok(state.complete);
});
```

---

## Troubleshooting

### Algorithm not appearing in picker

1. Check `index.js` - algorithm added to `ALGORITHMS` array?
2. Run registry validation: `npm test --workspace client`
3. Clear browser cache
4. Rebuild: `npm run build --workspace client`

### Pseudocode lines not highlighting

1. Verify line ID format: `line-0`, `line-1`, etc.
2. Check `highlightedLines` is a `Set`
3. Ensure CSS rule exists for `.highlighted` class
4. Verify line count matches pseudocode array length

### State not synchronizing between instructor and students

1. Check `onStateChange` is called with new state
2. Verify WebSocket connection in browser DevTools
3. Check server logs for broadcast errors
4. Ensure `sessionId` matches on all clients

### Performance issues

1. Profile with DevTools Performance tab
2. Reduce array size in visualizations
3. Memoize expensive computations
4. Use `React.memo` for visualization components
5. Batch state updates

---

## Support & Examples

For complete examples, see:
- `SelectionSort.jsx` - Array-based sorting
- `BinarySearch.jsx` - Search with pruning
- `Factorial.jsx` - Recursion with stack
- `BinarySearchGame.jsx` - Interactive game

All examples include:
- Multiple state management patterns
- Visualization techniques
- User interaction handling
- Step descriptions
- Completion detection

