# Algorithm Demo Activity

A comprehensive instructor-driven algorithm demonstration system with synchronized visualization, pseudocode highlighting, and interactive step-through controls.

## Features

### Core Capabilities
- **Instructor-Driven Demos**: Teachers control algorithm execution step-by-step
- **Synchronized Visualization**: All students see the same visualization in real-time
- **Pseudocode Highlighting**: Lines are highlighted dynamically as the algorithm progresses
- **Sub-step Control**: Detailed, granular control over algorithm execution
- **History Tracking**: Session history of all algorithm selections and state changes
- **Solo Mode**: Students can independently explore algorithms with their own controls

### Implemented Algorithms

#### Sorting
- **Selection Sort**: Find minimum and swap
- **Insertion Sort**: Build sorted array incrementally

#### Searching
- **Binary Search**: Efficient search in sorted array with visualization
- **Linear Search**: Sequential element-by-element search

#### Recursion
- **Factorial**: Demonstrates call stack and recursion unwinding

#### Interactive
- **Binary Search Guessing Game**: Interactive guessing game leveraging binary search principles

## Architecture

### Message Protocol

All WebSocket messages follow this envelope:
```typescript
{
  type: "algorithm-selected" | "state-sync" | "event" | "pointer",
  payload: any,
  algorithmId?: string,
  sessionId?: string,
  timestamp: number
}
```

### Algorithm Module Contract

Each algorithm implements this interface:

```typescript
{
  id: string,                    // Unique identifier (kebab-case)
  name: string,                  // Display name
  description: string,           // Short description
  category: string,              // "sorting" | "search" | "recursion" | "guessing"
  pseudocode: string[],          // Array of pseudocode lines
  
  initState(params?): object,    // Initialize algorithm state
  
  ManagerView({                  // Instructor view with controls
    session, 
    onStateChange
  }): JSX,
  
  StudentView({                  // Student view (read-only in shared mode)
    session
  }): JSX,
  
  reduceEvent?(state, event): object  // Optional event reducer for consistency
}
```

### Session State Structure

```typescript
{
  id: string,
  type: 'algorithm-demo',
  data: {
    algorithmId: string,
    algorithmState: any,
    history: [
      {
        action: 'algorithm-selected' | 'state-update' | 'event',
        timestamp: number,
        ...metadata
      }
    ]
  }
}
```

### Pseudocode Line References

Lines are automatically assigned span IDs: `line-0`, `line-1`, etc.

Steps/events reference these IDs to highlight:
```typescript
highlightedLines: new Set(['line-2', 'line-5', 'line-8'])
```

Validation ensures all referenced IDs exist during algorithm registration.

## Usage

### Shared Mode (Instructor-Led)

1. Instructor creates a session
2. Students join with session ID
3. Instructor selects an algorithm
4. All students see the same algorithm
5. Instructor controls step-through with "Next Step" button
6. All state changes broadcast to students in real-time

### Solo Mode

1. Student accesses solo link (format: `solo-algorithm-demo`)
2. Algorithm picker displays all available algorithms
3. Student selects an algorithm
4. Student has full control over step-through
5. Progress optionally saved to localStorage

## File Structure

```
algorithm-demo/
├── activity.config.ts              # Activity metadata
├── client/
│   ├── index.tsx                   # Client entry point
│   ├── utils.ts                    # Shared utilities (messages, validation)
│   ├── utils.test.ts               # Utility tests
│   ├── components/
│   │   ├── PseudocodeRenderer.tsx  # Pseudocode display with highlighting
│   │   ├── PseudocodeRenderer.css
│   │   ├── AlgorithmPicker.tsx     # Algorithm selection UI
│   │   └── AlgorithmPicker.css
│   ├── manager/
│   │   ├── DemoManager.tsx         # Instructor view
│   │   └── DemoManager.css
│   ├── student/
│   │   ├── DemoStudent.tsx         # Student view (shared/solo)
│   │   └── DemoStudent.css
│   └── algorithms/
│       ├── index.ts                # Algorithm registry & validation
│       ├── index.test.ts           # Algorithm registry tests
│       ├── sorting/
│       │   ├── SelectionSort.tsx
│       │   └── InsertionSort.tsx
│       ├── search/
│       │   ├── BinarySearch.tsx
│       │   └── LinearSearch.tsx
│       ├── recursion/
│       │   └── Factorial.tsx
│       └── guessing/
│           └── BinarySearchGame.tsx
└── server/
    └── routes.ts                   # API endpoints and WebSocket setup
```

## API Endpoints

### Session Management

- `POST /api/algorithm-demo/create` - Create new demo session
- `GET /api/algorithm-demo/:sessionId/session` - Get current session state
- `POST /api/algorithm-demo/:sessionId/select` - Select algorithm (manager)
- `POST /api/algorithm-demo/:sessionId/state` - Update algorithm state (manager)
- `POST /api/algorithm-demo/:sessionId/event` - Publish event (extensible)

### WebSocket

- Path: `/ws/algorithm-demo?sessionId=...`
- Receives: `algorithm-selected`, `state-sync`, `event`, `pointer` messages

## Adding a New Algorithm

### 1. Create Algorithm Module

Create `activities/algorithm-demo/client/algorithms/{category}/{AlgoName}.tsx`:

```typescript
const PSEUDOCODE = [
  'Algorithm(input)',
  '    do something',
  '    process data',
];

const MyAlgorithm = {
  id: 'my-algorithm',
  name: 'My Algorithm',
  description: 'Brief description',
  category: 'category-name',
  pseudocode: PSEUDOCODE,
  
  initState(params) {
    return { /* initial state */ };
  },
  
  ManagerView({ session, onStateChange }) {
    // Render manager view with controls
  },
  
  StudentView({ session }) {
    // Render student view (read-only)
  },
};

export default MyAlgorithm;
```

### 2. Register Algorithm

Add import to `activities/algorithm-demo/client/algorithms/index.ts`:

```typescript
import MyAlgorithm from './category/MyAlgorithm';

const ALGORITHMS = [
  // ... existing
  MyAlgorithm,
];
```

### 3. Update Tests

Add algorithm ID to `EXPECTED_ACTIVITIES` in:
- `client/src/activities/index.test.ts`
- `server/activities/activityRegistry.test.ts`

### 4. Validate

Run tests:
```bash
npm test --workspace client -- algorithm-demo
```

## Testing

### Algorithm Registry Tests

Validates:
- All algorithms have required fields
- Pseudocode line references are valid
- No duplicate IDs
- Algorithms count matches expectations

Run with:
```bash
npm test --workspace client
```

### Utility Tests

Tests message protocol, line ID validation, and event reducer pattern.

## State Management

Each algorithm manages its own state using a reducer-like pattern:

```typescript
function reduceEvent(state, event) {
  switch(event.type) {
    case 'nextStep':
      return performNextStep(state);
    case 'reset':
      return initState();
    default:
      return state;
  }
}
```

## Performance Considerations

- **Lazy Loading**: Algorithms loaded via `React.lazy`
- **Message Batching**: State-sync bundles all changes in one message
- **History Trimming**: Consider clearing old history in long-running sessions
- **Local Caching**: Solo mode progress stored in localStorage

## Security Notes

- Session IDs should be validated server-side
- Instructor controls prevent students from modifying state in shared mode
- Solo sessions use `solo-` prefix for isolation
- WebSocket messages validated for correct algorithm ID

## Future Extensions

- **Recording & Playback**: Save demonstration for review
- **Multiple Visualizations**: Swap visualization implementations
- **Custom Algorithms**: Support student-created algorithms
- **Performance Analysis**: Track algorithm metrics (comparisons, swaps)
- **Peer Teaching**: Student-led demonstrations
- **Accessibility**: Screen reader support, keyboard navigation
