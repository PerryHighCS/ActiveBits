/**
 * Shared message types and utilities for algorithm-demo
 */

export const MESSAGE_TYPES = {
  ALGORITHM_SELECTED: 'algorithm-selected',
  STATE_SYNC: 'state-sync',
  EVENT: 'event',
  POINTER: 'pointer',
} as const

interface MessageOptions {
  algorithmId?: string | null
  sessionId?: string | null
}

export interface MessageEnvelope<TPayload = unknown> {
  type: string
  payload: TPayload
  algorithmId?: string
  sessionId?: string
  timestamp: number
}

/**
 * Create a message envelope
 */
export function createMessage<TPayload>(
  type: string,
  payload: TPayload,
  { algorithmId = null, sessionId = null }: MessageOptions = {},
): MessageEnvelope<TPayload> {
  return {
    type,
    payload,
    ...(algorithmId && { algorithmId }),
    ...(sessionId && { sessionId }),
    timestamp: Date.now(),
  }
}

/**
 * Custom JSON replacer to handle Sets and other non-serializable types
 */
export function messageReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) {
    return Array.from(value)
  }
  return value
}

export interface AlgorithmEvent {
  type: string
  payload?: unknown
  [key: string]: unknown
}

export interface ReducibleAlgorithmState extends Record<string, unknown> {
  reduceEvent?: (
    state: ReducibleAlgorithmState,
    event: AlgorithmEvent,
  ) => ReducibleAlgorithmState
}

/**
 * Reducer for algorithm state updates
 */
export function reduceAlgorithmEvent(
  state: ReducibleAlgorithmState,
  event: AlgorithmEvent,
  defaultReducer?: (
    state: ReducibleAlgorithmState,
    event: AlgorithmEvent,
  ) => ReducibleAlgorithmState,
): ReducibleAlgorithmState {
  if (typeof state.reduceEvent === 'function') {
    return state.reduceEvent(state, event)
  }
  if (typeof defaultReducer === 'function') {
    return defaultReducer(state, event)
  }
  return state
}

/**
 * Validate that referenced pseudocode line IDs exist
 */
export function validateLineIds(
  pseudocodeLines: readonly string[],
  lineIds: readonly string[],
): string[] {
  const validIds = new Set(pseudocodeLines.map((_, index) => `line-${index}`))
  return lineIds.filter((id) => !validIds.has(id))
}

/**
 * Normalize algorithm state received from network
 * Converts plain objects to Sets where needed (Sets don't serialize over JSON)
 */
export function normalizeAlgorithmState(state: unknown): unknown {
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    return state
  }

  const normalized = { ...(state as Record<string, unknown>) }

  // Convert highlightedLines array back to Set if present
  const highlightedLines = normalized.highlightedLines
  if (Array.isArray(highlightedLines)) {
    normalized.highlightedLines = new Set(
      highlightedLines.filter((entry): entry is string => typeof entry === 'string'),
    )
  }

  // Convert callStack frames (for recursion demos)
  const callStack = normalized.callStack
  if (Array.isArray(callStack)) {
    normalized.callStack = callStack.map((frame: unknown) =>
      frame != null && typeof frame === 'object' ? { ...(frame as Record<string, unknown>) } : {},
    )
  }

  return normalized
}

interface AlgorithmWithInitState {
  initState?: (() => Record<string, unknown>) | unknown
}

/**
 * Hydrate an algorithm state with defaults from its initState
 * Ensures required fields exist to avoid undefined access in views
 */
export function hydrateAlgorithmState(
  algorithm: AlgorithmWithInitState | null | undefined,
  state: unknown,
): unknown {
  if (!algorithm || typeof algorithm.initState !== 'function') {
    return state
  }

  const baseState = algorithm.initState()
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    return baseState
  }

  const hydrated: Record<string, unknown> = { ...baseState }
  for (const [key, value] of Object.entries(state as Record<string, unknown>)) {
    if (value !== null && typeof value !== 'undefined') {
      hydrated[key] = value
    }
  }
  return hydrated
}
