/**
 * Algorithm registry - all available algorithms are registered here
 * This allows lazy-loading and makes it easy to add new algorithms
 */

import type { ComponentType } from 'react'
import SelectionSort from './sorting/SelectionSort.jsx'
import InsertionSort from './sorting/InsertionSort.jsx'
import MergeSort from './sorting/MergeSort.jsx'
import BinarySearch from './search/BinarySearch'
import LinearSearch from './search/LinearSearch'
import Factorial from './recursion/Factorial.jsx'
import Fibonacci from './recursion/Fibonacci.jsx'
import BinarySearchGame from './guessing/BinarySearchGame.jsx'

export type AlgorithmState = Record<string, unknown>

export interface AlgorithmEvent {
  type: string
  payload?: unknown
}

export interface AlgorithmSession {
  id?: string | null
  data: {
    algorithmState?: AlgorithmState | null
    algorithmId?: string | null
  }
}

export interface AlgorithmViewProps {
  session: AlgorithmSession
  onStateChange?: (nextState: AlgorithmState) => void
}

interface AlgorithmStep {
  highlight?: string[]
  [key: string]: unknown
}

export interface AlgorithmModule {
  id?: string
  name?: string
  description?: string
  category?: string
  pseudocode?: string[]
  steps?: AlgorithmStep[]
  initState?: (...args: Array<number | string | null | undefined>) => AlgorithmState
  reduceEvent?: (state: AlgorithmState, event: AlgorithmEvent) => AlgorithmState
  ManagerView?: ComponentType<AlgorithmViewProps>
  StudentView?: ComponentType<AlgorithmViewProps>
  DemoView?: ComponentType<AlgorithmViewProps>
  [key: string]: unknown
}

interface AlgorithmRegistryValidationResult {
  valid: boolean
  errors: string[]
  count: number
}

/**
 * All available algorithms
 */
const ALGORITHMS: AlgorithmModule[] = [
  LinearSearch as AlgorithmModule,
  BinarySearchGame as AlgorithmModule,
  BinarySearch as AlgorithmModule,
  SelectionSort as AlgorithmModule,
  InsertionSort as AlgorithmModule,
  MergeSort as AlgorithmModule,
  Factorial as AlgorithmModule,
  Fibonacci as AlgorithmModule,
]

/**
 * Get algorithm by ID
 */
export function getAlgorithm(id: string): AlgorithmModule | undefined {
  return ALGORITHMS.find((algo) => algo.id === id)
}

/**
 * Get all algorithms
 */
export function getAllAlgorithms(): AlgorithmModule[] {
  return ALGORITHMS
}

/**
 * Get algorithms by category
 */
export function getAlgorithmsByCategory(category: string): AlgorithmModule[] {
  return ALGORITHMS.filter((algo) => algo.category === category)
}

/**
 * Validate algorithm registry - run during dev/test
 */
export function validateAlgorithmRegistry(): AlgorithmRegistryValidationResult {
  const errors: string[] = []
  const ids = new Set<string>()

  ALGORITHMS.forEach((algo, idx) => {
    const algorithmId = typeof algo.id === 'string' ? algo.id : `algorithm-${idx}`
    const pseudocode = Array.isArray(algo.pseudocode) ? algo.pseudocode : []

    // Check required fields
    if (!algo.id) errors.push(`Algorithm ${idx} missing id`)
    if (!algo.name) errors.push(`Algorithm ${idx} missing name`)
    if (!algo.description) errors.push(`Algorithm ${idx} missing description`)
    if (!Array.isArray(algo.pseudocode)) errors.push(`Algorithm ${idx} pseudocode not array`)

    // Check for duplicate IDs
    if (typeof algo.id === 'string' && ids.has(algo.id)) {
      errors.push(`Duplicate algorithm id: ${algo.id}`)
    }
    ids.add(algorithmId)

    // Check for valid pseudocode line references in steps
    if (Array.isArray(algo.steps)) {
      const validLineIds = new Set(pseudocode.map((_, lineIndex) => `line-${lineIndex}`))
      algo.steps.forEach((step, stepIdx) => {
        if (Array.isArray(step.highlight)) {
          step.highlight.forEach((lineId) => {
            if (!validLineIds.has(lineId)) {
              errors.push(`Algorithm ${algorithmId} step ${stepIdx} references invalid line ID: ${lineId}`)
            }
          })
        }
      })
    }

    // Check component signatures (can export ManagerView/StudentView or both)
    if (!algo.ManagerView && !algo.StudentView && !algo.DemoView) {
      errors.push(`Algorithm ${algorithmId} missing ManagerView, StudentView, or DemoView`)
    }
  })

  return {
    valid: errors.length === 0,
    errors,
    count: ALGORITHMS.length,
  }
}
