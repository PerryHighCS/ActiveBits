/**
 * Shared message types and utilities for algorithm-demo
 */

export const MESSAGE_TYPES = {
  ALGORITHM_SELECTED: 'algorithm-selected',
  STATE_SYNC: 'state-sync',
  EVENT: 'event',
  POINTER: 'pointer',
};

/**
 * Create a message envelope
 */
export function createMessage(type, payload, { algorithmId = null, sessionId = null } = {}) {
  return {
    type,
    payload,
    ...(algorithmId && { algorithmId }),
    ...(sessionId && { sessionId }),
    timestamp: Date.now(),
  };
}

/**
 * Reducer for algorithm state updates
 * @param {object} state - Current state
 * @param {object} event - Event with { type, payload }
 * @param {function} defaultReducer - Optional default handler
 * @returns {object} New state
 */
export function reduceAlgorithmEvent(state, event, defaultReducer) {
  if (typeof state.reduceEvent === 'function') {
    return state.reduceEvent(state, event);
  }
  if (typeof defaultReducer === 'function') {
    return defaultReducer(state, event);
  }
  return state;
}

/**
 * Validate that referenced pseudocode line IDs exist
 * @param {string[]} pseudocodeLines - Array of pseudocode lines
 * @param {string[]} lineIds - Line IDs to validate (format: "line-N")
 * @returns {string[]} Invalid IDs (empty if all valid)
 */
export function validateLineIds(pseudocodeLines, lineIds) {
  const validIds = new Set(
    pseudocodeLines.map((_, i) => `line-${i}`)
  );
  return lineIds.filter(id => !validIds.has(id));
}
