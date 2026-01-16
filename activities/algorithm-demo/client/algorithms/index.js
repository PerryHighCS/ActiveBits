/**
 * Algorithm registry - all available algorithms are registered here
 * This allows lazy-loading and makes it easy to add new algorithms
 */

import SelectionSort from './sorting/SelectionSort.jsx';
import InsertionSort from './sorting/InsertionSort.jsx';
import BinarySearch from './search/BinarySearch.jsx';
import LinearSearch from './search/LinearSearch.jsx';
import Factorial from './recursion/Factorial.jsx';
import Fibonacci from './recursion/Fibonacci.jsx';
import BinarySearchGame from './guessing/BinarySearchGame.jsx';

/**
 * All available algorithms
 */
const ALGORITHMS = [
  SelectionSort,
  InsertionSort,
  BinarySearch,
  LinearSearch,
  Factorial,
  Fibonacci,
  BinarySearchGame,
];

/**
 * Get algorithm by ID
 */
export function getAlgorithm(id) {
  return ALGORITHMS.find((algo) => algo.id === id);
}

/**
 * Get all algorithms
 */
export function getAllAlgorithms() {
  return ALGORITHMS;
}

/**
 * Get algorithms by category
 */
export function getAlgorithmsByCategory(category) {
  return ALGORITHMS.filter((algo) => algo.category === category);
}

/**
 * Validate algorithm registry - run during dev/test
 */
export function validateAlgorithmRegistry() {
  const errors = [];
  const ids = new Set();

  ALGORITHMS.forEach((algo, idx) => {
    // Check required fields
    if (!algo.id) errors.push(`Algorithm ${idx} missing id`);
    if (!algo.name) errors.push(`Algorithm ${idx} missing name`);
    if (!algo.description) errors.push(`Algorithm ${idx} missing description`);
    if (!Array.isArray(algo.pseudocode)) errors.push(`Algorithm ${idx} pseudocode not array`);

    // Check for duplicate IDs
    if (ids.has(algo.id)) {
      errors.push(`Duplicate algorithm id: ${algo.id}`);
    }
    ids.add(algo.id);

    // Check for valid pseudocode line references in steps
    if (Array.isArray(algo.steps)) {
      const validLineIds = new Set(algo.pseudocode.map((_, i) => `line-${i}`));
      algo.steps.forEach((step, stepIdx) => {
        if (Array.isArray(step.highlight)) {
          step.highlight.forEach((lineId) => {
            if (!validLineIds.has(lineId)) {
              errors.push(`Algorithm ${algo.id} step ${stepIdx} references invalid line ID: ${lineId}`);
            }
          });
        }
      });
    }

    // Check component signatures (can export ManagerView/StudentView or both)
    if (!algo.ManagerView && !algo.StudentView && !algo.DemoView) {
      errors.push(`Algorithm ${algo.id} missing ManagerView, StudentView, or DemoView`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    count: ALGORITHMS.length,
  };
}
