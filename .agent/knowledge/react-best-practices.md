# React Best Practices

Capture reusable React patterns, performance guidance, and accessibility conventions for this repository.

## Notes Template

- Date:
- Area:
- Pattern:
- Why it helps:
- Example (file/path):
- Tradeoffs:
- Owner:

## Performance Optimization

### Memoize Expensive Computations

Use `useMemo` to avoid recalculating expensive values on every render:

```tsx
// ❌ Avoid: Recalculates on every render
const sortedItems = [...items].sort((a, b) => /* expensive sort */);

// ✅ Prefer: Only recalculates when dependencies change
const sortedItems = useMemo(() => {
  return [...items].sort((a, b) => /* expensive sort */);
}, [items, sortBy, sortDirection]);
```

**When to memoize:**
- Sorting or filtering large arrays
- Complex calculations based on props/state
- Building derived keys/hashes (e.g., FNV1a hashing for React keys)
- Transforming large datasets

**Evidence:** 
- `activities/gallery-walk/client/components/GalleryWalkFeedbackTable.tsx` - memoized `buildFeedbackRowKeys()`
- `activities/gallery-walk/client/components/FeedbackCards.tsx` - memoized `buildFeedbackCardKeys()`
- `activities/java-format-practice/client/manager/JavaFormatPracticeManager.tsx` - memoized `sortedStudents`

### Memoize Callbacks

Use `useCallback` for callbacks passed to child components or used in effect dependencies:

```tsx
const handleSubmit = useCallback((data) => {
  // handler logic
}, [relevantDependencies]);
```

## React Keys and List Rendering

### Always Use Stable Keys

React keys should be stable and unique to prevent unnecessary remounts and state loss.

```tsx
// ❌ Avoid: Index-based keys are unstable when items reorder
items.map((item, index) => <Item key={index} data={item} />)

// ✅ Prefer: Use unique IDs when available
items.map((item) => <Item key={item.id} data={item} />)

// ✅ Acceptable: Derive deterministic keys from stable fields
const keys = useMemo(() => buildStableKeys(items), [items]);
items.map((item, index) => <Item key={keys[index]} data={item} />)
```

**Deterministic fallback keys:**

When IDs aren't available, build keys from stable field combinations:

```tsx
export function buildStableKeys(entries: Entry[]): string[] {
  const seenKeys = new Map<string, number>();
  
  return entries.map((entry) => {
    // Prefer explicit ID
    if (entry.id) return `id:${entry.id}`;
    
    // Build deterministic signature from stable fields
    const signature = [
      normalizeKeyPart(entry.field1),
      normalizeKeyPart(entry.field2),
      String(entry.timestamp),
    ].join('\u001f');
    
    // Use hash for compact keys
    const baseKey = `entry:${hashStringFNV1a(signature)}`;
    
    // Disambiguate duplicates
    const occurrence = seenKeys.get(baseKey) ?? 0;
    seenKeys.set(baseKey, occurrence + 1);
    return occurrence === 0 ? baseKey : `${baseKey}#${occurrence + 1}`;
  });
}
```

**Evidence:**
- `activities/gallery-walk/client/components/GalleryWalkFeedbackTable.tsx` - `buildFeedbackRowKeys()`
- `activities/gallery-walk/client/components/FeedbackCards.tsx` - `buildFeedbackCardKeys()`
- `activities/gallery-walk/shared/keyUtils.ts` - utility functions

### Provide Stable Keys for Dynamic Children

When rendering dynamic component arrays (e.g., action buttons), provide stable keys:

```tsx
// ✅ Option 1: Explicit key property
<Component
  actionButtons={[
    { key: 'download', content: <Button>Download</Button> },
    { key: 'print', content: <Button>Print</Button> },
  ]}
/>

// ✅ Option 2: React key prop
<Component
  actionButtons={[
    <Button key="download">Download</Button>,
    <Button key="print">Print</Button>,
  ]}
/>

// ❌ Avoid: Index-based keys for reorderable items
actionButtons.map((btn, i) => <div key={i}>{btn}</div>)
```

**Evidence:**
- `activities/gallery-walk/client/components/FeedbackViewSwitcher.tsx` - supports stable keys via `ActionButtonItem` interface

## Accessibility (A11y)

### Add ARIA Semantics to Custom Modals/Dialogs

Custom dialog components need explicit ARIA attributes:

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="dialog-title"
>
  <h2 id="dialog-title">Dialog Title</h2>
  <button aria-label="Close dialog">×</button>
  {/* dialog content */}
</div>
```

**Required attributes:**
- `role="dialog"` - Identifies the dialog semantics
- `aria-modal="true"` - Indicates modal behavior (restricts focus)
- `aria-labelledby="id"` - Points to the dialog title element
- `aria-label` on close buttons for screen reader context

**Evidence:**
- `activities/java-format-practice/client/components/ReferenceModal.tsx` - ARIA semantics added

### Interactive Elements

Ensure interactive elements have proper semantics:

```tsx
// ✅ Buttons for actions
<button type="button" onClick={handler}>Action</button>

// ✅ Links for navigation
<a href="/path">Navigate</a>

// ❌ Avoid: div/span as buttons without ARIA
<div onClick={handler}>Click me</div>
```

## State Management Patterns

### Update Local State Before Guarding Network Calls

When handlers need to update both local UI and server state:

```tsx
// ❌ Avoid: Early return prevents UI update
const handleChange = (value) => {
  if (!sessionId) return; // UI won't update!
  setState(value);
  sendToServer(value);
};

// ✅ Prefer: Update UI first, guard network call
const handleChange = (value) => {
  setState(value); // Always responsive
  
  if (!sessionId) return; // Only guard server call
  sendToServer(value);
};
```

**Rationale:** UI should remain responsive even when server communication isn't possible (e.g., during initial load, network errors).

**Evidence:**
- `activities/java-format-practice/client/manager/JavaFormatPracticeManager.tsx` - `handleDifficultyChange()` and `handleThemeChange()`

### Initialization and Defaults

Always provide sensible defaults for optional props:

```tsx
function Component({
  items = [],
  isLoading = false,
  onAction = () => {},
}: Props) {
  // Component won't crash with undefined values
}
```

## Testing Patterns

### Test Expected Error Paths

When tests intentionally exercise error/failure scenarios, add explicit markers:

```tsx
test('handles network errors gracefully', async () => {
  console.log('[TEST] Intentionally triggering network error');
  mockFetch.mockRejectedOnce(new Error('Network error'));
  // ... test assertions
});
```

This distinguishes expected error output from real regressions.

## General React Conventions

### Import Organization

```tsx
// 1. React imports
import { useState, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';

// 2. Third-party imports
import { useParams } from 'react-router-dom';

// 3. Local absolute imports (workspace paths)
import Button from '@src/components/ui/Button';
import { arrayToCsv } from '@src/utils/csvUtils';

// 4. Relative imports
import type { LocalType } from './types.js';
import { localUtil } from './utils.js';
```

### Component Organization

```tsx
// 1. Types/interfaces
interface Props { /* ... */ }

// 2. Helper functions (outside component if pure)
function helperFunction(data) { /* ... */ }

// 3. Component definition
export default function Component(props: Props) {
  // 4. Hooks (in stable order)
  const [state, setState] = useState();
  const memoValue = useMemo(() => {}, []);
  const callback = useCallback(() => {}, []);
  useEffect(() => {}, []);
  
  // 5. Event handlers
  const handleAction = () => {};
  
  // 6. Render logic
  return <div />;
}

// 7. Styles/constants (if not in separate file)
const styles = { /* ... */ };
```

## When to Optimize

**Optimize when:**
- Profiling shows performance issues
- Working with large datasets (100+ items)
- Complex calculations run on every render
- Users report sluggish UI

**Don't prematurely optimize:**
- Small, static lists
- Simple components that rarely re-render
- During initial implementation (optimize after it works)

## Resources

- React docs: https://react.dev
- React DevTools Profiler for identifying performance issues
- Lighthouse for accessibility audits
